import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { asLiveError } from '../errors'
import { openAILiveToolkit } from '../OpenAILiveToolkit'
import { useOpenAILiveToolkit } from '../OpenAILiveToolkitProvider'
import type { MediaStatus, MediaToolsOptions } from './types'

/**
 * Media playing alongside the conversation: a stream or file from an http(s) URL, ducked while the
 * model talks. Plays only with the provider's `media` on and while the engine runs; `stop()` on the
 * engine stops it.
 */
export interface MediaPlayback extends MediaStatus {
  /**
   * Play a URL, replacing what was playing. Fails (to `error` and `onError`) unless media is on and
   * the engine is running.
   */
  play: (url: string) => void
  /**
   * Resolves with the status once what `play` started is playing or has failed, or after
   * `timeoutMs` (default 8 s) with it still connecting.
   */
  waitForStart: (timeoutMs?: number) => Promise<MediaStatus>
  /** Pause. A live stream resumes close to live. */
  pause: () => void
  /** Resume after `pause`; a finished file starts over. */
  resume: () => void
  /** Stop and close the stream. */
  stop: () => void
  setVolume: (volume: number) => void
  /** Move to `seconds` into a file; see {@link useMediaPosition}. Live streams don't seek. */
  seek: (seconds: number) => void
}

function subscribe(onChange: () => void): () => void {
  const subscription = openAILiveToolkit.media.addStatusListener(onChange)
  return () => subscription.remove()
}

function getStatus(): MediaStatus {
  return openAILiveToolkit.media.status
}

function play(url: string): void {
  try {
    openAILiveToolkit.media.play(url)
  } catch (err) {
    openAILiveToolkit.reportError(asLiveError(err, 'MEDIA_FAILED', false))
  }
}

const controls = {
  play,
  waitForStart: (timeoutMs?: number) => openAILiveToolkit.media.waitForStart(timeoutMs),
  pause: () => openAILiveToolkit.media.pause(),
  resume: () => openAILiveToolkit.media.resume(),
  stop: () => openAILiveToolkit.media.stop(),
  setVolume: (volume: number) => openAILiveToolkit.media.setVolume(volume),
  seek: (seconds: number) => {
    openAILiveToolkit.media.seek(seconds)
  },
}

/**
 * Media playback alongside the conversation, with the provider's `media` on. The model's media
 * tools change it too. Must be used within `OpenAILiveToolkitProvider`.
 */
export function useMedia(): MediaPlayback {
  // Throws outside the provider, like the other hooks.
  useOpenAILiveToolkit()
  const status = useSyncExternalStore(subscribe, getStatus)
  return useMemo(() => ({ ...status, ...controls }), [status])
}

/**
 * Where the media file is, in seconds, read every `intervalMs`. 0 for a live stream or with nothing
 * loaded. Only components that call it re-render as it moves.
 */
export function useMediaPosition(intervalMs = 1000): number {
  const media = useMedia()
  const [position, setPosition] = useState(0)
  const file = media.url !== null && !media.live
  useEffect(() => {
    if (!file) {
      setPosition(0)
      return
    }
    const read = () => setPosition(openAILiveToolkit.media.position())
    read()
    // Also while paused, so a seek shows.
    const timer = setInterval(read, intervalMs)
    return () => clearInterval(timer)
  }, [file, media.url, intervalMs])
  return position
}

/**
 * Let the model control media and know what's playing, while this component is mounted: it can
 * play a station (or any URL, with `allowUrls`), pause, resume, change the volume and say what's
 * playing, and the session is told when the station or song changes, as quiet context. Stations
 * can change at runtime. Needs the provider's `media` on.
 *
 * @example
 * useMediaTools({
 *   stations: [{ name: 'Newstalk 1010', url: 'https://…/CFRBAMAAC.aac', description: 'Toronto news' }],
 * })
 */
export function useMediaTools(options: MediaToolsOptions = {}): void {
  // Throws outside the provider, like the other hooks.
  useOpenAILiveToolkit()
  // Read live, so a new isPlaying each render doesn't re-register the tools.
  const playerRef = useRef(options.externalPlayer)
  playerRef.current = options.externalPlayer
  const optionsKey = JSON.stringify({
    stations: options.stations ?? [],
    allowUrls: options.allowUrls ?? false,
    player: options.externalPlayer?.name ?? null,
  })
  useEffect(() => {
    const { player, ...rest } = JSON.parse(optionsKey)
    openAILiveToolkit.media.setTools({
      ...rest,
      ...(player !== null
        ? {
            externalPlayer: {
              name: player,
              isPlaying: () => playerRef.current?.isPlaying() ?? false,
            },
          }
        : {}),
    })
    return () => openAILiveToolkit.media.setTools(null)
  }, [optionsKey])
}
