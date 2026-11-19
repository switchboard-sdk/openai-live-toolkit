import { AppState, PermissionsAndroid, Platform } from 'react-native'
import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'
import { androidModule } from './androidModule'
import { cachePath, log, setLogListener, shareLogs, startLogFile } from './logs'
import {
  backgroundTimeout,
  isNetworkAvailable,
  onAudioFocusChanged,
  onNetworkChanged,
  synthesizeSpeech,
} from './platform'
import { NativeModuleRPCClient } from './NativeModuleRPCClient'
import { SwitchboardClient } from './SwitchboardClient'
import { DEFAULT_DELEGATE_MODEL, DEFAULT_MODEL, DEFAULT_VOICE, type OpenAIVoice } from './voice'
import { DEFAULT_SWITCHBOARD_APP_ID, DEFAULT_SWITCHBOARD_APP_SECRET } from './credentials'
import {
  OpenAILiveError,
  appRefusedHint,
  asLiveError,
  microphoneDenied,
  type OpenAILiveErrorCode,
} from './errors'
import type { FeatureGraph, FeatureHost, ToolkitFeature } from './feature'
import { createMedia } from './media/media'
import type { MediaOptions } from './media/types'

export { OpenAILiveError, type OpenAILiveErrorCode }

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
  /** Switchboard app ID. Optional: falls back to the demo credentials, which are rotated regularly. */
  appId?: string
  /** Switchboard app secret. Optional, with the same fallback as {@link appId}. */
  appSecret?: string
  /** Switchboard backend URL. Defaults to production. */
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
   * With {@link logFile}: keep this many seconds of audio from the microphone, what the model
   * hears and the output, which {@link shareLogs} zips with the log. Each takes about 0.4 MB of
   * memory per second. Off by default.
   */
  diagnosticAudioSeconds?: number
  /**
   * Play alongside other apps' audio, like music, instead of stopping it. Off by default. On iOS,
   * voice processing still lowers that audio; see {@link otherAudioDucking}. On Android the system
   * lowers it while the engine runs.
   */
  mixWithOthers?: boolean
  /**
   * iOS 17+, with {@link mixWithOthers}: how far voice processing lowers other apps' audio, and
   * only while someone talks. `'default'` keeps the system's ducking. Defaults to `'min'`.
   */
  otherAudioDucking?: OtherAudioDucking
  /**
   * Media playing alongside the conversation from an http(s) URL, such as radio, mixed with the
   * model's voice and ducked while it talks: `true`, or its settings. Off by default, with no
   * media nodes in the graph.
   */
  media?: boolean | MediaOptions
  /**
   * iOS, with {@link mixWithOthers}: lower other apps' audio while a session is open where voice
   * processing doesn't (Bluetooth, or the speaker with {@link echoCancelledInput}). iOS pauses the
   * app that plays for each change, so they're lowered only while the app plays again what plays,
   * such as the Music app it controls (`setOtherAudioResumable` and `addOtherAppsDuckListener`),
   * and raising them waits while another app plays. Off by default.
   */
  duckOtherApps?: boolean
  /**
   * iOS 18.2+: on iPhones that support it (2024 and later models), cancel the speaker's echo
   * through the audio session instead of voice processing, so a Bluetooth device connecting
   * doesn't restart audio. There's no automatic gain control, and other apps' audio isn't lowered
   * on the speaker; {@link duckOtherApps} lowers it there. Other iPhones use voice
   * processing. Needs an SDK with `prefersEchoCancelledInput`. Off by default.
   */
  echoCancelledInput?: boolean
  /**
   * When the network is gone for a few seconds, or a session can't be reached for longer, say so
   * with the device's voice (on Android, its text-to-speech engine if it has one), and again once
   * it's back; reconnect as soon as the network is back and play media that stopped meanwhile
   * again. The model is told how long it was offline. Media is lowered while the device speaks.
   * `true` says it in English. Off by default.
   */
  offlineNotice?: boolean | OfflineNotice
  /**
   * iOS, with a Bluetooth headset, car or speaker connected: which microphone the model hears.
   * `'phone'` (default) plays over Bluetooth in high quality (A2DP); `'bluetooth'` uses the
   * device's microphone, with call-quality audio (HFP), and leaves a device without a microphone
   * unused. See {@link OpenAILiveToolkit.setMicrophone}. Android always uses the device's.
   */
  microphone?: Microphone
}

export type OtherAudioDucking = 'default' | 'min' | 'mid' | 'max'

/** What the device says when the model can't be reached, and once it's back. */
export interface OfflineNotice {
  /** Said once the connection is lost. */
  offline: string
  /** Said once it's back. */
  online: string
  /** The device voice's language, e.g. `'en-US'`. */
  language: string
}

/** The microphone the model hears while a Bluetooth device is connected. */
export type Microphone = 'bluetooth' | 'phone'

/**
 * The categories of event the toolkit surfaces, one per graph node it listens to. `'vad'`
 * (speechStarted / speechEnded) is only there in idle mode or with media.
 */
export type OpenAILiveToolkitEventType = 'live' | 'vad'

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

/**
 * After a change to other apps' ducking: whether they're lowered now, and whether they can play,
 * which they can't while the app's media keeps the engine from mixing.
 */
export type OtherAppsDuckListener = (ducked: boolean, othersCanPlay: boolean) => void

/**
 * How loud the user and the model are, from 0 to 1 on a decibel scale: the RMS over the last
 * 100 ms, with -60 dBFS and below at 0 and 0 dBFS at 1, so speech sits around 0.5–0.7. `input` is
 * what the model hears, after speaker isolation; `output` is the model's voice, before the voice
 * volume.
 */
export interface VoiceLevels {
  input: number
  output: number
}

/** Handler for {@link OpenAILiveToolkit.addVoiceLevelListener}. */
export type VoiceLevelListener = (levels: VoiceLevels) => void

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
// The model's voice, for the output meter and features to tap.
const LIVE_SPLITTER_NODE = 'liveSplitterNode'
const ISOLATION_NODE = 'speakerIsolationNode'
const VAD_NODE = 'vadNode'
// Recorders for diagnosticAudioSeconds, by the name of their file.
const DIAGNOSTIC_RECORDERS = {
  mic: 'micRecorderNode',
  heard: 'heardRecorderNode',
  output: 'outputRecorderNode',
} as const
// Plays what the device says when the model can't be reached, next to the model's voice.
const NOTICE_NODE = 'noticePlayerNode'
const VOICE_VOLUME_NODE = 'voiceVolumeNode'
const LIMITER_NODE = 'limiterNode'
// Meters for voice levels: what the model hears, after isolation, and the model's voice before
// the volume. The input one hangs off its own splitter.
const INPUT_SPLITTER_NODE = 'inputSplitterNode'
const INPUT_METER_NODE = 'inputMeterNode'
const OUTPUT_METER_NODE = 'outputMeterNode'
const VOICE_LEVEL_INTERVAL_MS = 50
// The model speaks well below music: about -25 LUFS, against -10 to -18 for radio. Voice volume
// goes up to +12 dB, and the default, half, is +6 dB. The limiter keeps the peaks from clipping.
const MAX_VOICE_GAIN = 4
const DEFAULT_VOICE_VOLUME = 0.5

// The graph's node IDs → event category, used to split the single native event stream.
const NODE_EVENT_TYPE: Record<string, OpenAILiveToolkitEventType> = {
  [LIVE_NODE]: 'live',
  [VAD_NODE]: 'vad',
}

// The graph runs at 48 kHz; Quail wants 16 kHz, so it sits between two resamplers.
const GRAPH_SAMPLE_RATE = 48000
const QUAIL_SAMPLE_RATE = 16000
const QUAIL_MODEL = 'quail_vf_2_1_l_16khz_8xope536_v11.aicmodel'
const DEFAULT_WAKE_GRACE_MS = 5_000

// How long the engine takes to mix with other apps again, before another app may play; one that
// plays while the engine doesn't mix would interrupt the conversation's audio.
const MIX_RESTORE_MS = 500
// The network gone this long, or a session down this long, and the user is told.
const OFFLINE_GRACE_MS = 3_000
const SESSION_DOWN_MS = 10_000
// The longest a notice may take.
const NOTICE_TIMEOUT_MS = 15_000
const DEFAULT_OFFLINE_NOTICE: OfflineNotice = {
  offline: "I've lost the connection. I'll be back when it returns.",
  online: "We're back online.",
  language: 'en-US',
}

// GPT-Live only delegates work it knows can be done, and the tools live in the delegate's config,
// so the live model is told about them; the delegate is told to call them rather than say it did.
const DELEGATE_INSTRUCTIONS =
  "You carry out actions in the user's app. When a request matches one of your tools, call the " +
  'tool; never claim an action is done without calling it.'

// Otherwise GPT-Live reads notes out as a session opens and works them into unrelated replies.
export const CONTEXT_INSTRUCTIONS =
  "You're given notes during the conversation, like what's playing or where the user is. They're " +
  "background: don't read them out, mention them or speak because of them unless the user asks."

/**
 * What the live model is told about the registered tools, with the features' lines about theirs.
 * Empty with no tools.
 */
export function toolsNote(
  tools: readonly { name: string; description: string }[],
  webSearch = false,
  featureNotes: readonly string[] = []
): string {
  const parts: string[] = []
  if (tools.length > 0) {
    // GPT-Live otherwise often says it did or will do something and doesn't delegate.
    parts.push(
      "You can't change anything in the app yourself: only delegating does. When the user asks " +
        'for something your tools do, delegate it right away, every time, also when asked again ' +
        'or right after doing it. Until the result comes, say a word at most, like "Sure". Never ' +
        "say it's done, or that you'll do it, without delegating: saying so changes nothing."
    )
  }
  // GPT-Live otherwise takes "speak up" as a way of speaking and only says it's louder.
  if (tools.some((t) => t.name === 'set_voice_volume')) {
    parts.push(
      '"Speak up", "talk louder" or "quieter" and "I can\'t hear you" are about the volume ' +
        "setting of your voice, which only set_voice_volume changes: you can't speak louder " +
        'yourself. Delegate them to set_voice_volume every time.'
    )
  }
  parts.push(...featureNotes)
  if (tools.length > 0) {
    const list = tools.map((t) => `${t.name} (${t.description})`).join('; ')
    parts.push(`Your tools: ${list}.`)
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

// GPT-Live refuses context over 500 tokens in one append. Even at 3 characters a token, pieces this
// long stay under it.
const MAX_CONTEXT_CHARS = 1200

const TOOLS_CONTINUED = 'Your tools, continued: '

/** Text cut into pieces of at most `max` characters, after a "; " or ". " where it can. */
export function splitContext(text: string, max = MAX_CONTEXT_CHARS): string[] {
  const pieces: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const head = rest.slice(0, max)
    const cut = Math.max(head.lastIndexOf('; '), head.lastIndexOf('. '))
    const end = cut > 0 ? cut + 1 : max
    pieces.push(rest.slice(0, end).trim())
    rest = rest.slice(end).trim()
  }
  if (rest !== '') {
    pieces.push(rest)
  }
  return pieces
}

/**
 * The Switchboard graph the toolkit runs:
 * microphone → mono → [Quail speaker isolation] → OpenAI.Live → volume → mixer → limiter → speaker.
 * The model owns turn-taking. In idle mode a VAD taps the input the model hears, only to
 * tell when the user starts talking again. Features, such as media, add their nodes and play into
 * the mixer; as part of the output, echo cancellation keeps them from the model.
 */
function buildLiveEngine(
  transport: OpenAILiveTransport,
  apiKey: string,
  tools: DelegateTool[],
  toolsNoteText: string,
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
  voiceProcessing: boolean,
  echoCancelledInput: boolean,
  voiceVolume: number,
  features: FeatureGraph[],
  notices: boolean,
  diagnosticSeconds: number
) {
  const nodes: object[] = [{ id: 'multiChannelToMonoNode', type: 'Switchboard.MultiChannelToMono' }]
  const chain = ['inputNode', 'multiChannelToMonoNode']
  // Pass-through recorders, placed in the chain below.
  const recorders = (diagnosticSeconds > 0 ? Object.values(DIAGNOSTIC_RECORDERS) : []).map(
    (id) => ({
      id,
      type: 'Switchboard.DiagnosticRecorder',
      configuration: { sampleSeconds: Math.round(diagnosticSeconds) },
    })
  )
  nodes.push(...recorders)
  const recorder = (id: string) => (recorders.length > 0 ? [id] : [])
  chain.push(...recorder(DIAGNOSTIC_RECORDERS.mic))
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
  // Idle mode wakes on speech; features such as media follow it too.
  const vad = idleMode || features.some((f) => f.userSpeech)
  if (vad) {
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
    { id: INPUT_SPLITTER_NODE, type: 'Switchboard.BusSplitter' },
    { id: INPUT_METER_NODE, type: 'Switchboard.VUMeter' },
    { id: OUTPUT_METER_NODE, type: 'Switchboard.VUMeter' }
  )
  chain.push(INPUT_SPLITTER_NODE)
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
        instructions: joinInstructions(session.instructions, CONTEXT_INSTRUCTIONS, toolsNoteText),
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
    { id: LIVE_SPLITTER_NODE, type: 'Switchboard.BusSplitter' },
    { id: 'monoToMultiChannelNode', type: 'Switchboard.MonoToMultiChannel' },
    {
      id: VOICE_VOLUME_NODE,
      type: 'Switchboard.Gain',
      properties: { gain: voiceVolume * MAX_VOICE_GAIN },
    },
    { id: LIMITER_NODE, type: 'Switchboard.Limiter' }
  )
  // What plays next to the model's voice, which is the mixer's first input.
  const mixerInputs = features.flatMap((f) => f.mixerInputs)
  if (notices) {
    nodes.push({ id: NOTICE_NODE, type: 'Switchboard.AudioPlayer' })
    mixerInputs.push(NOTICE_NODE)
  }
  nodes.push({
    id: 'mixerNode',
    type: 'Switchboard.Mixer',
    configuration: { numberOfInputs: 1 + mixerInputs.length },
  })
  chain.push(
    ...recorder(DIAGNOSTIC_RECORDERS.heard),
    LIVE_NODE,
    LIVE_SPLITTER_NODE,
    'monoToMultiChannelNode',
    VOICE_VOLUME_NODE,
    'mixerNode',
    LIMITER_NODE,
    ...recorder(DIAGNOSTIC_RECORDERS.output),
    'outputNode'
  )
  const connections: object[] = chain.slice(1).map((destinationNode, i) => ({
    sourceNode: chain[i],
    destinationNode,
  }))
  if (vad) {
    connections.push({ sourceNode: 'vadSplitterNode', destinationNode: VAD_NODE })
  }
  connections.push(
    { sourceNode: INPUT_SPLITTER_NODE, destinationNode: INPUT_METER_NODE },
    { sourceNode: LIVE_SPLITTER_NODE, destinationNode: OUTPUT_METER_NODE }
  )
  for (const feature of features) {
    nodes.push(...feature.nodes)
    connections.push(...feature.connections)
  }
  connections.push(
    ...mixerInputs.map((sourceNode, i) => ({
      sourceNode,
      destinationNode: 'mixerNode',
      destinationBusIndex: i + 1,
    }))
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
            voiceProcessingEnabled: voiceProcessing,
            ...(echoCancelledInput ? { prefersEchoCancelledInput: true } : {}),
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
  let demoCredentials = false
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
  const voiceLevelListeners = new Set<VoiceLevelListener>()
  let voiceLevelTimer: ReturnType<typeof setInterval> | null = null
  let cancelIdleTimer: (() => void) | null = null
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
  // Calls whose tool event hasn't arrived: callId → tool name. The Live node emits a tool's own
  // event after toolCall, for the tools it was created with.
  const toolEventsDue = new Map<string, string>()

  let webSearch = false
  let logConversation = false
  let otherAudio: { mix: boolean; ducking: OtherAudioDucking } = { mix: false, ducking: 'min' }
  let duckOtherApps = false
  let echoCancelledInput = false
  let diagnosticAudioSeconds = 0
  // What happened while recording, at the mic recorder's frame count, for the label track.
  let audioLabels: { frames: number; text: string }[] = []
  let routeSubscription: OpenAILiveToolkitSubscription | null = null
  let offlineNotice: OfflineNotice | null = null
  let networkSubscription: OpenAILiveToolkitSubscription | null = null
  let audioFocusSubscription: OpenAILiveToolkitSubscription | null = null
  let networkUp = true
  let cancelOfflineTimer: (() => void) | null = null
  // When the user was told the connection is gone; null while it isn't.
  let offlineSince: number | null = null
  // What the next session is told about the time offline.
  let offlineNote: string | null = null
  // Settles the notice that's playing.
  let noticeFinished: (() => void) | null = null
  // What the native side was last asked: other apps lowered while a session is open.
  let otherAppsDuckWanted = false
  // Whether other apps are lowered, as the native side last reported.
  let otherAppsDucked = false
  let otherAppsDuckSubscription: OpenAILiveToolkitSubscription | null = null
  let otherAudioResumable = false
  const otherAppsDuckListeners = new Set<OtherAppsDuckListener>()
  // A feature, such as media holding Now Playing, keeps other apps' audio from playing.
  let otherAudioKeptOut = false
  let microphone: Microphone = 'phone'
  let voiceProcessing = true
  let voiceVolume = DEFAULT_VOICE_VOLUME
  const voiceVolumeListeners = new Set<(volume: number) => void>()
  // The app's notes by key, and what the current session was told under each.
  const sessionNotes = new Map<string, { text: string; onlyUpdate: boolean }>()
  const notesTold = new Map<string, string>()
  // The transcript turn being collected for the log.
  let turnSpeaker: 'user' | 'assistant' | null = null
  let turnText = ''

  function emitError(
    code: OpenAILiveErrorCode,
    message: string,
    fatal: boolean,
    details?: Record<string, unknown>
  ): void {
    reportError(new OpenAILiveError(code, message, fatal, details))
  }

  /** Log a failure and pass it to the error listeners. */
  function reportError(error: OpenAILiveError): void {
    log(`error ${error.code}${error.fatal ? ' (fatal)' : ''}: ${error.message}`)
    errorListeners.forEach((l) => l(error))
  }

  // iOS: the engine's output port, such as 'Speaker' or 'Headphones', once it reports its route.
  let outputPort: string | null = null

  /** Whether audio plays on the loudspeaker. Assumed until the route says otherwise. */
  function isOnSpeaker(): boolean {
    if (Platform.OS === 'android') {
      return androidModule()?.isOnSpeaker() ?? true
    }
    return outputPort === null || outputPort === 'Speaker'
  }

  const host: FeatureHost = {
    client: () => client,
    engineId: () => engineId,
    isRunning: () => running,
    isSessionLive: () => sessionLive,
    isOffline: () => !networkUp || offlineSince !== null,
    addContext: (text) => addContext(text),
    updateTools: (update) => {
      update(tools)
      toolsChanged()
    },
    keepOtherAudioOut,
    isOtherAudioKeptOut: () => otherAudioKeptOut,
    voiceVolume: () => voiceVolume,
    isOnSpeaker,
    reportError,
  }
  const media = createMedia(host)
  const features: ToolkitFeature[] = [media.feature]

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
    demoCredentials = appId === DEFAULT_SWITCHBOARD_APP_ID
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
    duckOtherApps = Platform.OS === 'ios' && (options.duckOtherApps ?? false)
    if (duckOtherApps && !otherAppsDuckSubscription) {
      otherAppsDuckSubscription =
        NativeOpenAILiveToolkit.onOtherAppsDuckChanged(handleOtherAppsDuck)
    }
    echoCancelledInput = Platform.OS === 'ios' && (options.echoCancelledInput ?? false)
    diagnosticAudioSeconds = options.logFile ? (options.diagnosticAudioSeconds ?? 0) : 0
    setLogListener(diagnosticAudioSeconds > 0 ? labelAudio : null)
    // Route changes are logged natively, out of the listener's reach.
    if (diagnosticAudioSeconds > 0 && !routeSubscription) {
      routeSubscription = NativeOpenAILiveToolkit.onBluetoothChanged((connected) =>
        labelAudio(`audio route changed${connected ? ', Bluetooth connected' : ''}`)
      )
    }
    offlineNotice = !options.offlineNotice
      ? null
      : options.offlineNotice === true
        ? DEFAULT_OFFLINE_NOTICE
        : options.offlineNotice
    if (offlineNotice && !networkSubscription) {
      networkUp = isNetworkAvailable()
      networkSubscription = onNetworkChanged(handleNetwork)
    }
    // Logged, and so labelled on the recordings.
    audioFocusSubscription ??= onAudioFocusChanged((change) => log(`audio focus: ${change}`))
    media.configure(options.media)
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
    const sdkVersion = c.getValue('switchboard', 'versionName').result
    const sdkBuild = c.getValue('switchboard', 'buildNumber').result
    log(
      `initialize: ${transport}, speaker isolation ${isolationAvailable ? 'available' : 'unavailable'}, ` +
        `idle timeout ${idleTimeoutMs} ms, SDK ${sdkVersion ?? '?'} (${sdkBuild ?? '?'})`
    )
    // An engine that survived the reload: a running one is adopted, keeping the settings it was
    // built with until release(); an idle one is dropped, so start() builds one with these.
    const engines = c.getValue('switchboard', 'engines').result
    const leftover = Array.isArray(engines) && engines.length > 0 ? String(engines[0]) : null
    running = leftover !== null && c.getValue(leftover, 'isRunning').result === true
    engineId = running ? leftover : null
    if (leftover && !running) {
      log('initialize: dropping an idle engine from before the reload')
      c.callAction('switchboard', 'destroyEngine', { engineID: leftover })
    }
    initialized = true
  }

  function readLevel(node: string): number {
    // Silence reads as -Infinity, or null once it has been through JSON.
    const dbfs = client?.getValue(node, 'levelDBFS').result
    if (typeof dbfs !== 'number' || Number.isNaN(dbfs)) {
      return 0
    }
    return Math.min(1, Math.max(0, (dbfs + 60) / 60))
  }

  /** Reads the meters while the engine runs and someone listens; settles listeners at 0 after. */
  function syncVoiceLevels(): void {
    const wanted = running && voiceLevelListeners.size > 0
    if (wanted && !voiceLevelTimer) {
      voiceLevelTimer = setInterval(() => {
        const levels = { input: readLevel(INPUT_METER_NODE), output: readLevel(OUTPUT_METER_NODE) }
        voiceLevelListeners.forEach((l) => l(levels))
      }, VOICE_LEVEL_INTERVAL_MS)
    } else if (!wanted && voiceLevelTimer) {
      clearInterval(voiceLevelTimer)
      voiceLevelTimer = null
      voiceLevelListeners.forEach((l) => l({ input: 0, output: 0 }))
    }
  }

  /**
   * Hear how loud the user and the model are, every 50 ms while the engine runs. For animation:
   * the listener runs often, so keep it cheap.
   * @returns a subscription — call `remove()` to stop listening.
   */
  function addVoiceLevelListener(listener: VoiceLevelListener): OpenAILiveToolkitSubscription {
    voiceLevelListeners.add(listener)
    syncVoiceLevels()
    return {
      remove: () => {
        voiceLevelListeners.delete(listener)
        syncVoiceLevels()
      },
    }
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

  /**
   * Request microphone permission; resolves to whether it's granted. Called by {@link start}.
   * @throws {OpenAILiveError} `MIC_PERMISSION_DENIED` on iOS when Info.plist has no
   * `NSMicrophoneUsageDescription`, which iOS needs before it asks.
   */
  async function requestMicrophonePermission(): Promise<boolean> {
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
      return result === PermissionsAndroid.RESULTS.GRANTED
    }
    try {
      return await NativeOpenAILiveToolkit.requestMicrophonePermission()
    } catch (err) {
      throw asLiveError(err, 'MIC_PERMISSION_DENIED', true)
    }
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
      await androidModule()?.startAudioSession(otherAudio.mix)
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
      throw microphoneDenied()
    }

    // Create the engine once; start/stop reuse it, release() frees it.
    let id = engineId
    if (!id) {
      lastWrittenToolsNote = currentToolsNote()
      const res = c.callAction(
        'switchboard',
        'createEngine',
        buildLiveEngine(
          transport,
          openAIApiKey,
          delegateTools(),
          lastWrittenToolsNote,
          session,
          { available: isolationAvailable, enabled: speakerIsolation },
          idleTimeoutMs > 0,
          idleTimeoutMs > 0 || continueConversation,
          otherAudio,
          microphone,
          voiceProcessing,
          echoCancelledInput,
          voiceVolume,
          features.flatMap((f) => f.graph(LIVE_SPLITTER_NODE) ?? []),
          offlineNotice !== null,
          diagnosticAudioSeconds
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
    syncVoiceLevels()
  }

  /**
   * Set the system prompt. GPT-Live fixes it per session, so while running this
   * starts a new session and the conversation so far is dropped. {@link addContext}
   * tells a live session something without dropping it.
   */
  function setInstructions(next: string): void {
    session.instructions = next
    // A fork keeps the stored session's instructions, so the next wake starts fresh.
    lastSessionId = null
    if (engineId) {
      lastWrittenToolsNote = currentToolsNote()
      client?.setValue(LIVE_NODE, 'instructions', liveInstructions())
    }
  }

  function currentToolsNote(): string {
    const defs = toolDefs()
    return toolsNote(
      defs,
      webSearch,
      features.flatMap((f) => f.toolsNote(defs) ?? [])
    )
  }

  /** The live model's instructions: the app's prompt, how to treat notes, and the current tools. */
  function liveInstructions(): string {
    return joinInstructions(session.instructions, CONTEXT_INSTRUCTIONS, currentToolsNote())
  }

  /**
   * Tell the running session about the current tools. The node's instructions are only read
   * when a session starts, so a change is sent as context instead: GPT-Live drops the
   * conversation so far when instructions are appended.
   */
  function syncToolsNote(): void {
    const note = currentToolsNote()
    if (!sessionLive || note === sessionToolsNote) {
      return
    }
    const pieces =
      note === ''
        ? ['You no longer have any tools.']
        : splitContext(
            `Your tools changed. ${note}`,
            MAX_CONTEXT_CHARS - TOOLS_CONTINUED.length
          ).map((piece, i) => (i === 0 ? piece : TOOLS_CONTINUED + piece))
    if (sendThinking(pieces)) {
      sessionToolsNote = note
    }
  }

  /** Quiet context for the session, in pieces it accepts. */
  function appendThinking(text: string): boolean {
    return sendThinking(splitContext(text))
  }

  function sendThinking(pieces: string[]): boolean {
    return pieces.every((text) => !client?.callAction(LIVE_NODE, 'appendThinking', { text }).error)
  }

  /** Give the model quiet context it can use but won't say on its own. Long text goes in pieces. */
  function addContext(text: string): boolean {
    return appendThinking(text)
  }

  /**
   * Keep the model told a note, by key, such as what another app plays: each new session is told
   * it, and a session that continues the conversation only once it changed. With `onlyUpdate`, only
   * a session that heard an earlier note under the key is told, e.g. that something stopped. ''
   * drops the note.
   */
  function setSessionNote(key: string, text: string, options?: { onlyUpdate?: boolean }): void {
    if (text === '') {
      sessionNotes.delete(key)
      return
    }
    sessionNotes.set(key, { text, onlyUpdate: options?.onlyUpdate ?? false })
    syncSessionNotes()
  }

  /** Tell the session the notes it hasn't heard as they stand. */
  function syncSessionNotes(): void {
    if (!sessionLive) {
      return
    }
    sessionNotes.forEach(({ text, onlyUpdate }, key) => {
      const told = notesTold.get(key)
      if (text === told || (onlyUpdate && told === undefined)) {
        return
      }
      if (appendThinking(text)) {
        notesTold.set(key, text)
      }
    })
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
   * iOS: let the engine use the platform's voice processing (echo cancellation), which it does
   * only while audio plays on the phone's speaker or earpiece. Applied live: audio restarts
   * briefly. Kept across engines. No-op on Android.
   */
  function setVoiceProcessing(enabled: boolean): void {
    if (Platform.OS !== 'ios') {
      return
    }
    log(`voice processing ${enabled ? 'on' : 'off'}`)
    voiceProcessing = enabled
    if (engineId) {
      client?.setValue(engineId, 'voiceProcessingEnabled', enabled)
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

  /**
   * Stops the app's media if it keeps other apps' audio from playing, as media does with
   * `media.nowPlayingControls`, and resolves to whether they can play now. Call it before telling
   * another app, such as the Music app, to play. In the background iOS won't let the session mix
   * again, and another app playing would cut the conversation off, so the media keeps playing there
   * and it resolves to false. The same goes for media that stopped in the background: the session
   * mixes again once the app is opened.
   */
  async function letOtherAudioPlay(): Promise<boolean> {
    if (!otherAudioKeptOut && engineMixes()) {
      return true
    }
    if (AppState.currentState === 'background') {
      log("other audio: kept out in the background, where the session can't mix again")
      return false
    }
    features.forEach((f) => f.makeWayForOtherAudio())
    await new Promise<void>((resolve) => setTimeout(resolve, MIX_RESTORE_MS))
    return true
  }

  /**
   * Whether the running engine's session mixes with other apps. Mixing turned back on in the
   * background waits for the app to be opened. True where the SDK doesn't report it.
   */
  function engineMixes(): boolean {
    if (Platform.OS !== 'ios' || !otherAudio.mix || !running || !engineId) {
      return true
    }
    return client?.getValue(engineId, 'mixingWithOthers').result !== false
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
   * The model's voice volume, 0 to 1. The default, 0.5, brings its speech up to about music level;
   * 1 is 6 dB more. Kept across engines.
   */
  function setVoiceVolume(volume: number): void {
    voiceVolume = Math.min(1, Math.max(0, volume))
    if (engineId) {
      client?.setValue(VOICE_VOLUME_NODE, 'gain', voiceVolume * MAX_VOICE_GAIN)
    }
    voiceVolumeListeners.forEach((l) => l(voiceVolume))
  }

  /** Called with the voice volume after each change, including the model's own. */
  function addVoiceVolumeListener(
    listener: (volume: number) => void
  ): OpenAILiveToolkitSubscription {
    voiceVolumeListeners.add(listener)
    return { remove: () => voiceVolumeListeners.delete(listener) }
  }

  /**
   * iOS, with mixWithOthers: keep other apps' audio from playing by turning the engine's
   * mixWithOthers off, as media does while it's the system's Now Playing, or let it play again.
   */
  function keepOtherAudioOut(keep: boolean): void {
    if (keep === otherAudioKeptOut || !otherAudio.mix) {
      return
    }
    otherAudioKeptOut = keep
    syncOtherAppsDuck()
    log(keep ? 'other audio: kept out, not mixing with other apps' : 'other audio: mixing again')
    if (engineId) {
      client?.setValue(engineId, 'mixWithOthers', !keep)
    }
  }

  function handleNetwork(available: boolean): void {
    networkUp = available
    log(`network ${available ? 'back' : 'lost'}`)
    if (!available) {
      watchOffline(OFFLINE_GRACE_MS)
      return
    }
    // A reconnect that fails starts watching again.
    stopWatchingOffline()
    if (!running) {
      return
    }
    announceBack()
    // Sooner than the node's reconnect, whose wait grows to a minute while offline.
    if (!sessionLive && !idle) {
      const fork = idleTimeoutMs > 0 || continueConversation ? lastSessionId : null
      forking = fork !== null
      log(forking ? `network back: forking ${fork}` : 'network back: new session')
      client?.callAction(LIVE_NODE, 'startSession', fork ? { forkSessionId: fork } : {})
    }
    features.forEach((f) => f.networkBack())
  }

  /** Tells the user the connection is gone if it still is after `ms`. */
  function watchOffline(ms: number): void {
    if (!offlineNotice || cancelOfflineTimer || offlineSince !== null) {
      return
    }
    const notice = offlineNotice
    cancelOfflineTimer = backgroundTimeout(() => {
      cancelOfflineTimer = null
      if (!running || offlineSince !== null || (networkUp && (sessionLive || idle))) {
        return
      }
      // Since it was lost, not since the user was told.
      offlineSince = Date.now() - ms
      log('offline: telling the user')
      speakNotice(notice.offline)
    }, ms)
  }

  function stopWatchingOffline(): void {
    cancelOfflineTimer?.()
    cancelOfflineTimer = null
  }

  /** Once the user was told the connection is gone: says it's back, and has the model told. */
  function announceBack(): void {
    if (offlineSince === null || !offlineNotice) {
      return
    }
    const seconds = Math.round((Date.now() - offlineSince) / 1000)
    offlineSince = null
    log(`offline: back after ${seconds} s`)
    speakNotice(offlineNotice.online)
    offlineNote = `The connection was lost for ${seconds} s, and the user was told; it's back now.`
    if (sessionLive) {
      addContext(offlineNote)
      offlineNote = null
    }
  }

  /**
   * Says `text` with the device's voice, played through the engine like the model's voice (the
   * system would play it quietly next to voice processing), with media lowered meanwhile.
   */
  async function speakNotice(text: string): Promise<void> {
    const language = offlineNotice?.language ?? DEFAULT_OFFLINE_NOTICE.language
    const path = await synthesizeSpeech(text, language)
    if (!path || !running || !client) {
      return
    }
    // Loading this one cuts off a notice that's still playing.
    noticeFinished?.()
    let finish = () => {}
    const finished = new Promise<void>((resolve) => {
      finish = resolve
      backgroundTimeout(resolve, NOTICE_TIMEOUT_MS)
    })
    noticeFinished = finish
    features.forEach((f) => f.noticeSpeaking(true))
    client.callAction(NOTICE_NODE, 'load', { audioFilePath: path })
    client.callAction(NOTICE_NODE, 'play')
    await finished
    // A notice that cut this one off says when speaking ends.
    if (noticeFinished !== finish) {
      return
    }
    noticeFinished = null
    features.forEach((f) => f.noticeSpeaking(false))
  }

  function clearOffline(): void {
    stopWatchingOffline()
    offlineSince = null
    offlineNote = null
  }

  /**
   * Open the share sheet with the log file, zipped with the recordings of
   * {@link OpenAILiveToolkitOptions.diagnosticAudioSeconds} when they're on.
   */
  async function shareLogsWithAudio(): Promise<void> {
    await shareLogs(dumpDiagnosticAudio())
  }

  /** Frames a recorder has recorded since it was made, or null. */
  function recordedFrames(node: string): number | null {
    const frames = client?.getValue(node, 'currentFrames').result
    return typeof frames === 'number' ? frames : null
  }

  /** Marks `text` on the recordings' label track, at the mic recorder's frame count. */
  function labelAudio(text: string): void {
    if (diagnosticAudioSeconds <= 0 || !running || text.startsWith('diagnostics:')) {
      return
    }
    const frames = recordedFrames(DIAGNOSTIC_RECORDERS.mic)
    if (frames === null) {
      return
    }
    audioLabels.push({ frames, text })
    // Only what the recording still holds.
    const oldest = frames - diagnosticAudioSeconds * GRAPH_SAMPLE_RATE
    if (audioLabels[0]!.frames < oldest) {
      audioLabels = audioLabels.filter((label) => label.frames >= oldest)
    }
  }

  /**
   * The recordings written to WAV files now, with a log line marking where each ends, and an
   * Audacity label track (labels.txt) of what happened, timed against the mic recording.
   */
  function dumpDiagnosticAudio(): string[] {
    if (diagnosticAudioSeconds <= 0 || !client || !engineId) {
      return []
    }
    const recorders = Object.entries(DIAGNOSTIC_RECORDERS)
    // Each dump pauses only its own recorder, so the counters are read together first: the
    // recordings dumped later run on meanwhile, and start that much later.
    const before = new Map(recorders.map(([name, node]) => [name, recordedFrames(node) ?? 0]))
    const capacity = diagnosticAudioSeconds * GRAPH_SAMPLE_RATE
    const paths: string[] = []
    // Where each recording starts, in the mic recorder's frames.
    const starts = new Map<string, number>()
    for (const [name, node] of recorders) {
      const end = recordedFrames(node) ?? 0
      // Recording stops as the dump starts, so this line's time is the recording's end.
      log(`diagnostics: ${name} recording ends`)
      const res = client.callAction(node, 'dump', { filePath: `${cachePath()}/${name}` })
      if (res.error || typeof res.result !== 'string') {
        log(`diagnostics: no ${name} recording: ${res.error?.message ?? 'no file'}`)
        continue
      }
      paths.push(res.result)
      starts.set(name, end - (before.get(name)! - before.get('mic')!) - Math.min(end, capacity))
    }
    const micStart = starts.get('mic')
    if (micStart === undefined) {
      return paths
    }
    const seconds = (frames: number) => ((frames - micStart) / GRAPH_SAMPLE_RATE).toFixed(6)
    const lines = [
      ...[...starts]
        .filter(([name, frames]) => name !== 'mic' && frames - micStart > GRAPH_SAMPLE_RATE / 100)
        .map(([name, frames]) => ({ frames, text: `${name} recording starts here` })),
      ...audioLabels.filter((label) => label.frames >= micStart),
    ]
      .sort((a, b) => a.frames - b.frames)
      // Audacity's format: start, end and text, tab-separated; a point has start and end equal.
      .map(
        ({ frames, text }) => `${seconds(frames)}\t${seconds(frames)}\t${text.replace(/\s+/g, ' ')}`
      )
    const labels = `${cachePath()}/labels.txt`
    if (NativeOpenAILiveToolkit.writeFile(labels, lines.join('\n') + '\n')) {
      paths.push(labels)
    }
    return paths
  }

  /**
   * Lowers other apps for the whole session rather than each reply: every change pauses the app that
   * plays for a moment. Not while the app's own media keeps the engine from mixing: other apps are
   * paused then.
   */
  function syncOtherAppsDuck(): void {
    setOtherAppsDuckWanted(duckOtherApps && sessionLive && !otherAudioKeptOut)
  }

  function setOtherAppsDuckWanted(duck: boolean): void {
    if (duck === otherAppsDuckWanted) {
      return
    }
    otherAppsDuckWanted = duck
    NativeOpenAILiveToolkit.duckOtherApps(duck, engineId ?? '')
  }

  function handleOtherAppsDuck(ducked: boolean): void {
    otherAppsDucked = ducked
    labelAudio(ducked ? 'other apps lowered' : 'other apps back')
    const othersCanPlay = engineMixes()
    otherAppsDuckListeners.forEach((l) => l(ducked, othersCanPlay))
  }

  /**
   * iOS: whether the app plays again what a {@link OpenAILiveToolkitInitializeOptions.duckOtherApps}
   * change pauses, such as the Music app it controls. Other apps are lowered only while it does,
   * and while it doesn't, raising them waits for other apps to stop.
   */
  function setOtherAudioResumable(resumable: boolean): void {
    if (Platform.OS !== 'ios' || resumable === otherAudioResumable) {
      return
    }
    otherAudioResumable = resumable
    NativeOpenAILiveToolkit.setOtherAudioResumable(resumable)
  }

  /**
   * iOS: called after each {@link OpenAILiveToolkitInitializeOptions.duckOtherApps} change. The
   * change paused the app that played; an app that controls it can play it again when
   * `othersCanPlay`.
   */
  function addOtherAppsDuckListener(
    listener: OtherAppsDuckListener
  ): OpenAILiveToolkitSubscription {
    otherAppsDuckListeners.add(listener)
    return { remove: () => otherAppsDuckListeners.delete(listener) }
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
      features.forEach((f) => f.engineStopped())
      setOtherAppsDuckWanted(false)
      clearOffline()
      // Only once the graph is down: while it runs, the communication route keeps AEC engaged.
      if (Platform.OS === 'android') {
        stopAndroidAudioSession()
      }
      flushTranscript()
      log('engine stopped')
    }
    running = false
    syncVoiceLevels()
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
    cancelIdleTimer?.()
    cancelIdleTimer = backgroundTimeout(goIdle, timeoutMs)
  }

  /** The model answered a wake, so it was the user: back to the full timeout. */
  function engaged(): void {
    woken = false
    touch()
  }

  /** Close a session nobody has talked in for {@link idleTimeoutMs}. */
  function goIdle(): void {
    cancelIdleTimer = null
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
    syncOtherAppsDuck()
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
    cancelIdleTimer?.()
    cancelIdleTimer = null
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
      syncVoiceLevels()
      // The next engine's recorders count from zero.
      audioLabels = []
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

  /**
   * The iOS engine's state (running, interrupted, failed, stopped, with why) and its settled route,
   * logged and so labelled on the recordings.
   */
  function logEngineEvent(name: string, data: any): void {
    if (name === 'stateChanged') {
      log(`engine ${data?.state ?? '?'}${data?.reason ? `: ${data.reason}` : ''}`)
    } else if (name === 'routeChanged') {
      log(
        `engine route: output ${data?.outputName ?? '?'} (${data?.output ?? '?'}), ` +
          `input ${data?.inputName ?? '?'} (${data?.input ?? '?'})`
      )
    }
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
    // The engine's own events arrive under the SDK's URI: "switchboard.<engine>".
    if (engineId !== null && (objectURI === engineId || objectURI.endsWith(`.${engineId}`))) {
      const name = e?.name ?? e?.eventName ?? ''
      logEngineEvent(name, e?.data)
      if (name === 'routeChanged') {
        outputPort = e?.data?.output ?? null
      }
      if (name === 'stateChanged') {
        features.forEach((f) => f.engineStateChanged(e?.data?.state, e?.data?.reason))
      }
      return
    }
    // A graph node's URI arrives dotted (e.g. "<engine>.liveNode"), so classify by the last segment.
    const nodeId = objectURI.split('.').pop() ?? ''
    if (nodeId === NOTICE_NODE) {
      const state = (e?.data as { state?: string } | undefined)?.state
      if (
        (e?.name ?? e?.eventName) === 'stateChanged' &&
        (state === 'finished' || state === 'error')
      ) {
        noticeFinished?.()
      }
      return
    }
    const feature = features.find((f) => f.ownsNode(nodeId))
    if (feature) {
      feature.handleNodeEvent(nodeId, e?.name ?? e?.eventName ?? '', e?.data)
      return
    }
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
    // A tool's own event repeats its toolCall; apps get toolCall only.
    const callId = (event.data as { callId?: unknown } | undefined)?.callId
    if (
      event.name !== 'toolCall' &&
      typeof callId === 'string' &&
      toolEventsDue.get(callId) === event.name
    ) {
      toolEventsDue.delete(callId)
      return
    }
    switch (event.name) {
      case 'toolCall': {
        const call = event.data as ToolCall
        toolEventsDue.set(call.callId, call.name)
        flushTranscript()
        log(`tool call ${call.name}${logConversation ? ` ${call.argumentsJson ?? ''}` : ''}`)
        woken = false
        handleToolCall(call)
        break
      }
      case 'sessionStarted': {
        const continued = forking
        sessionLive = true
        lastSessionId = (event.data as { sessionId?: string } | undefined)?.sessionId || null
        log(`session started ${lastSessionId}${continued ? ' (fork)' : ''}`)
        // So the app can tell whether context it gave the last session is still there.
        event.data = { ...(event.data as object | undefined), continued }
        // A session starts unmuted, or with the last mute the node accepted, which misses changes
        // made while no session was live. Send the app's choice either way.
        client?.callAction(LIVE_NODE, muted ? 'muteInput' : 'unmuteInput')
        toolEventsDue.clear()
        // A new session reads the instructions last written to the node, while a fork knows what
        // the session it continues was told. Either way, bring its tools note up to date.
        if (!continued) {
          sessionToolsNote = lastWrittenToolsNote
          notesTold.clear()
        }
        forking = false
        syncOtherAppsDuck()
        syncToolsNote()
        features.forEach((f) => f.sessionStarted(continued))
        syncSessionNotes()
        stopWatchingOffline()
        announceBack()
        if (offlineNote) {
          addContext(offlineNote)
          offlineNote = null
        }
        touch()
        break
      }
      // An "mm" from a noise restarts the countdown but doesn't show the model was talked to.
      case 'inputTranscriptDelta':
        logTranscript('user', (event.data as { delta?: string } | undefined)?.delta ?? '')
        touch()
        break
      case 'outputTranscriptDelta':
        logTranscript('assistant', (event.data as { delta?: string } | undefined)?.delta ?? '')
        engaged()
        break
      case 'delegationCreated': {
        flushTranscript()
        // Named fields only, so content the event may carry stays out of the log.
        const { delegationId, target } = (event.data ?? {}) as {
          delegationId?: string
          target?: string
        }
        log(`delegation ${JSON.stringify({ delegationId, target })}`)
        engaged()
        break
      }
      case 'sessionStarting':
      case 'sessionDisconnected':
      case 'sessionClosed':
        flushTranscript()
        log(`${event.name}${event.data ? ` ${JSON.stringify(event.data)}` : ''}`)
        sessionLive = false
        syncOtherAppsDuck()
        if (event.name !== 'sessionStarting' && running && !idle) {
          watchOffline(SESSION_DOWN_MS)
        }
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
          message?.trim()
            ? message + appRefusedHint(data?.type, message, demoCredentials)
            : `Session error: ${event.raw}`,
          !sessionLive && !forkFailed,
          { raw }
        )
        break
      }
    }
    listeners[type].forEach((l) => l(event))
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
    } else {
      return
    }
    // Muted, the user isn't talking to the model.
    features.forEach((f) => f.userSpeaking(userSpeaking && !muted))
  }

  return {
    initialize,
    addEventListener,
    addErrorListener,
    addVoiceLevelListener,
    requestMicrophonePermission,
    start,
    setInstructions,
    addContext,
    setSessionNote,
    say,
    setVoice,
    setSpeakerIsolation,
    setMicrophone,
    setVoiceProcessing,
    setVoiceVolume,
    isBluetoothConnected,
    addBluetoothListener,
    setMuted,
    registerTool,
    unregisterTool,
    letOtherAudioPlay,
    setOtherAudioResumable,
    addOtherAppsDuckListener,
    addVoiceVolumeListener,
    reportError,
    stop,
    release,
    newConversation,
    shareLogs: shareLogsWithAudio,
    /** Media alongside the conversation. Plays only with the `media` option on. */
    media: media.api,
    /** Whether the engine is started (between {@link start} and {@link stop}). */
    get isRunning(): boolean {
      return running
    },
    /** iOS: whether {@link OpenAILiveToolkitInitializeOptions.duckOtherApps} has other apps lowered. */
    get otherAppsDucked(): boolean {
      return otherAppsDucked
    },
    /** The model's voice volume, 0 to 1. */
    get voiceVolume(): number {
      return voiceVolume
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
