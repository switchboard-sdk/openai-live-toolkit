import { Platform } from 'react-native'
import NativeOpenAILiveToolkit from '../NativeOpenAILiveToolkit'
import { OpenAILiveError } from '../errors'
import type { FeatureGraph, FeatureHost, ToolkitFeature } from '../feature'
import { log } from '../logs'
import { decodeEntities, redactUrl, redactUrls, streamText } from './sanitize'
import { MEDIA_TOOL_NAMES, mediaTools, stationForModel, type MediaToolsPlayer } from './tools'
import type {
  ExternalPlayer,
  MediaMetadata,
  MediaOptions,
  MediaState,
  MediaStation,
  MediaStatus,
  MediaToolsOptions,
} from './types'

const PLAYER_NODE = 'mediaPlayerNode'
const VOLUME_NODE = 'mediaVolumeNode'
const LOUDNESS_NODE = 'mediaLoudnessNode'
const DUCKING_NODE = 'mediaDuckingNode'

// Media ducks about 16 dB while the model talks. The model sends silence between replies, so its
// level alone says when it's talking; the hold rides over pauses between sentences.
const DUCKING = {
  duckingAmount: 0.4,
  activationThreshold: 0.05,
  attack: 0.1,
  hold: 1.5,
  release: 0.6,
}

// How long the play tool waits for a stream to start before answering anyway.
const START_TIMEOUT_MS = 8_000
// What the Now Playing skip buttons jump in a file, in seconds.
const NOW_PLAYING_SKIP_FORWARD = 30
const NOW_PLAYING_SKIP_BACKWARD = 15
// How far media is lowered while the device speaks an offline notice.
const NOTICE_GAIN = 0.2

const NO_MEDIA: Omit<MediaStatus, 'volume'> = {
  url: null,
  station: null,
  state: 'idle',
  playing: false,
  live: false,
  duration: 0,
  metadata: null,
  error: null,
}

/** The toolkit's media, as apps and the hooks use it. */
export type Media = ReturnType<typeof createMedia>['api']

/**
 * Media playing alongside the conversation, from an http(s) URL: a player mixed with the model's
 * voice and ducked while it talks, the media tools, the session note of what's playing and, on iOS,
 * the system's Now Playing. Adds nothing to the graph until {@link Media.configure} turns it on.
 */
export function createMedia(host: FeatureHost) {
  // The app's settings; null while media is off.
  let options: { loudness: number | null; nowPlayingControls: boolean } | null = null
  // Whether the app's settings came: hooks can set tools before they do.
  let configured = false
  let status: MediaStatus = { ...NO_MEDIA, volume: 1 }
  const statusListeners = new Set<(status: MediaStatus) => void>()
  // Called on every change, to settle waitForStart.
  const waiters = new Set<() => void>()
  // What useMediaTools asked for, registered while media is on.
  let toolsWanted: MediaToolsOptions | null = null
  // Media tools are on: the model can control media and is told what's playing.
  let toolsOn = false
  let stations: MediaStation[] = []
  // Stations that failed while online, skipped by next, previous and "play something else".
  const failedStations = new Set<string>()
  // The step of a next or previous whose station hasn't started yet, and whether the error that
  // follows a failed station's state belongs to one it already moved past.
  let stationStep: number | null = null
  let skipNextError = false
  let allowUrls = false
  let externalPlayer: ExternalPlayer | null = null
  // What the current session was last told is playing.
  let sessionNowPlaying = ''
  let remoteCommands: { remove(): void } | null = null
  // The Now Playing info last sent.
  let nowPlayingSent = ''
  // Paused for another app's audio, and whether it was playing.
  let gaveWay: { resume: boolean } | null = null
  // What failed while offline, to play again once the network is back.
  let lostOffline: string | null = null
  let noticePlaying = false

  /** Turn media on, with its settings, or off. */
  function configure(next: boolean | MediaOptions | undefined): void {
    options = !next
      ? null
      : {
          loudness: next === true ? null : (next.loudness ?? null),
          nowPlayingControls:
            Platform.OS === 'ios' && next !== true && (next.nowPlayingControls ?? false),
        }
    configured = true
    const controls = options?.nowPlayingControls ?? false
    if (controls && !remoteCommands) {
      remoteCommands = NativeOpenAILiveToolkit.onRemoteCommand(handleRemoteCommand)
    } else if (!controls && remoteCommands) {
      remoteCommands.remove()
      remoteCommands = null
      syncSystemNowPlaying()
    }
    applyTools()
  }

  /**
   * The player, a volume, the loudness normalizer with `loudness`, and ducking under the model's
   * voice, into the mixer. As part of the output, echo cancellation keeps it from the model.
   */
  function graph(voice: string): FeatureGraph | null {
    if (!options) {
      return null
    }
    const loudness = options.loudness
    return {
      nodes: [
        { id: PLAYER_NODE, type: 'Switchboard.AudioPlayer' },
        { id: VOLUME_NODE, type: 'Switchboard.Gain', properties: { gain: status.volume } },
        ...(loudness === null
          ? []
          : [
              {
                id: LOUDNESS_NODE,
                type: 'Switchboard.LoudnessNormalizer',
                properties: { targetLoudness: loudness },
              },
            ]),
        { id: DUCKING_NODE, type: 'Switchboard.MusicDucking', properties: DUCKING },
      ],
      connections: [
        // Normalized before the volume and ducking, so it measures the source itself.
        ...(loudness === null
          ? [{ sourceNode: PLAYER_NODE, destinationNode: VOLUME_NODE }]
          : [
              { sourceNode: PLAYER_NODE, destinationNode: LOUDNESS_NODE },
              { sourceNode: LOUDNESS_NODE, destinationNode: VOLUME_NODE },
            ]),
        // The ducking node takes the media on bus 0 and the model's voice on bus 1.
        { sourceNode: VOLUME_NODE, destinationNode: DUCKING_NODE, destinationBusIndex: 0 },
        { sourceNode: voice, destinationNode: DUCKING_NODE, destinationBusIndex: 1 },
      ],
      mixerInputs: [DUCKING_NODE],
    }
  }

  /**
   * Play an MP3 or AAC stream or file from an http(s) URL, such as internet radio, replacing what
   * was playing. Needs media on and a running engine.
   * @throws {OpenAILiveError} `MEDIA_FAILED` if it can't, or the URL isn't http(s).
   */
  function play(url: string): void {
    const refuse = (message: string): never => {
      const error = new OpenAILiveError('MEDIA_FAILED', message, false)
      setStatus({ error })
      throw error
    }
    if (!options) {
      return refuse("Media is off. Turn it on with the provider's media prop.")
    }
    const client = host.client()
    if (!client || !host.isRunning()) {
      return refuse('Media plays only while the engine runs.')
    }
    if (!/^https?:\/\//i.test(url)) {
      return refuse(`Not an http(s) URL: ${redactUrl(url)}`)
    }
    log(`media: play ${redactUrl(url)}`)
    const res = client.callAction(PLAYER_NODE, 'stream', { audioFilePath: url })
    if (res.error) {
      return refuse(`Could not play ${redactUrl(url)}: ${redactUrls(res.error.message ?? '')}`)
    }
    // A new source: measured afresh rather than with the last one's gain.
    if (options.loudness !== null) {
      client.callAction(LOUDNESS_NODE, 'reset')
    }
    client.callAction(PLAYER_NODE, 'play')
    gaveWay = null
    stationStep = null
    setStatus({ ...NO_MEDIA, url, state: 'connecting', playing: true })
  }

  /** Pause. A live stream resumes close to live. */
  function pause(): void {
    if (!status.url) {
      return
    }
    log('media: pause')
    host.client()?.callAction(PLAYER_NODE, 'pause')
    setStatus({ playing: false })
  }

  /** Resume after a pause; a finished file starts over. */
  function resume(): void {
    if (!status.url) {
      return
    }
    log('media: resume')
    host.client()?.callAction(PLAYER_NODE, 'play')
    gaveWay = null
    setStatus({ playing: true })
  }

  /** Stop and close the stream. */
  function stop(): void {
    log('media: stop')
    unload()
  }

  function unload(): void {
    if (!status.url) {
      return
    }
    host.client()?.callAction(PLAYER_NODE, 'unload')
    gaveWay = null
    setStatus(NO_MEDIA)
  }

  /** Where a file is, in seconds. 0 for a live stream or with nothing loaded. */
  function position(): number {
    if (!status.url || status.live) {
      return 0
    }
    const seconds = host.client()?.getValue(PLAYER_NODE, 'position').result
    return typeof seconds === 'number' ? seconds : 0
  }

  /**
   * Move to `seconds` into a file, clamped to its length when that's known. Live streams don't seek.
   * @returns where it moved to.
   */
  function seek(seconds: number): number {
    if (!status.url || status.live) {
      return 0
    }
    const target = Math.max(0, status.duration > 0 ? Math.min(seconds, status.duration) : seconds)
    log(`media: seek ${Math.round(target)} s`)
    host.client()?.setValue(PLAYER_NODE, 'position', target)
    syncSystemNowPlaying()
    return target
  }

  /** Volume, 0 to 1, before ducking. Kept across engines. */
  function setVolume(volume: number): void {
    setStatus({ volume: Math.min(1, Math.max(0, volume)) })
    applyGain()
  }

  /** The volume, lowered while the device speaks a notice. */
  function applyGain(): void {
    if (!options || !host.engineId()) {
      return
    }
    host.client()?.setValue(VOLUME_NODE, 'gain', status.volume * (noticePlaying ? NOTICE_GAIN : 1))
  }

  /** Resolves once the media has started or failed, or after timeoutMs with it still on its way. */
  function waitForStart(timeoutMs = START_TIMEOUT_MS): Promise<MediaStatus> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        waiters.delete(check)
        resolve(status)
      }
      const check = () => {
        // The player says it failed a moment before it says why.
        const pending =
          status.state === 'connecting' ||
          status.state === 'buffering' ||
          (status.state === 'error' && !status.error)
        if (!pending) {
          done()
        }
      }
      const timer = setTimeout(done, timeoutMs)
      waiters.add(check)
      check()
    })
  }

  /** Called with the whole status after any change. */
  function addStatusListener(listener: (status: MediaStatus) => void): { remove(): void } {
    statusListeners.add(listener)
    return { remove: () => statusListeners.delete(listener) }
  }

  function setStatus(change: Partial<MediaStatus>): void {
    const next = { ...status, ...change }
    next.station = next.url
      ? (stations.find((st) => st.url === next.url)?.name ?? (next.metadata?.stationName || null))
      : null
    status = next
    statusListeners.forEach((l) => l(status))
    waiters.forEach((w) => w())
    syncNowPlaying()
    syncSystemNowPlaying()
  }

  /**
   * Let the model control media and know what's playing: registers the media tools and keeps the
   * session told what's playing, as quiet context. `null` turns them off. Taken before media is
   * configured, as a hook below the provider mounts first, and registered once media is on.
   */
  function setTools(next: MediaToolsOptions | null): void {
    toolsWanted = next
    applyTools()
  }

  function applyTools(): void {
    if (toolsWanted && configured && !options) {
      console.warn(
        "[OpenAILiveToolkit] useMediaTools ignored: media is off. Turn it on with the provider's media prop."
      )
    }
    const next = options ? toolsWanted : null
    if (!next && !toolsOn) {
      return
    }
    toolsOn = next !== null
    stations = (next?.stations ?? []).map((st) => ({
      ...st,
      name: streamText(st.name),
      ...(st.description ? { description: streamText(st.description) } : {}),
    }))
    allowUrls = next?.allowUrls ?? false
    externalPlayer = next?.externalPlayer ?? null
    const tools = toolsOn ? mediaTools(player, { stations, allowUrls, externalPlayer }) : []
    host.updateTools((registered) => {
      MEDIA_TOOL_NAMES.forEach((name) => registered.delete(name))
      tools.forEach((t) => registered.set(t.name, t))
    })
    syncNowPlaying()
  }

  const player: MediaToolsPlayer = {
    status: () => status,
    play,
    waitForStart: () => waitForStart(),
    pause,
    resume,
    setVolume,
    position,
    seek,
    pickStation,
    voiceVolume: () => host.voiceVolume(),
  }

  /** The station called `name`, or with no name, the next one after what's playing. */
  function pickStation(name?: string): MediaStation | undefined {
    if (name) {
      return stations.find((st) => st.name.toLowerCase() === name.toLowerCase())
    }
    return adjacentStation(1)
  }

  /** The next (step 1) or previous (-1) station from the one playing, past failed ones. */
  function adjacentStation(step: number): MediaStation | undefined {
    const current = stations.findIndex((st) => st.url === status.url)
    const from = current === -1 ? (step > 0 ? -1 : 0) : current
    const count = stations.length
    for (let i = 1; i <= count; i++) {
      const station = stations[(((from + step * i) % count) + count) % count]!
      if (station.url !== status.url && !failedStations.has(station.url)) {
        return station
      }
    }
    return undefined
  }

  /**
   * Remembers a station that failed while online. One started by next or previous gives way to
   * the station after it; returns whether one did.
   */
  function stationFailed(): boolean {
    if (!status.url || host.isOffline()) {
      return false
    }
    failedStations.add(status.url)
    if (stationStep === null) {
      return false
    }
    const step = stationStep
    const station = adjacentStation(step)
    if (!station) {
      return false
    }
    log(`media: ${redactUrl(status.url)} failed, playing the next station`)
    play(station.url)
    stationStep = step
    skipNextError = true
    return true
  }

  function nowPlayingNote(): string {
    const station = stationForModel(status) ?? 'A stream'
    const title = status.metadata?.title ? `"${streamText(status.metadata.title)}"` : ''
    if (!status.url) {
      return 'The music stopped; nothing is playing.'
    }
    if (status.state === 'error') {
      return `Nothing is playing: ${station} couldn't be played.`
    }
    if (status.state === 'finished') {
      return `${station} finished playing.`
    }
    if (!status.playing) {
      return `${station} is paused.`
    }
    return title ? `Now playing on ${station}: ${title}.` : `Now playing: ${station}.`
  }

  /** Tell the session what's playing when that changed, as context it won't say on its own. */
  function syncNowPlaying(): void {
    if (!toolsOn || !host.isSessionLive()) {
      return
    }
    // Wait to say it plays until it does, or fails.
    if (status.playing && (status.state === 'connecting' || status.state === 'buffering')) {
      return
    }
    const note = nowPlayingNote()
    // A session that was never told something plays doesn't need to hear that nothing does.
    if (note === sessionNowPlaying || (sessionNowPlaying === '' && !status.url)) {
      return
    }
    if (host.addContext(note)) {
      sessionNowPlaying = note
    }
  }

  /**
   * With `nowPlayingControls`, shows the loaded media as the system's Now Playing, and keeps other
   * apps' audio out meanwhile: an app that mixes can't be the Now Playing app. Media that gave way
   * to another app's audio isn't shown.
   */
  function syncSystemNowPlaying(): void {
    if (Platform.OS !== 'ios') {
      return
    }
    const shown =
      (options?.nowPlayingControls ?? false) &&
      status.url !== null &&
      status.state !== 'error' &&
      gaveWay === null
    host.keepOtherAudioOut(shown)
    const info = shown ? JSON.stringify(systemNowPlayingInfo()) : ''
    if (info === nowPlayingSent) {
      return
    }
    nowPlayingSent = info
    NativeOpenAILiveToolkit.setNowPlaying(info)
  }

  function systemNowPlayingInfo(): object {
    const station = status.station ?? (status.url ? redactUrl(status.url) : '')
    const title = status.metadata?.title || station
    const file = !status.live && status.duration > 0
    const multiple = status.live && stations.length > 1
    return {
      title,
      artist: title === station ? '' : station,
      live: status.live,
      duration: status.duration,
      position: position(),
      playing: status.playing,
      next: multiple,
      previous: multiple,
      skipForward: file ? NOW_PLAYING_SKIP_FORWARD : 0,
      skipBackward: file ? NOW_PLAYING_SKIP_BACKWARD : 0,
      seek: file,
    }
  }

  function handleRemoteCommand(command: string): void {
    if (!status.url) {
      return
    }
    log(`now playing: ${command}`)
    if (command === 'play' || (command === 'toggle' && !status.playing)) {
      resume()
    } else if (command === 'pause' || command === 'toggle') {
      pause()
    } else if (command === 'next' || command === 'previous') {
      const step = command === 'next' ? 1 : -1
      const station = adjacentStation(step)
      if (station) {
        play(station.url)
        stationStep = step
      }
    } else if (command === 'skipForward') {
      seek(position() + NOW_PLAYING_SKIP_FORWARD)
    } else if (command === 'skipBackward') {
      seek(position() - NOW_PLAYING_SKIP_BACKWARD)
    } else if (command.startsWith('seek:')) {
      seek(Number(command.slice('seek:'.length)) || 0)
    }
  }

  function handleNodeEvent(_nodeId: string, name: string, data: unknown): void {
    switch (name) {
      case 'stateChanged': {
        const state = (data as { state: MediaState }).state
        log(`media: ${state}`)
        if (state === 'error' && stationFailed()) {
          break
        }
        if (state === 'ready') {
          failedStations.delete(status.url ?? '')
          stationStep = null
          skipNextError = false
        }
        setStatus({
          state,
          // Known once the server answers.
          ...(state === 'ready' ? readyDetails() : {}),
          ...(state === 'finished' || state === 'error' ? { playing: false } : {}),
        })
        if (state === 'error' && host.isOffline()) {
          lostOffline = status.url
        }
        break
      }
      case 'metadata': {
        const metadata = decodeMetadata(data as MediaMetadata | undefined)
        log(`media: now playing ${JSON.stringify(metadata ?? {})}`)
        setStatus({ metadata })
        break
      }
      case 'error': {
        if (skipNextError) {
          skipNextError = false
          break
        }
        const message = (data as { message?: string } | undefined)?.message
        const error = new OpenAILiveError(
          'MEDIA_FAILED',
          message?.trim() ? redactUrls(message) : 'Media failed',
          false
        )
        setStatus({ error })
        host.reportError(error)
        break
      }
    }
  }

  /** What's known once the server answers: whether it's live, and a file's length. */
  function readyDetails(): Pick<MediaStatus, 'live' | 'duration'> {
    const live = host.client()?.getValue(PLAYER_NODE, 'isLive').result === true
    const duration = host.client()?.getValue(PLAYER_NODE, 'duration').result
    return { live, duration: !live && typeof duration === 'number' ? duration : 0 }
  }

  const feature: ToolkitFeature = {
    graph,
    toolsNote: (tools) =>
      tools.some((t) => (MEDIA_TOOL_NAMES as readonly string[]).includes(t.name))
        ? 'Playing, pausing, resuming, skipping and the volume of music and radio are delegated too.'
        : null,
    ownsNode: (nodeId) => options !== null && nodeId === PLAYER_NODE,
    handleNodeEvent,

    sessionStarted(continued) {
      if (!continued) {
        sessionNowPlaying = ''
      }
      syncNowPlaying()
    },

    /**
     * iOS: another app's audio interrupting the engine while media holds Now Playing pauses the
     * media and lets that app play. When the engine runs again with no other app playing, as after
     * a call, the media takes Now Playing back and resumes if it was playing.
     */
    engineStateChanged(state, reason) {
      if (state === 'interrupted') {
        if (!host.isOtherAudioKeptOut() || reason !== 'default') {
          return
        }
        log('now playing: interrupted, giving way to other apps')
        gaveWay = { resume: status.playing }
        if (status.playing) {
          pause()
        } else {
          syncSystemNowPlaying()
        }
        return
      }
      if (state !== 'running' || !gaveWay) {
        return
      }
      if (NativeOpenAILiveToolkit.isOtherAudioPlaying()) {
        log('now playing: another app is playing, media stays paused')
        gaveWay = { resume: false }
        return
      }
      const resumes = gaveWay.resume
      gaveWay = null
      if (resumes) {
        resume()
      } else {
        syncSystemNowPlaying()
      }
    },

    // Media only plays with the engine, and a stream left open keeps downloading.
    engineStopped() {
      unload()
      lostOffline = null
    },

    networkBack() {
      const lost = lostOffline
      lostOffline = null
      if (!lost || status.url !== lost || status.state !== 'error') {
        return
      }
      log('media: playing again now the network is back')
      try {
        play(lost)
      } catch {
        // Reported through the media error.
      }
    },

    noticeSpeaking(speaking) {
      noticePlaying = speaking
      applyGain()
    },

    makeWayForOtherAudio() {
      if (!status.url) {
        return
      }
      stop()
    },
  }

  return {
    /** What the toolkit runs. */
    feature,
    configure,
    /** What apps and the hooks use. */
    api: {
      play,
      waitForStart,
      pause,
      resume,
      stop,
      seek,
      position,
      setVolume,
      setTools,
      addStatusListener,
      /** Where the media is. */
      get status(): MediaStatus {
        return status
      },
    },
  }
}

/** What a stream says, with HTML entities decoded in its text. The station's website stays as sent. */
function decodeMetadata(metadata: MediaMetadata | undefined): MediaMetadata | null {
  if (!metadata) {
    return null
  }
  const decoded = { ...metadata }
  for (const key of ['title', 'stationName', 'genre'] as const) {
    if (typeof decoded[key] === 'string') {
      decoded[key] = decodeEntities(decoded[key])
    }
  }
  return decoded
}
