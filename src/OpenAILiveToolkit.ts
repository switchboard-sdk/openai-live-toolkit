import { PermissionsAndroid, Platform } from 'react-native'
import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'
import { androidModule } from './androidModule'
import { log, shareLogs, startLogFile } from './logs'
import { NativeModuleRPCClient } from './NativeModuleRPCClient'
import { SwitchboardClient } from './SwitchboardClient'
import { DEFAULT_DELEGATE_MODEL, DEFAULT_MODEL, DEFAULT_VOICE, type OpenAIVoice } from './voice'
import { DEFAULT_SWITCHBOARD_APP_ID, DEFAULT_SWITCHBOARD_APP_SECRET } from './credentials'

/**
 * Machine-readable cause of an {@link OpenAILiveError}. Branch on this rather
 * than on the message, which is meant for humans and may change.
 */
export type OpenAILiveErrorCode =
  /** The Switchboard SDK refused to initialize (rejected credentials, extension load failure). */
  | 'INIT_FAILED'
  /** An action needed the SDK, which never came up. */
  | 'NOT_INITIALIZED'
  /** No OpenAI API key for the `websocket` transport. */
  | 'MISSING_API_KEY'
  /** The user denied microphone access. */
  | 'MIC_PERMISSION_DENIED'
  /** The audio graph couldn't be built. */
  | 'ENGINE_CREATION_FAILED'
  /** The engine refused to start (audio session unavailable, mic held by another app). */
  | 'ENGINE_START_FAILED'
  /** The engine refused to stop — it's still running, and the mic is still hot. */
  | 'ENGINE_STOP_FAILED'
  /** OpenAI reported a session-level failure (rejected key, quota, unknown model, bad tool schema). */
  | 'SESSION_FAILED'
  /** A tool handler threw. Already reported to the model, which carries on without the result. */
  | 'TOOL_HANDLER_FAILED'
  /** A tool's result never reached OpenAI — no live session, or a stale call id. */
  | 'TOOL_RESULT_UNDELIVERED'
  /** Media couldn't play: no running engine, not an http(s) URL, or the stream failed. */
  | 'MEDIA_FAILED'

/**
 * A failure with a machine-readable {@link OpenAILiveError.code}.
 *
 * One type on both channels: actions with a caller (`start`, `stop`) reject with
 * it, and failures with no caller (the session, tool calls) are delivered to
 * {@link OpenAILiveToolkit.addErrorListener}. Never both for the same failure.
 */
export class OpenAILiveError extends Error {
  /** What failed. */
  readonly code: OpenAILiveErrorCode
  /**
   * Whether this leaves something the app has to act on. `false` means the session
   * absorbed it and carries on — worth logging, but there's nothing to render and
   * nothing to clear, so it never lands in the provider's `error` state.
   */
  readonly fatal: boolean
  /** Whatever the underlying layer reported, when there was more than a message. */
  readonly details?: Record<string, unknown>

  constructor(
    code: OpenAILiveErrorCode,
    message: string,
    fatal: boolean,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'OpenAILiveError'
    this.code = code
    this.fatal = fatal
    this.details = details
  }
}

/** Handler for {@link OpenAILiveToolkit.addErrorListener}. */
export type OpenAILiveErrorListener = (error: OpenAILiveError) => void

/**
 * How the session reaches GPT-Live. `'webrtc'` goes through the Switchboard backend, which
 * creates the session with the app's OpenAI key. `'websocket'` connects straight to OpenAI
 * with {@link OpenAILiveToolkitInitializeOptions.openAIApiKey}.
 */
export type OpenAILiveTransport = 'webrtc' | 'websocket'

/** Options for `start()`. */
export interface OpenAILiveStartOptions {
  /**
   * A session to continue, by the id from its `sessionStarted` event, e.g. one the app saved before
   * it was killed. Needs `continueConversation`. A fork keeps the instructions and voice that
   * session had.
   */
  continueSessionId?: string
}

/** Credentials and session seeds for {@link OpenAILiveToolkit.initialize}. */
export interface OpenAILiveToolkitInitializeOptions {
  /** Switchboard app ID. Optional: falls back to the shared default credentials. */
  appId?: string
  /** Switchboard app secret. Optional, with the same fallback as {@link appId}. */
  appSecret?: string
  /** Switchboard backend, e.g. `https://staging.api.switchboard.audio`. Defaults to production. */
  apiUrl?: string
  /** Defaults to `'webrtc'`. Fixed for the engine's lifetime. */
  transport?: OpenAILiveTransport
  /** OpenAI API key. Required by {@link OpenAILiveToolkit.start} for the `websocket` transport. */
  openAIApiKey?: string
  /**
   * ai-coustics license key. Speaker isolation needs it and a build that links the
   * AICoustics extension. Without both the graph is built without it and
   * {@link OpenAILiveToolkit.setSpeakerIsolation} does nothing.
   */
  aiCousticsLicenseKey?: string
  /** System prompt. Fixed per session; see {@link OpenAILiveToolkit.setInstructions}. */
  instructions?: string
  /** Voice the model speaks with. Defaults to `'marin'`. */
  voice?: OpenAIVoice
  /** GPT-Live model id. Defaults to `'gpt-live-1'`. Fixed for the engine's lifetime. */
  model?: string
  /** Model that handles delegated work and calls tools. Defaults to `'gpt-5.5'`. */
  delegateModel?: string
  /** Instructions for the delegate model. */
  delegateInstructions?: string
  /** Start with speaker isolation on. Defaults to true. Needs {@link aiCousticsLicenseKey}. */
  speakerIsolation?: boolean
  /**
   * Close the session after this many ms with nobody talking, and reopen it when the user
   * speaks, continuing the conversation. Nothing is billed while it's closed. Off by default.
   * While on, OpenAI stores each session so the next one can continue it.
   */
  idleTimeoutMs?: number
  /**
   * After a wake, close again after this many ms unless the model replies or delegates. Keeps a
   * wake on a noise (a TV, the phone vibrating) from costing a full {@link idleTimeoutMs}.
   * Defaults to 5000, capped at {@link idleTimeoutMs}; 0 turns it off.
   */
  wakeGraceMs?: number
  /**
   * Continue the conversation when a session reopens: `start()` after `stop()` forks the session
   * the stop closed, and `start({ continueSessionId })` forks one the app saved, e.g. before it
   * was killed. While on, OpenAI stores each session. Off by default.
   */
  continueConversation?: boolean
  /**
   * Let the delegate search the web (OpenAI's hosted web search), so the model can answer about
   * weather, news and other current information. Off by default; each search is billed.
   */
  webSearch?: boolean
  /** Also write the SDK's log and the toolkit's events to a file, for {@link shareLogs}. Off by default. */
  logFile?: boolean
  /** Include the transcript and tool arguments and results in the log. Off by default. */
  logConversation?: boolean
  /**
   * iOS: play alongside other apps' audio, like music, instead of stopping it. Off by default.
   * Voice processing still lowers that audio; see {@link otherAudioDucking}.
   */
  mixWithOthers?: boolean
  /**
   * iOS 17+, with {@link mixWithOthers}: how far voice processing lowers other apps' audio, and
   * only while someone talks. `'default'` keeps the system's ducking. Defaults to `'min'`.
   */
  otherAudioDucking?: OtherAudioDucking
  /**
   * iOS, with a Bluetooth headset, car or speaker connected: which microphone the model hears.
   * `'phone'` (default) plays over Bluetooth in high quality (A2DP); `'bluetooth'` uses the
   * device's microphone, with call-quality audio (HFP), and leaves a device without a microphone
   * unused. See {@link OpenAILiveToolkit.setMicrophone}. Android always uses the device's.
   */
  microphone?: Microphone
}

export type OtherAudioDucking = 'default' | 'min' | 'mid' | 'max'

/** The microphone the model hears while a Bluetooth device is connected. */
export type Microphone = 'bluetooth' | 'phone'

/**
 * The categories of event the toolkit surfaces, one per graph node it listens to. `'vad'`
 * (speechStarted / speechEnded) is only there in idle mode. `'media'` is the media player's
 * stateChanged, metadata and error, and the toolkit's statusChanged with the whole
 * {@link MediaStatus} after any change.
 */
export type OpenAILiveToolkitEventType = 'live' | 'vad' | 'media'

/**
 * Where the media player is. `'connecting'` and `'buffering'` wait for audio, `'finished'` is a file
 * played to its end, `'idle'` is nothing loaded.
 */
export type MediaState = 'idle' | 'connecting' | 'buffering' | 'ready' | 'finished' | 'error'

/** What a stream says is playing. Fields it doesn't say are empty. */
export interface MediaMetadata {
  /** Usually "Artist - Title". */
  title: string
  stationName: string
  genre: string
  /** The station's website. */
  url: string
}

/** Where the media is, as {@link OpenAILiveToolkit.mediaStatus} and `useMedia()` show it. */
export interface MediaStatus {
  /** The URL loaded, or null. */
  url: string | null
  /** The station's name: from the media tools' stations, else what the stream says. */
  station: string | null
  /** Where the player is: connecting, buffering, playing audio (`'ready'`), finished, failed. */
  state: MediaState
  /** Playing, or waiting for audio to play, rather than paused or stopped. */
  playing: boolean
  /** Whether it's a live stream, such as radio, rather than a file. Known once `state` is `'ready'`. */
  live: boolean
  /** What the stream says is playing, or null until it says. */
  metadata: MediaMetadata | null
  /** Why the last URL failed to play, or null. */
  error: OpenAILiveError | null
  /** 0 to 1, before ducking. */
  volume: number
}

/** A station the model can play through the media tools. */
export interface MediaStation {
  /** What the user calls it, e.g. "Newstalk 1010". */
  name: string
  /** An http(s) MP3 or AAC stream. */
  url: string
  /** What it plays, so the model can pick, e.g. "Toronto news and talk". */
  description?: string
}

/** Options for {@link OpenAILiveToolkit.setMediaTools}. */
export interface MediaToolsOptions {
  /** Stations the model can play by name. */
  stations?: MediaStation[]
  /**
   * Let the model play any public http(s) URL, such as one the user reads out or one it found.
   * Off by default: the model then plays only {@link stations}.
   */
  allowUrls?: boolean
}

/** A classified Switchboard event. */
export interface OpenAILiveToolkitEvent {
  /** Which node emitted it. */
  type: OpenAILiveToolkitEventType
  /** Event name, e.g. 'inputTranscriptDelta' / 'toolCall'. */
  name: string
  /** The emitting node's URI. */
  objectURI: string
  /** Event payload. */
  data: unknown
  /** Emit time (ms since epoch), if provided. */
  timestamp?: number
  /** The original JSON string. */
  raw: string
}

/** Returned by the add*Listener methods; call `remove()` to unsubscribe. */
export interface OpenAILiveToolkitSubscription {
  remove(): void
}

/** Handler for a classified toolkit event. */
export type OpenAILiveToolkitEventListener = (event: OpenAILiveToolkitEvent) => void

/** A tool the model can call. Register it with the `useTool` hook (or `registerTool`). */
export interface OpenAILiveToolkitTool {
  /** Function name the model calls. */
  name: string
  /** What it does — the model uses this to decide when to call it. */
  description: string
  /**
   * JSON Schema for the arguments object (OpenAI function-parameters format).
   * Omit for a no-argument tool.
   */
  parameters?: object
  /**
   * Runs when the model calls this tool. Receives the parsed arguments and
   * returns any JSON-serializable value (or a Promise of one); the result is
   * sent back to the model automatically. Throwing reports a tool error.
   */
  handler: (args: any) => unknown | Promise<unknown>
}

/** A registered tool as the delegate sees it. */
interface ToolDef {
  type: 'function'
  name: string
  description: string
  parameters: object
}

/** OpenAI's hosted web search, which the delegate runs itself. */
const WEB_SEARCH_TOOL = { type: 'web_search' } as const

/** What the Live node gets as the delegate's tools. */
type DelegateTool = ToolDef | typeof WEB_SEARCH_TOOL

/** Payload of a `toolCall` event from the Live node. */
interface ToolCall {
  callId: string
  name: string
  argumentsJson: string
}

const LIVE_NODE = 'liveNode'
const ISOLATION_NODE = 'speakerIsolationNode'
const VAD_NODE = 'vadNode'
const MEDIA_NODE = 'mediaPlayerNode'
const MEDIA_VOLUME_NODE = 'mediaVolumeNode'

// The graph's node IDs → event category, used to split the single native event stream.
const NODE_EVENT_TYPE: Record<string, OpenAILiveToolkitEventType> = {
  [LIVE_NODE]: 'live',
  [VAD_NODE]: 'vad',
  [MEDIA_NODE]: 'media',
}

// The graph runs at 48 kHz; Quail wants 16 kHz, so it sits between two resamplers.
const GRAPH_SAMPLE_RATE = 48000
const QUAIL_SAMPLE_RATE = 16000
const QUAIL_MODEL = 'quail_vf_2_1_l_16khz_8xope536_v11.aicmodel'
const DEFAULT_WAKE_GRACE_MS = 5_000

// Media ducks about 16 dB while the model talks. The model sends silence between replies, so its
// level alone says when it's talking; the hold rides over pauses between sentences.
const MEDIA_DUCKING = {
  duckingAmount: 0.4,
  activationThreshold: 0.05,
  attack: 0.1,
  hold: 1.5,
  release: 0.6,
}

// How long the play tool waits for a stream to start before answering anyway.
const MEDIA_START_TIMEOUT_MS = 8_000

const MEDIA_TOOL_NAMES = [
  'play_media',
  'pause_media',
  'resume_media',
  'set_media_volume',
  'get_now_playing',
] as const

// GPT-Live only delegates work it knows can be done, and the tools live in the delegate's config,
// so the live model is told about them; the delegate is told to call them rather than say it did.
const DELEGATE_INSTRUCTIONS =
  "You carry out actions in the user's app. When a request matches one of your tools, call the " +
  'tool; never claim an action is done without calling it.'

/** What the live model is told about the registered tools. Empty with no tools. */
export function toolsNote(
  tools: readonly { name: string; description: string }[],
  webSearch = false
): string {
  const parts: string[] = []
  if (tools.length > 0) {
    const list = tools.map((t) => `${t.name} (${t.description})`).join('; ')
    parts.push(
      `You can act in the app through tools: ${list}. Use them whenever the user asks for one of these.`
    )
  }
  if (webSearch) {
    parts.push(
      'For current information like weather or news, delegate: the delegate can search the web.'
    )
  }
  return parts.join(' ')
}

function joinInstructions(...parts: string[]): string {
  return parts.filter((p) => p.trim() !== '').join('\n\n')
}

/** A URL for logs and error messages: without credentials, query or fragment, which can hold tokens. */
export function redactUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1').replace(/[?#].*$/, '')
}

/** {@link redactUrl} for every http(s) URL in a message from the SDK. */
function redactUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s'"]+/gi, redactUrl)
}

const MAX_STREAM_TEXT = 100

/**
 * Text from a stream (a title or station name), which whoever runs the station controls: one line,
 * capped, without double quotes, for the model to be told as quoted data.
 */
export function streamText(text: string): string {
  const line = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/["“”„«»]/g, "'")
    .trim()
  return line.length > MAX_STREAM_TEXT ? `${line.slice(0, MAX_STREAM_TEXT)}…` : line
}

/**
 * Whether a URL points at the device itself or a local network, which the model mustn't reach. Only
 * the URL is checked: a name that resolves to a local address, or a redirect to one, gets through.
 */
export function isLocalUrl(url: string): boolean {
  const authority = url.match(/^[a-z]+:\/\/([^/?#]*)/i)?.[1]
  // Credentials, IPv6 literals and backslashes have no place in a stream URL, and parse differently
  // from one parser to the next.
  if (authority === undefined || /[@[\]\\]/.test(authority) || url.includes('\\')) {
    return true
  }
  const host = authority.replace(/:\d*$/, '').toLowerCase().replace(/\.$/, '')
  // Single-label names like "router" only resolve on a local network.
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')) {
    return true
  }
  const labels = host.split('.')
  if (!labels.every((label) => /^(0x[0-9a-f]*|\d+)$/.test(label))) {
    return false
  }
  // A numeric host: resolvers also take short, octal and hex forms like 127.1, so only a plain
  // dotted quad is let through, and only outside the local ranges.
  const quad = labels.length === 4 && labels.every((l) => /^(0|[1-9]\d{0,2})$/.test(l) && +l < 256)
  if (!quad) {
    return true
  }
  const [a, b] = labels.map(Number) as [number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * The Switchboard graph the toolkit runs:
 * microphone → mono → [Quail speaker isolation] → OpenAI.Live → mixer → speaker.
 * The model owns turn-taking. In idle mode a VAD taps the input the model hears, only to
 * tell when the user starts talking again. Media plays into the mixer, ducked under the model's
 * voice; as part of the output, echo cancellation keeps it from the model.
 */
function buildLiveEngine(
  transport: OpenAILiveTransport,
  apiKey: string,
  tools: DelegateTool[],
  session: {
    model: string
    voice: OpenAIVoice
    instructions: string
    delegateModel: string
    delegateInstructions: string
  },
  isolation: { available: boolean; enabled: boolean },
  idleMode: boolean,
  store: boolean,
  otherAudio: { mix: boolean; ducking: OtherAudioDucking },
  microphone: Microphone,
  mediaVolume: number
) {
  const nodes: object[] = [{ id: 'multiChannelToMonoNode', type: 'Switchboard.MultiChannelToMono' }]
  const chain = ['inputNode', 'multiChannelToMonoNode']
  if (isolation.available) {
    nodes.push(
      {
        id: 'downResamplerNode',
        type: 'Switchboard.Resampler',
        configuration: { inputSampleRate: GRAPH_SAMPLE_RATE, outputSampleRate: QUAIL_SAMPLE_RATE },
      },
      {
        id: ISOLATION_NODE,
        type: 'AICoustics.SpeechEnhancer',
        // Settings validated against GPT-Live with a competing talker in the room.
        configuration: {
          modelPath: QUAIL_MODEL,
          enabled: isolation.enabled,
          vadGated: false,
          enhancementLevel: 0.7,
          vadSensitivity: 15,
          speechHoldDuration: 0.5,
        },
      },
      {
        id: 'upResamplerNode',
        type: 'Switchboard.Resampler',
        configuration: { inputSampleRate: QUAIL_SAMPLE_RATE, outputSampleRate: GRAPH_SAMPLE_RATE },
      }
    )
    chain.push('downResamplerNode', ISOLATION_NODE, 'upResamplerNode')
  }
  if (idleMode) {
    nodes.push(
      { id: 'vadSplitterNode', type: 'Switchboard.BusSplitter' },
      {
        id: VAD_NODE,
        type: 'Silero.VAD',
        configuration: { threshold: 0.5, minSilenceDurationMs: 500 },
      }
    )
    chain.push('vadSplitterNode')
  }
  nodes.push(
    {
      id: LIVE_NODE,
      type: 'OpenAI.Live',
      configuration: {
        transport,
        // Passed to the node directly, in case the extension-level key doesn't reach it.
        ...(transport === 'websocket' ? { apiKey } : {}),
        model: session.model,
        voice: session.voice,
        instructions: joinInstructions(
          session.instructions,
          toolsNote(
            tools.filter((t): t is ToolDef => t.type === 'function'),
            tools.includes(WEB_SEARCH_TOOL)
          )
        ),
        // Always Responses delegation, so tools can be added or removed on a live
        // session. The delegate only runs (and bills) when the model hands it work.
        delegation: 'responses',
        responsesModel: session.delegateModel,
        responsesInstructions: joinInstructions(
          DELEGATE_INSTRUCTIONS,
          session.delegateInstructions
        ),
        tools,
        // A closed session can only be continued if OpenAI stored it.
        store,
      },
    },
    { id: 'liveSplitterNode', type: 'Switchboard.BusSplitter' },
    { id: 'monoToMultiChannelNode', type: 'Switchboard.MonoToMultiChannel' },
    { id: 'mixerNode', type: 'Switchboard.Mixer', configuration: { numberOfInputs: 2 } },
    { id: MEDIA_NODE, type: 'Switchboard.AudioPlayer' },
    { id: MEDIA_VOLUME_NODE, type: 'Switchboard.Gain', properties: { gain: mediaVolume } },
    { id: 'mediaDuckingNode', type: 'Switchboard.MusicDucking', properties: MEDIA_DUCKING }
  )
  chain.push(LIVE_NODE, 'liveSplitterNode', 'monoToMultiChannelNode', 'mixerNode', 'outputNode')
  const connections: object[] = chain.slice(1).map((destinationNode, i) => ({
    sourceNode: chain[i],
    destinationNode,
  }))
  if (idleMode) {
    connections.push({ sourceNode: 'vadSplitterNode', destinationNode: VAD_NODE })
  }
  // The ducking node takes the media on bus 0 and the model's voice on bus 1.
  connections.push(
    { sourceNode: MEDIA_NODE, destinationNode: MEDIA_VOLUME_NODE },
    { sourceNode: MEDIA_VOLUME_NODE, destinationNode: 'mediaDuckingNode', destinationBusIndex: 0 },
    { sourceNode: 'liveSplitterNode', destinationNode: 'mediaDuckingNode', destinationBusIndex: 1 },
    { sourceNode: 'mediaDuckingNode', destinationNode: 'mixerNode', destinationBusIndex: 1 }
  )

  return {
    type: 'Switchboard.Realtime',
    configuration: {
      microphoneEnabled: true,
      // Platform echo cancellation: the model listens while it speaks. On Android the
      // voice-communication input and output pair with the communication mode set on
      // start; the output usage also puts playback on the in-call volume the keys control.
      ...(Platform.OS === 'android'
        ? { inputPreset: 'VOICE_COMMUNICATION', outputUsage: 'USAGE_VOICE_COMMUNICATION' }
        : {
            voiceProcessingEnabled: true,
            ...(otherAudio.mix
              ? { mixWithOthers: true, otherAudioDucking: otherAudio.ducking }
              : {}),
            // The phone's microphone is the engine's A2DP mode.
            ...(microphone === 'phone' ? { allowBluetoothA2DP: true } : {}),
          }),
      graph: {
        config: { sampleRate: GRAPH_SAMPLE_RATE, bufferSize: GRAPH_SAMPLE_RATE / 100 },
        nodes,
        connections,
      },
    },
  }
}

/** The toolkit engine's public surface (what {@link createOpenAILiveToolkit} returns). */
export type OpenAILiveToolkit = ReturnType<typeof createOpenAILiveToolkit>

/**
 * High-level toolkit API.
 *
 * {@link OpenAILiveToolkit.initialize} loads the SDK + extensions,
 * {@link OpenAILiveToolkit.start}/{@link OpenAILiveToolkit.stop} control the engine, and
 * {@link OpenAILiveToolkit.addEventListener} delivers the Live node's events.
 *
 * State lives in closure — no classes, no `this`. The app uses the single
 * {@link openAILiveToolkit} instance below.
 */
export function createOpenAILiveToolkit() {
  let client: SwitchboardClient | null = null
  let engineId: string | null = null
  // engineId = engine exists (kept across stop for reuse); running = started.
  let running = false
  let initialized = false
  let initError: string | null = null
  let nativeSubscribed = false
  let transport: OpenAILiveTransport = 'webrtc'
  let openAIApiKey = ''
  let isolationSupported = false
  let isolationAvailable = false
  let speakerIsolation = true
  let muted = false
  const session = {
    model: DEFAULT_MODEL,
    voice: DEFAULT_VOICE as OpenAIVoice,
    instructions: '',
    delegateModel: DEFAULT_DELEGATE_MODEL,
    delegateInstructions: '',
  }
  const tools = new Map<string, OpenAILiveToolkitTool>()
  // The tools note the current session was given, to tell when a live update is needed.
  let sessionToolsNote = ''
  // The tools note in the instructions last written to the node, which the next session starts with.
  let lastWrittenToolsNote = ''

  const listeners: Record<OpenAILiveToolkitEventType, Set<OpenAILiveToolkitEventListener>> = {
    live: new Set(),
    vad: new Set(),
    media: new Set(),
  }
  const errorListeners = new Set<OpenAILiveErrorListener>()
  // Whether a session is currently up. Decides whether a session failure is fatal:
  // one that arrives with no session is what's keeping it down; one during a live
  // session was survivable.
  let sessionLive = false

  // Idle mode. 0 is off.
  let idleTimeoutMs = 0
  let wakeGraceMs = DEFAULT_WAKE_GRACE_MS
  let continueConversation = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  // The session was closed for idling and reopens when the user speaks.
  let idle = false
  // The latest session, which a wake continues. Null makes the next wake start fresh.
  let lastSessionId: string | null = null
  // The session coming up is a fork of lastSessionId.
  let forking = false
  // Woken by speech the model hasn't answered yet, so the countdown is wakeGraceMs.
  let woken = false
  let userSpeaking = false
  let toolCallsInFlight = 0

  let webSearch = false
  let logConversation = false
  let otherAudio: { mix: boolean; ducking: OtherAudioDucking } = { mix: false, ducking: 'min' }
  let microphone: Microphone = 'phone'
  const NO_MEDIA: Omit<MediaStatus, 'volume'> = {
    url: null,
    station: null,
    state: 'idle',
    playing: false,
    live: false,
    metadata: null,
    error: null,
  }
  let media: MediaStatus = { ...NO_MEDIA, volume: 1 }
  // Called on every media change, to settle waitForMediaToStart.
  const mediaWaiters = new Set<() => void>()
  // Media tools are on: the model can control media and is told what's playing.
  let mediaToolsOn = false
  let mediaStations: MediaStation[] = []
  let mediaAllowUrls = false
  // What the current session was last told is playing.
  let sessionNowPlaying = ''
  // The transcript turn being collected for the log.
  let turnSpeaker: 'user' | 'assistant' | null = null
  let turnText = ''

  function emitError(
    code: OpenAILiveErrorCode,
    message: string,
    fatal: boolean,
    details?: Record<string, unknown>
  ): void {
    log(`error ${code}${fatal ? ' (fatal)' : ''}: ${message}`)
    const error = new OpenAILiveError(code, message, fatal, details)
    errorListeners.forEach((l) => l(error))
  }

  /** Log the transcript a turn at a time: one line per change of speaker. */
  function logTranscript(speaker: 'user' | 'assistant', delta: string): void {
    if (!logConversation) {
      return
    }
    if (speaker !== turnSpeaker) {
      flushTranscript()
      turnSpeaker = speaker
    }
    turnText += delta
  }

  function flushTranscript(): void {
    if (turnSpeaker && turnText.trim() !== '') {
      log(`${turnSpeaker}: ${turnText.trim()}`)
    }
    turnSpeaker = null
    turnText = ''
  }

  /**
   * Load the Switchboard SDK and its extensions with your credentials. Idempotent.
   *
   * Throws only for a caller mistake (a blank Switchboard credential). An SDK-level
   * refusal is recorded in {@link OpenAILiveToolkit.initError} and leaves this
   * uninitialized, so a later `start()` rejects with the reason.
   */
  function initialize(options: OpenAILiveToolkitInitializeOptions): void {
    if (initialized) {
      return
    }
    initError = null
    const appId = options.appId ?? DEFAULT_SWITCHBOARD_APP_ID
    const appSecret = options.appSecret ?? DEFAULT_SWITCHBOARD_APP_SECRET
    if (appId.trim() === '') {
      throw new Error('appId is required')
    }
    if (appSecret.trim() === '') {
      throw new Error('appSecret is required')
    }
    transport = options.transport ?? 'webrtc'
    openAIApiKey = options.openAIApiKey?.trim() ?? ''
    if (transport === 'webrtc' && openAIApiKey !== '') {
      console.warn(
        "[OpenAILiveToolkit] openAIApiKey ignored: the webrtc transport uses the Switchboard app's OpenAI key."
      )
      openAIApiKey = ''
    }
    const licenseKey = options.aiCousticsLicenseKey?.trim() ?? ''
    isolationSupported = NativeOpenAILiveToolkit.isSpeakerIsolationSupported()
    isolationAvailable = isolationSupported && licenseKey !== ''
    if (!isolationSupported && licenseKey !== '') {
      console.warn(
        '[OpenAILiveToolkit] aiCousticsLicenseKey ignored: this build has no AICoustics extension. ' +
          (Platform.OS === 'android'
            ? 'There is no Android build of it yet.'
            : 'Reinstall pods with OPENAI_LIVE_AICOUSTICS=1 to enable speaker isolation.')
      )
    } else if (isolationSupported && licenseKey === '') {
      console.warn(
        '[OpenAILiveToolkit] No aiCousticsLicenseKey provided — running without speaker isolation.'
      )
    }

    session.instructions = options.instructions ?? ''
    session.voice = options.voice ?? DEFAULT_VOICE
    session.model = options.model ?? DEFAULT_MODEL
    session.delegateModel = options.delegateModel ?? DEFAULT_DELEGATE_MODEL
    session.delegateInstructions = options.delegateInstructions ?? ''
    speakerIsolation = options.speakerIsolation ?? true
    idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 0)
    wakeGraceMs = Math.max(0, options.wakeGraceMs ?? DEFAULT_WAKE_GRACE_MS)
    continueConversation = options.continueConversation ?? false
    webSearch = options.webSearch ?? false
    otherAudio = {
      mix: options.mixWithOthers ?? false,
      ducking: options.otherAudioDucking ?? 'min',
    }
    microphone = options.microphone ?? 'phone'
    logConversation = options.logConversation ?? false

    const apiUrl = options.apiUrl?.trim() ?? ''
    const c = ensureClient()
    // Native SDK survives JS reloads — skip re-init if already initialized.
    if (c.getValue('switchboard', 'isInitialized').result !== true) {
      const extensions: Record<string, object> = {
        OpenAI: openAIApiKey === '' ? {} : { apiKey: openAIApiKey },
      }
      if (isolationAvailable) {
        extensions.AICoustics = { licenseKey }
      }
      if (idleTimeoutMs > 0) {
        extensions.Silero = {}
        extensions.Onnx = {}
      }
      const res = c.callAction('switchboard', 'initialize', {
        appID: appId,
        appSecret,
        ...(apiUrl === '' ? {} : { apiURL: apiUrl }),
        extensions,
      })
      if (res.error) {
        initError = `Switchboard initialization failed: ${res.error.message}`
        emitError('INIT_FAILED', initError, true)
        return
      }
    }
    // After the SDK's initialize, which installs the console log destination the file passes lines on to.
    if (options.logFile) {
      startLogFile()
    }
    log(
      `initialize: ${transport}, speaker isolation ${isolationAvailable ? 'available' : 'unavailable'}, ` +
        `idle timeout ${idleTimeoutMs} ms`
    )
    // Re-adopt an engine that survived the reload so start() reuses it.
    const engines = c.getValue('switchboard', 'engines').result
    engineId = Array.isArray(engines) && engines.length > 0 ? String(engines[0]) : null
    running = engineId !== null && c.getValue(engineId, 'isRunning').result === true
    initialized = true
  }

  /**
   * Subscribe to a category of events.
   * @returns a subscription — call `remove()` to stop listening.
   */
  function addEventListener(
    type: OpenAILiveToolkitEventType,
    listener: OpenAILiveToolkitEventListener
  ): OpenAILiveToolkitSubscription {
    listeners[type].add(listener)
    return {
      remove: () => {
        listeners[type].delete(listener)
      },
    }
  }

  /**
   * Subscribe to failures that have no caller to reject: the SDK refusing to
   * initialize, session errors, and tool-call plumbing. Failures from
   * {@link start} / {@link stop} are *not* delivered here — those reject instead.
   */
  function addErrorListener(listener: OpenAILiveErrorListener): OpenAILiveToolkitSubscription {
    errorListeners.add(listener)
    return {
      remove: () => {
        errorListeners.delete(listener)
      },
    }
  }

  /** Request microphone permission; resolves to whether it's granted. Called by {@link start}. */
  async function requestMicrophonePermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
      return result === PermissionsAndroid.RESULTS.GRANTED
    }
    return NativeOpenAILiveToolkit.requestMicrophonePermission()
  }

  /**
   * Android: hold the foreground service and the communication route while the engine runs.
   * Best-effort: without them the conversation still runs in the foreground, with weaker AEC.
   */
  async function startAndroidAudioSession(): Promise<void> {
    // Android 13+ hides the service's notification without this. The conversation runs either way.
    if (Number(Platform.Version) >= 33) {
      try {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
      } catch {
        // Carry on without the notification.
      }
    }
    try {
      await androidModule()?.startAudioSession()
    } catch {
      // Carry on without it.
    }
  }

  function stopAndroidAudioSession(): void {
    androidModule()
      ?.stopAudioSession()
      .catch(() => {})
  }

  /**
   * Request the mic, build the graph, and start the engine (which opens the session).
   * @throws {OpenAILiveError} if not initialized, the `websocket` transport has no API key,
   * the mic is denied, or the engine fails to start.
   */
  async function start(options: OpenAILiveStartOptions = {}): Promise<void> {
    if (!initialized || !client) {
      throw initError
        ? new OpenAILiveError('INIT_FAILED', initError, true)
        : new OpenAILiveError(
            'NOT_INITIALIZED',
            'OpenAILiveToolkit.initialize() must be called before start()',
            true
          )
    }
    if (running) {
      return
    }
    if (transport === 'websocket' && openAIApiKey === '') {
      throw new OpenAILiveError(
        'MISSING_API_KEY',
        'The websocket transport needs an OpenAI API key.',
        true
      )
    }
    const c = client

    if (!(await requestMicrophonePermission())) {
      throw new OpenAILiveError('MIC_PERMISSION_DENIED', 'Microphone permission denied', true)
    }

    // Create the engine once; start/stop reuse it, release() frees it.
    let id = engineId
    if (!id) {
      lastWrittenToolsNote = toolsNote(toolDefs(), webSearch)
      const res = c.callAction(
        'switchboard',
        'createEngine',
        buildLiveEngine(
          transport,
          openAIApiKey,
          delegateTools(),
          session,
          { available: isolationAvailable, enabled: speakerIsolation },
          idleTimeoutMs > 0,
          idleTimeoutMs > 0 || continueConversation,
          otherAudio,
          microphone,
          media.volume
        )
      )
      id = res.result as string
      if (!id) {
        throw new OpenAILiveError(
          'ENGINE_CREATION_FAILED',
          `createEngine failed: ${JSON.stringify(res.error ?? res)}`,
          true
        )
      }
      engineId = id
    }

    // Before the streams open, so AEC engages on the loudspeaker.
    if (Platform.OS === 'android') {
      await startAndroidAudioSession()
    }
    if (options.continueSessionId && !continueConversation) {
      console.warn('[OpenAILiveToolkit] continueSessionId ignored: it needs continueConversation.')
    } else if (options.continueSessionId) {
      lastSessionId = options.continueSessionId
    }
    // With continueConversation the graph start forks the last session. Set even with nothing to
    // fork, so a fork left over from a failed start doesn't apply.
    forking =
      continueConversation &&
      !c.setValue(LIVE_NODE, 'forkSessionId', lastSessionId ?? '').error &&
      lastSessionId !== null
    if (forking) {
      log(`start: forking ${lastSessionId}`)
    }
    const startRes = c.callAction(id, 'start')
    if (startRes.error) {
      if (Platform.OS === 'android') {
        stopAndroidAudioSession()
      }
      throw new OpenAILiveError(
        'ENGINE_START_FAILED',
        `Engine start failed: ${startRes.error.message}`,
        true
      )
    }
    running = true
    log('engine started')
  }

  /**
   * Set the system prompt. GPT-Live fixes it per session, so while running this
   * starts a new session and the conversation so far is dropped. Use
   * {@link appendInstructions} to adjust a live conversation instead.
   */
  function setInstructions(next: string): void {
    session.instructions = next
    // A fork keeps the stored session's instructions, so the next wake starts fresh.
    lastSessionId = null
    if (engineId) {
      lastWrittenToolsNote = toolsNote(toolDefs(), webSearch)
      client?.setValue(LIVE_NODE, 'instructions', liveInstructions())
    }
  }

  /** The live model's instructions: the app's prompt plus the note about the current tools. */
  function liveInstructions(): string {
    return joinInstructions(session.instructions, toolsNote(toolDefs(), webSearch))
  }

  /**
   * Tell the running session about the current tools. The node's instructions are only read
   * when a session starts, so a change is sent as context instead: GPT-Live drops the
   * conversation so far when instructions are appended.
   */
  function syncToolsNote(): void {
    const note = toolsNote(toolDefs(), webSearch)
    if (!sessionLive || note === sessionToolsNote) {
      return
    }
    const text = note === '' ? 'You no longer have any tools.' : `Your tools changed. ${note}`
    if (!client?.callAction(LIVE_NODE, 'appendThinking', { text }).error) {
      sessionToolsNote = note
    }
  }

  /** Add trusted instructions to the live session without restarting it. */
  function appendInstructions(text: string): boolean {
    return !client?.callAction(LIVE_NODE, 'appendInstructions', { text }).error
  }

  /** Give the model quiet context it can use but won't say on its own. */
  function addContext(text: string): boolean {
    return !client?.callAction(LIVE_NODE, 'appendThinking', { text }).error
  }

  /** Give the model something to say aloud (it may paraphrase). */
  function say(text: string): boolean {
    return !client?.callAction(LIVE_NODE, 'appendCommentary', { text }).error
  }

  /**
   * Set the voice. Fixed per session: while running this starts a new session,
   * dropping the conversation so far.
   */
  function setVoice(next: OpenAIVoice): void {
    if (next === session.voice) {
      return
    }
    session.voice = next
    lastSessionId = null
    if (engineId) {
      client?.setValue(LIVE_NODE, 'voice', next)
    }
  }

  /** Turn Quail speaker isolation on or off. Applied live. No-op unless it's available. */
  function setSpeakerIsolation(enabled: boolean): void {
    log(`speaker isolation ${enabled ? 'on' : 'off'}`)
    speakerIsolation = enabled
    if (engineId && isolationAvailable) {
      client?.setValue(ISOLATION_NODE, 'enabled', enabled)
    }
  }

  /**
   * iOS: hear the Bluetooth device's microphone, with call-quality audio, or the phone's, with
   * high-quality Bluetooth audio; see `microphone`. Applied live: audio restarts briefly. No-op
   * on Android.
   */
  function setMicrophone(next: Microphone): void {
    if (Platform.OS !== 'ios') {
      return
    }
    log(`microphone ${next}`)
    microphone = next
    if (engineId) {
      client?.setValue(engineId, 'allowBluetoothA2DP', next === 'phone')
    }
  }

  /**
   * iOS: whether a Bluetooth device is connected: one with a microphone, or one audio goes to.
   * With `microphone: 'bluetooth'` a device without a microphone isn't used, so it isn't reported.
   * Always false on Android.
   */
  function isBluetoothConnected(): boolean {
    return Platform.OS === 'ios' && NativeOpenAILiveToolkit.isBluetoothConnected()
  }

  /** iOS: called with {@link isBluetoothConnected} whenever the audio route changes. */
  function addBluetoothListener(
    listener: (connected: boolean) => void
  ): OpenAILiveToolkitSubscription {
    if (Platform.OS !== 'ios') {
      return { remove: () => {} }
    }
    return NativeOpenAILiveToolkit.onBluetoothChanged(listener)
  }

  /** Stop the model hearing the microphone, or let it hear again. Kept across sessions. */
  function setMuted(next: boolean): void {
    log(next ? 'muted' : 'unmuted')
    muted = next
    if (sessionLive) {
      client?.callAction(LIVE_NODE, next ? 'muteInput' : 'unmuteInput')
    }
  }

  /**
   * Make a tool available to the model. Registering before {@link start} bakes it
   * into the session; while running it updates the delegate live. Re-registering
   * the same `name` replaces it.
   */
  function registerTool(tool: OpenAILiveToolkitTool): void {
    tools.set(tool.name, tool)
    toolsChanged()
  }

  /** Remove a registered tool by name; no-op if it isn't registered. */
  function unregisterTool(name: string): void {
    if (tools.delete(name)) {
      toolsChanged()
    }
  }

  function toolsChanged(): void {
    if (engineId) {
      client?.setValue(LIVE_NODE, 'tools', delegateTools())
      syncToolsNote()
    }
  }

  /** Function definitions for the registered tools (handlers stripped). */
  /** The registered tools, plus web search when it's on. */
  function delegateTools(): DelegateTool[] {
    return webSearch ? [...toolDefs(), WEB_SEARCH_TOOL] : toolDefs()
  }

  function toolDefs(): ToolDef[] {
    return Array.from(tools.values()).map((t) => ({
      type: 'function' as const,
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? { type: 'object', properties: {}, additionalProperties: false },
    }))
  }

  /**
   * Run a tool call and submit the result. The node continues the delegate's
   * response once every call in it has an answer. Failures are non-fatal and go
   * to {@link addErrorListener}.
   */
  async function handleToolCall(call: ToolCall): Promise<void> {
    toolCallsInFlight++
    try {
      await runToolCall(call)
    } finally {
      toolCallsInFlight--
      touch()
    }
  }

  async function runToolCall(call: ToolCall): Promise<void> {
    const tool = tools.get(call.name)
    let action: 'submitToolResult' | 'submitToolError' = 'submitToolResult'
    let params: Record<string, string>
    try {
      if (!tool) {
        throw new Error(`No tool registered for '${call.name}'`)
      }
      const args = call.argumentsJson ? JSON.parse(call.argumentsJson) : {}
      const result = await tool.handler(args)
      params = { callId: call.callId, outputJson: JSON.stringify(result ?? null) }
      log(
        `tool ${call.name} returned${logConversation ? ` ${params.outputJson.slice(0, 200)}` : ''}`
      )
    } catch (err) {
      emitError('TOOL_HANDLER_FAILED', `Tool '${call.name}' failed: ${String(err)}`, false, {
        tool: call.name,
        callId: call.callId,
      })
      action = 'submitToolError'
      params = { callId: call.callId, errorJson: JSON.stringify({ error: String(err) }) }
    }
    const res = client?.callAction(LIVE_NODE, action, params)
    if (res?.error) {
      emitError(
        'TOOL_RESULT_UNDELIVERED',
        `${action} for '${call.name}' failed: ${res.error.message}`,
        false,
        { tool: call.name, callId: call.callId }
      )
    }
  }

  /**
   * Play an MP3 or AAC stream or file from an http(s) URL, such as internet radio, alongside the
   * conversation, replacing what was playing. It ducks while the model talks, and echo cancellation
   * keeps it from the model. Needs a running engine; {@link stop} stops it. Changes arrive as
   * `'media'` events and in {@link mediaStatus}.
   * @throws {OpenAILiveError} `MEDIA_FAILED` if the engine isn't running or the URL isn't http(s).
   */
  function playMedia(url: string): void {
    const refuse = (message: string): never => {
      const error = new OpenAILiveError('MEDIA_FAILED', message, false)
      setMedia({ error })
      throw error
    }
    if (!client || !running) {
      return refuse('Media plays only while the engine runs.')
    }
    if (!/^https?:\/\//i.test(url)) {
      return refuse(`Not an http(s) URL: ${redactUrl(url)}`)
    }
    log(`media: play ${redactUrl(url)}`)
    const res = client.callAction(MEDIA_NODE, 'stream', { audioFilePath: url })
    if (res.error) {
      return refuse(`Could not play ${redactUrl(url)}: ${redactUrls(res.error.message ?? '')}`)
    }
    client.callAction(MEDIA_NODE, 'play')
    setMedia({ ...NO_MEDIA, url, state: 'connecting', playing: true })
  }

  /** Pause media. A live stream resumes close to live. */
  function pauseMedia(): void {
    if (!media.url) {
      return
    }
    log('media: pause')
    client?.callAction(MEDIA_NODE, 'pause')
    setMedia({ playing: false })
  }

  /** Resume paused media; a finished file starts over. */
  function resumeMedia(): void {
    if (!media.url) {
      return
    }
    log('media: resume')
    client?.callAction(MEDIA_NODE, 'play')
    setMedia({ playing: true })
  }

  /** Stop media and close its stream. */
  function stopMedia(): void {
    log('media: stop')
    unloadMedia()
  }

  /** Media volume, 0 to 1, before ducking. Kept across engines. */
  function setMediaVolume(volume: number): void {
    const next = Math.min(1, Math.max(0, volume))
    if (engineId) {
      client?.setValue(MEDIA_VOLUME_NODE, 'gain', next)
    }
    setMedia({ volume: next })
  }

  function unloadMedia(): void {
    if (!media.url) {
      return
    }
    client?.callAction(MEDIA_NODE, 'unload')
    setMedia(NO_MEDIA)
  }

  function setMedia(change: Partial<MediaStatus>): void {
    const next = { ...media, ...change }
    next.station = next.url
      ? (mediaStations.find((st) => st.url === next.url)?.name ??
        (next.metadata?.stationName || null))
      : null
    media = next
    emitMediaEvent('statusChanged', media)
    mediaWaiters.forEach((w) => w())
    syncNowPlaying()
  }

  function emitMediaEvent(name: string, data: unknown): void {
    const event: OpenAILiveToolkitEvent = {
      type: 'media',
      name,
      objectURI: `${engineId}.${MEDIA_NODE}`,
      data,
      raw: '',
    }
    listeners.media.forEach((l) => l(event))
  }

  /** Resolves once the media has started or failed, or after timeoutMs with it still on its way. */
  function waitForMediaToStart(timeoutMs: number): Promise<MediaStatus> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        mediaWaiters.delete(check)
        resolve(media)
      }
      const check = () => {
        // The player says it failed a moment before it says why.
        const pending =
          media.state === 'connecting' ||
          media.state === 'buffering' ||
          (media.state === 'error' && !media.error)
        if (!pending) {
          done()
        }
      }
      const timer = setTimeout(done, timeoutMs)
      mediaWaiters.add(check)
      check()
    })
  }

  /**
   * Let the model control media and know what's playing: registers the media tools (play a
   * station or URL, pause, resume, volume, what's playing) and keeps the session told what's
   * playing, as quiet context. `null` turns them off.
   */
  function setMediaTools(options: MediaToolsOptions | null): void {
    mediaToolsOn = options !== null
    mediaStations = options?.stations ?? []
    mediaAllowUrls = options?.allowUrls ?? false
    MEDIA_TOOL_NAMES.forEach((name) => tools.delete(name))
    if (mediaToolsOn) {
      mediaTools().forEach((t) => tools.set(t.name, t))
    }
    toolsChanged()
    syncNowPlaying()
  }

  function mediaTools(): OpenAILiveToolkitTool[] {
    const names = mediaStations.map((st) => st.name)
    const stationList = mediaStations
      .map((st) => (st.description ? `${st.name} (${st.description})` : st.name))
      .join('; ')
    const play: OpenAILiveToolkitTool = {
      name: 'play_media',
      description:
        'Play a radio station or audio stream, replacing what is playing. ' +
        (names.length > 0
          ? `Stations: ${stationList}. With no station${mediaAllowUrls ? ' or URL' : ''}, plays a different station from the one playing, for "play something else".`
          : 'Needs a stream URL.'),
      parameters: {
        type: 'object',
        properties: {
          ...(names.length > 0
            ? { station: { type: 'string', enum: names, description: 'The station to play.' } }
            : {}),
          ...(mediaAllowUrls
            ? {
                url: {
                  type: 'string',
                  description: 'An http(s) MP3 or AAC stream URL, when the user gives one.',
                },
              }
            : {}),
        },
        additionalProperties: false,
      },
      handler: async ({ station, url }: { station?: string; url?: string }) => {
        if (url && !mediaAllowUrls) {
          return { error: 'Only the listed stations can be played.' }
        }
        if (url && isLocalUrl(url)) {
          return { error: "URLs on the device or a local network can't be played." }
        }
        const target = url ? { url } : pickStation(station)
        if (!target) {
          return {
            error: station ? `There's no station called ${station}.` : 'There is no other station.',
          }
        }
        playMedia(target.url)
        const status = await waitForMediaToStart(MEDIA_START_TIMEOUT_MS)
        if (status.state === 'error') {
          return { error: streamText(status.error?.message ?? "It couldn't be played.") }
        }
        return {
          playing: stationForModel() ?? redactUrl(target.url),
          ...(status.metadata?.title ? { title: streamText(status.metadata.title) } : {}),
          ...(status.state === 'ready' ? {} : { note: 'Still connecting.' }),
        }
      },
    }
    return [
      // Nothing to play without stations or URLs.
      ...(names.length > 0 || mediaAllowUrls ? [play] : []),
      {
        name: 'pause_media',
        description: 'Pause the music or radio that is playing.',
        handler: () => {
          if (!media.url || !media.playing) {
            return { error: 'Nothing is playing.' }
          }
          pauseMedia()
          return { paused: stationForModel() }
        },
      },
      {
        name: 'resume_media',
        description: 'Resume the music or radio after a pause.',
        handler: () => {
          if (!media.url) {
            return { error: 'Nothing is paused; play a station instead.' }
          }
          resumeMedia()
          return { playing: stationForModel() }
        },
      },
      {
        name: 'set_media_volume',
        description:
          'Set how loud the music or radio plays. Give volume for an exact level, or change for ' +
          'louder or quieter.',
        parameters: {
          type: 'object',
          properties: {
            volume: { type: 'number', minimum: 0, maximum: 100, description: 'Volume in percent.' },
            change: {
              type: 'number',
              description: 'Percentage points to add; negative is quieter. About 20 for "a bit".',
            },
          },
          additionalProperties: false,
        },
        handler: ({ volume, change }: { volume?: number; change?: number }) => {
          const percent = volume ?? Math.round(media.volume * 100) + (change ?? 0)
          setMediaVolume(percent / 100)
          return { volume: Math.round(media.volume * 100) }
        },
      },
      {
        name: 'get_now_playing',
        description:
          "What's playing: the station, the song or show, whether it's paused, and the volume.",
        handler: () => ({
          state: !media.url
            ? 'stopped'
            : media.state === 'error'
              ? 'failed'
              : media.playing
                ? 'playing'
                : 'paused',
          station: stationForModel(),
          title: media.metadata?.title ? streamText(media.metadata.title) : null,
          volume: Math.round(media.volume * 100),
        }),
      },
    ]
  }

  /** The station called `name`, or with no name, the next one after what's playing. */
  function pickStation(name?: string): MediaStation | undefined {
    if (name) {
      return mediaStations.find((st) => st.name.toLowerCase() === name.toLowerCase())
    }
    const others = mediaStations.filter((st) => st.url !== media.url)
    const current = mediaStations.findIndex((st) => st.url === media.url)
    return mediaStations.slice(current + 1).find((st) => st.url !== media.url) ?? others[0]
  }

  /** What the model is told is playing. */
  /** The station as the model is told it: the app's name for it, or the stream's, quoted. */
  function stationForModel(): string | null {
    if (!media.station) {
      return null
    }
    return mediaStations.some((st) => st.url === media.url)
      ? media.station
      : `"${streamText(media.station)}"`
  }

  function nowPlayingNote(): string {
    const station = stationForModel() ?? 'A stream'
    const title = media.metadata?.title ? `"${streamText(media.metadata.title)}"` : ''
    if (!media.url) {
      return 'The music stopped; nothing is playing.'
    }
    if (media.state === 'error') {
      return `Nothing is playing: ${station} couldn't be played.`
    }
    if (media.state === 'finished') {
      return `${station} finished playing.`
    }
    if (!media.playing) {
      return `${station} is paused.`
    }
    return title ? `Now playing on ${station}: ${title}.` : `Now playing: ${station}.`
  }

  /** Tell the session what's playing when that changed, as context it won't say on its own. */
  function syncNowPlaying(): void {
    if (!mediaToolsOn || !sessionLive) {
      return
    }
    // Wait to say it plays until it does, or fails.
    if (media.playing && (media.state === 'connecting' || media.state === 'buffering')) {
      return
    }
    const note = nowPlayingNote()
    // A session that was never told something plays doesn't need to hear that nothing does.
    if (note === sessionNowPlaying || (sessionNowPlaying === '' && !media.url)) {
      return
    }
    if (!client?.callAction(LIVE_NODE, 'appendThinking', { text: note }).error) {
      sessionNowPlaying = note
    }
  }

  /**
   * Halt the graph. Returns the SDK's message if it refused, else null — `running`
   * only goes false when the graph actually stopped.
   */
  function haltGraph(): string | null {
    if (client && engineId && running) {
      const res = client.callAction(engineId, 'stop')
      if (res.error) {
        return res.error.message ?? 'unknown error'
      }
      // Media only plays with the engine, and a stream left open keeps downloading.
      unloadMedia()
      // Only once the graph is down: while it runs, the communication route keeps AEC engaged.
      if (Platform.OS === 'android') {
        stopAndroidAudioSession()
      }
      flushTranscript()
      log('engine stopped')
    }
    running = false
    sessionLive = false
    resetIdle()
    // Otherwise kept for the next start to fork.
    if (!continueConversation) {
      lastSessionId = null
    }
    return null
  }

  /** (Re)start the idle countdown. Anything that shows the conversation is going calls this. */
  function touch(): void {
    if (idleTimeoutMs <= 0 || idle || !running) {
      return
    }
    const timeoutMs =
      woken && wakeGraceMs > 0 ? Math.min(wakeGraceMs, idleTimeoutMs) : idleTimeoutMs
    // JS timers stop while an Android app is in the background, so the countdown runs natively there.
    const android = Platform.OS === 'android' ? androidModule() : undefined
    if (android) {
      android.setIdleTimer(timeoutMs).then((fired) => {
        if (fired) {
          goIdle()
        }
      })
      return
    }
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    idleTimer = setTimeout(goIdle, timeoutMs)
  }

  /** The model answered a wake, so it was the user: back to the full timeout. */
  function engaged(): void {
    woken = false
    touch()
  }

  /** Close a session nobody has talked in for {@link idleTimeoutMs}. */
  function goIdle(): void {
    idleTimer = null
    // A session that isn't up bills nothing; the next sessionStarted restarts the countdown.
    if (!sessionLive) {
      return
    }
    if (userSpeaking || toolCallsInFlight > 0) {
      touch()
      return
    }
    if (client?.callAction(LIVE_NODE, 'endSession').error) {
      touch()
      return
    }
    flushTranscript()
    log('idle: session ended')
    idle = true
    woken = false
    sessionLive = false
    // The node reports no sessionClosed for a session it was told to end, so say it here.
    const event: OpenAILiveToolkitEvent = {
      type: 'live',
      name: 'sessionEnded',
      objectURI: `${engineId}.${LIVE_NODE}`,
      data: undefined,
      raw: '',
    }
    listeners.live.forEach((l) => l(event))
  }

  /** The user spoke into an idle session: reopen it, continuing the conversation if there is one. */
  function wake(): void {
    // A muted model wouldn't hear them anyway.
    if (muted) {
      return
    }
    idle = false
    woken = true
    forking = lastSessionId !== null
    log(forking ? `wake: forking ${lastSessionId}` : 'wake: new session')
    client?.callAction(LIVE_NODE, 'startSession', forking ? { forkSessionId: lastSessionId } : {})
  }

  function resetIdle(): void {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    if (idleTimeoutMs > 0 && Platform.OS === 'android') {
      androidModule()?.cancelIdleTimer()
    }
    idle = false
    woken = false
    forking = false
    userSpeaking = false
  }

  /**
   * Forget the conversation, so the next session starts fresh. A session that's up is replaced
   * by a new one now; one closed by idle mode reopens fresh on the next wake.
   */
  function newConversation(): void {
    lastSessionId = null
    forking = false
    if (!client || !running || idle) {
      return
    }
    log('new conversation')
    client.callAction(LIVE_NODE, 'resetSession')
  }

  /**
   * Stop the engine (closing the session), keeping it for a fast restart via
   * {@link start}, which continues the conversation with `continueConversation`. {@link release} frees it.
   * @throws {OpenAILiveError} if the engine refuses to stop.
   */
  function stop(): void {
    const failure = haltGraph()
    if (failure) {
      throw new OpenAILiveError('ENGINE_STOP_FAILED', `Engine stop failed: ${failure}`, true)
    }
  }

  /** Stop and free the engine. The next {@link start} rebuilds it, with a new conversation. */
  function release(): void {
    haltGraph()
    lastSessionId = null
    if (client && engineId) {
      client.callAction('switchboard', 'destroyEngine', { engineID: engineId })
      engineId = null
      running = false
    }
  }

  function ensureClient(): SwitchboardClient {
    if (!client) {
      client = new SwitchboardClient(new NativeModuleRPCClient())
    }
    if (!nativeSubscribed) {
      client.setEventReceivedCallback((raw) => dispatch(raw))
      client.addEventListener('*', '*')
      nativeSubscribed = true
    }
    return client
  }

  /** Parse a raw native event, classify by source node, and fan out. */
  function dispatch(raw: string): void {
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const e = parsed?.params ?? parsed
    const objectURI: string = e?.objectURI ?? ''
    // A graph node's URI arrives dotted (e.g. "<engine>.liveNode"), so classify by the last segment.
    const nodeId = objectURI.split('.').pop() ?? ''
    const type = NODE_EVENT_TYPE[nodeId]
    if (!type) {
      return
    }
    const event: OpenAILiveToolkitEvent = {
      type,
      name: e?.name ?? e?.eventName ?? '',
      objectURI,
      data: e?.data,
      timestamp: e?.timestamp,
      raw,
    }
    if (type === 'vad') {
      handleVadEvent(event.name)
      listeners.vad.forEach((l) => l(event))
      return
    }
    if (type === 'media') {
      handleMediaEvent(event)
      listeners.media.forEach((l) => l(event))
      return
    }
    switch (event.name) {
      case 'toolCall': {
        const call = event.data as ToolCall
        flushTranscript()
        log(`tool call ${call.name}${logConversation ? ` ${call.argumentsJson ?? ''}` : ''}`)
        woken = false
        handleToolCall(call)
        break
      }
      case 'sessionStarted':
        sessionLive = true
        lastSessionId = (event.data as { sessionId?: string } | undefined)?.sessionId || null
        log(`session started ${lastSessionId}${forking ? ' (fork)' : ''}`)
        // Every session starts unmuted; carry the app's choice over.
        if (muted) {
          client?.callAction(LIVE_NODE, 'muteInput')
        }
        // A new session reads the instructions last written to the node, while a fork knows what
        // the session it continues was told. Either way, bring its tools note up to date.
        if (!forking) {
          sessionToolsNote = lastWrittenToolsNote
          sessionNowPlaying = ''
        }
        forking = false
        syncToolsNote()
        syncNowPlaying()
        touch()
        break
      // An "mm" from a noise restarts the countdown but doesn't show the model was talked to.
      case 'inputTranscriptDelta':
        logTranscript('user', (event.data as { delta?: string } | undefined)?.delta ?? '')
        touch()
        break
      case 'outputTranscriptDelta':
        logTranscript('assistant', (event.data as { delta?: string } | undefined)?.delta ?? '')
        engaged()
        break
      case 'delegationCreated':
        flushTranscript()
        log(`delegation ${JSON.stringify(event.data ?? {})}`)
        engaged()
        break
      case 'sessionStarting':
      case 'sessionDisconnected':
      case 'sessionClosed':
        flushTranscript()
        log(`${event.name}${event.data ? ` ${JSON.stringify(event.data)}` : ''}`)
        sessionLive = false
        break
      case 'error': {
        const data = event.data as { type?: string; message?: string } | undefined
        const message = data?.message
        // A fork that fails, refused or over WebRTC as a failed connection, isn't fatal: the node
        // starts a new session instead.
        const forkFailed = forking && !sessionLive
        if (forkFailed) {
          forking = false
        }
        emitError(
          'SESSION_FAILED',
          message?.trim() ? message : `Session error: ${event.raw}`,
          !sessionLive && !forkFailed,
          { raw }
        )
        break
      }
    }
    listeners[type].forEach((l) => l(event))
  }

  function handleMediaEvent(event: OpenAILiveToolkitEvent): void {
    switch (event.name) {
      case 'stateChanged': {
        const state = (event.data as { state: MediaState }).state
        log(`media: ${state}`)
        setMedia({
          state,
          // Known once the server answers.
          ...(state === 'ready'
            ? { live: client?.getValue(MEDIA_NODE, 'isLive').result === true }
            : {}),
          ...(state === 'finished' || state === 'error' ? { playing: false } : {}),
        })
        break
      }
      case 'metadata':
        log(`media: now playing ${JSON.stringify(event.data ?? {})}`)
        setMedia({ metadata: event.data as MediaMetadata })
        break
      case 'error': {
        const message = (event.data as { message?: string } | undefined)?.message
        const error = new OpenAILiveError(
          'MEDIA_FAILED',
          message?.trim() ? redactUrls(message) : 'Media failed',
          false
        )
        setMedia({ error })
        emitError(error.code, error.message, false)
        break
      }
    }
  }

  function handleVadEvent(name: string): void {
    if (name === 'speechStarted') {
      userSpeaking = true
      if (idle) {
        wake()
      }
    } else if (name === 'speechEnded') {
      userSpeaking = false
      touch()
    }
  }

  return {
    initialize,
    addEventListener,
    addErrorListener,
    requestMicrophonePermission,
    start,
    setInstructions,
    appendInstructions,
    addContext,
    say,
    setVoice,
    setSpeakerIsolation,
    setMicrophone,
    isBluetoothConnected,
    addBluetoothListener,
    setMuted,
    registerTool,
    unregisterTool,
    playMedia,
    pauseMedia,
    resumeMedia,
    stopMedia,
    setMediaVolume,
    setMediaTools,
    stop,
    release,
    newConversation,
    shareLogs,
    /** Whether the engine is started (between {@link start} and {@link stop}). */
    get isRunning(): boolean {
      return running
    },
    /** Where the media is. */
    get mediaStatus(): MediaStatus {
      return media
    },
    /** Whether idle mode closed the session; it reopens when the user speaks. */
    get isIdle(): boolean {
      return idle
    },
    /** Whether this build links the AICoustics extension. Known after {@link initialize}. */
    get isSpeakerIsolationSupported(): boolean {
      return isolationSupported
    },
    /** Whether the graph includes speaker isolation: a supported build and a license key. */
    get isSpeakerIsolationAvailable(): boolean {
      return isolationAvailable
    },
    /** Why the last {@link initialize} was refused by the SDK, or null. */
    get initError(): string | null {
      return initError
    },
  }
}

/**
 * The app-wide toolkit engine — one voice pipeline per app. Internal to the package:
 * {@link OpenAILiveToolkitProvider} wraps this single instance and exposes it through
 * context. Not part of the public API.
 */
export const openAILiveToolkit = createOpenAILiveToolkit()
