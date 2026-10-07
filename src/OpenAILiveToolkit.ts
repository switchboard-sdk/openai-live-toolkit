import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'
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
  /** No OpenAI API key. GPT-Live has no ephemeral tokens, so a real key is required. */
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

/** Credentials and session seeds for {@link OpenAILiveToolkit.initialize}. */
export interface OpenAILiveToolkitInitializeOptions {
  /** Switchboard app ID. Optional: falls back to the shared default credentials. */
  appId?: string
  /** Switchboard app secret. Optional, with the same fallback as {@link appId}. */
  appSecret?: string
  /** OpenAI API key. Required by {@link OpenAILiveToolkit.start}. */
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
}

/**
 * The categories of event the toolkit surfaces, one per graph node it listens to. `'vad'`
 * (speechStarted / speechEnded) is only there in idle mode.
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

/** Payload of a `toolCall` event from the Live node. */
interface ToolCall {
  callId: string
  name: string
  argumentsJson: string
}

const LIVE_NODE = 'liveNode'
const ISOLATION_NODE = 'speakerIsolationNode'
const VAD_NODE = 'vadNode'

// The graph's node IDs → event category, used to split the single native event stream.
const NODE_EVENT_TYPE: Record<string, OpenAILiveToolkitEventType> = {
  [LIVE_NODE]: 'live',
  [VAD_NODE]: 'vad',
}

// The graph runs at 48 kHz; Quail wants 16 kHz, so it sits between two resamplers.
const GRAPH_SAMPLE_RATE = 48000
const QUAIL_SAMPLE_RATE = 16000
const QUAIL_MODEL = 'quail_vf_2_1_l_16khz_8xope536_v11.aicmodel'

// GPT-Live only delegates work it knows can be done, and the tools live in the delegate's config,
// so the live model is told about them; the delegate is told to call them rather than say it did.
const DELEGATE_INSTRUCTIONS =
  "You carry out actions in the user's app. When a request matches one of your tools, call the " +
  'tool; never claim an action is done without calling it.'

/** What the live model is told about the registered tools. Empty with no tools. */
export function toolsNote(tools: readonly { name: string; description: string }[]): string {
  if (tools.length === 0) {
    return ''
  }
  const list = tools.map((t) => `${t.name} (${t.description})`).join('; ')
  return `You can act in the app through tools: ${list}. Use them whenever the user asks for one of these.`
}

function joinInstructions(...parts: string[]): string {
  return parts.filter((p) => p.trim() !== '').join('\n\n')
}

/**
 * The Switchboard graph the toolkit runs:
 * microphone → mono → [Quail speaker isolation] → OpenAI.Live → speaker.
 * The model owns turn-taking. In idle mode a VAD taps the input the model hears, only to
 * tell when the user starts talking again.
 */
function buildLiveEngine(
  apiKey: string,
  tools: ToolDef[],
  session: {
    model: string
    voice: OpenAIVoice
    instructions: string
    delegateModel: string
    delegateInstructions: string
  },
  isolation: { available: boolean; enabled: boolean },
  idleMode: boolean
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
        // Passed to the node directly: GPT-Live has no token fallback if the
        // extension-level key doesn't reach it.
        apiKey,
        model: session.model,
        voice: session.voice,
        instructions: joinInstructions(session.instructions, toolsNote(tools)),
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
        store: idleMode,
      },
    },
    { id: 'monoToMultiChannelNode', type: 'Switchboard.MonoToMultiChannel' }
  )
  chain.push(LIVE_NODE, 'monoToMultiChannelNode', 'outputNode')
  const connections = chain.slice(1).map((destinationNode, i) => ({
    sourceNode: chain[i],
    destinationNode,
  }))
  if (idleMode) {
    connections.push({ sourceNode: 'vadSplitterNode', destinationNode: VAD_NODE })
  }

  return {
    type: 'Switchboard.Realtime',
    configuration: {
      microphoneEnabled: true,
      // Platform echo cancellation: the model listens while it speaks.
      voiceProcessingEnabled: true,
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
  // The tools note the current session's instructions carry, to tell when a live update is needed.
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
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  // The session was closed for idling and reopens when the user speaks.
  let idle = false
  // The latest session, which a wake continues. Null makes the next wake start fresh.
  let lastSessionId: string | null = null
  // The session coming up is a fork of lastSessionId.
  let forking = false
  let userSpeaking = false
  let toolCallsInFlight = 0

  function emitError(
    code: OpenAILiveErrorCode,
    message: string,
    fatal: boolean,
    details?: Record<string, unknown>
  ): void {
    const error = new OpenAILiveError(code, message, fatal, details)
    errorListeners.forEach((l) => l(error))
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
    openAIApiKey = options.openAIApiKey?.trim() ?? ''
    const licenseKey = options.aiCousticsLicenseKey?.trim() ?? ''
    isolationSupported = NativeOpenAILiveToolkit.isSpeakerIsolationSupported()
    isolationAvailable = isolationSupported && licenseKey !== ''
    if (!isolationSupported && licenseKey !== '') {
      console.warn(
        '[OpenAILiveToolkit] aiCousticsLicenseKey ignored: this build has no AICoustics extension. ' +
          'Reinstall pods with OPENAI_LIVE_AICOUSTICS=1 to enable speaker isolation.'
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
      const res = c.callAction('switchboard', 'initialize', { appID: appId, appSecret, extensions })
      if (res.error) {
        initError = `Switchboard initialization failed: ${res.error.message}`
        emitError('INIT_FAILED', initError, true)
        return
      }
    }
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
  function requestMicrophonePermission(): Promise<boolean> {
    return NativeOpenAILiveToolkit.requestMicrophonePermission()
  }

  /**
   * Request the mic, build the graph, and start the engine (which opens the session).
   * @throws {OpenAILiveError} if not initialized, the API key is missing, the mic is
   * denied, or the engine fails to start.
   */
  async function start(): Promise<void> {
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
    if (openAIApiKey === '') {
      throw new OpenAILiveError(
        'MISSING_API_KEY',
        'An OpenAI API key is required: GPT-Live has no ephemeral tokens.',
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
      lastWrittenToolsNote = toolsNote(toolDefs())
      const res = c.callAction(
        'switchboard',
        'createEngine',
        buildLiveEngine(
          openAIApiKey,
          toolDefs(),
          session,
          { available: isolationAvailable, enabled: speakerIsolation },
          idleTimeoutMs > 0
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

    const startRes = c.callAction(id, 'start')
    if (startRes.error) {
      throw new OpenAILiveError(
        'ENGINE_START_FAILED',
        `Engine start failed: ${startRes.error.message}`,
        true
      )
    }
    running = true
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
      lastWrittenToolsNote = toolsNote(toolDefs())
      client?.setValue(LIVE_NODE, 'instructions', liveInstructions())
    }
  }

  /** The live model's instructions: the app's prompt plus the note about the current tools. */
  function liveInstructions(): string {
    return joinInstructions(session.instructions, toolsNote(toolDefs()))
  }

  /**
   * Tell the running session about the current tools. The node's instructions are only read
   * when a session starts, so a change is sent as appended instructions instead.
   */
  function syncToolsNote(): void {
    const note = toolsNote(toolDefs())
    if (!sessionLive || note === sessionToolsNote) {
      return
    }
    const text = note === '' ? 'You no longer have any tools.' : `Your tools changed. ${note}`
    if (!client?.callAction(LIVE_NODE, 'appendInstructions', { text }).error) {
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
    speakerIsolation = enabled
    if (engineId && isolationAvailable) {
      client?.setValue(ISOLATION_NODE, 'enabled', enabled)
    }
  }

  /** Stop the model hearing the microphone, or let it hear again. Kept across sessions. */
  function setMuted(next: boolean): void {
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
    if (engineId) {
      client?.setValue(LIVE_NODE, 'tools', toolDefs())
      syncToolsNote()
    }
  }

  /** Remove a registered tool by name; no-op if it isn't registered. */
  function unregisterTool(name: string): void {
    if (tools.delete(name) && engineId) {
      client?.setValue(LIVE_NODE, 'tools', toolDefs())
      syncToolsNote()
    }
  }

  /** Function definitions for the registered tools (handlers stripped). */
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
   * Halt the graph. Returns the SDK's message if it refused, else null — `running`
   * only goes false when the graph actually stopped.
   */
  function haltGraph(): string | null {
    if (client && engineId && running) {
      const res = client.callAction(engineId, 'stop')
      if (res.error) {
        return res.error.message ?? 'unknown error'
      }
    }
    running = false
    sessionLive = false
    resetIdle()
    return null
  }

  /** (Re)start the idle countdown. Anything that shows the conversation is going calls this. */
  function touch(): void {
    if (idleTimeoutMs <= 0 || idle || !running) {
      return
    }
    if (idleTimer) {
      clearTimeout(idleTimer)
    }
    idleTimer = setTimeout(goIdle, idleTimeoutMs)
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
    idle = true
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
    forking = lastSessionId !== null
    client?.callAction(LIVE_NODE, 'startSession', forking ? { forkSessionId: lastSessionId } : {})
  }

  function resetIdle(): void {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    idle = false
    forking = false
    lastSessionId = null
    userSpeaking = false
  }

  /**
   * Stop the engine (closing the session), keeping it for a fast restart via
   * {@link start}. {@link release} frees it.
   * @throws {OpenAILiveError} if the engine refuses to stop.
   */
  function stop(): void {
    const failure = haltGraph()
    if (failure) {
      throw new OpenAILiveError('ENGINE_STOP_FAILED', `Engine stop failed: ${failure}`, true)
    }
  }

  /** Stop and free the engine. The next {@link start} rebuilds it. */
  function release(): void {
    haltGraph()
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
    switch (event.name) {
      case 'toolCall':
        handleToolCall(event.data as ToolCall)
        break
      case 'sessionStarted':
        sessionLive = true
        lastSessionId = (event.data as { sessionId?: string } | undefined)?.sessionId || null
        // Every session starts unmuted; carry the app's choice over.
        if (muted) {
          client?.callAction(LIVE_NODE, 'muteInput')
        }
        // A new session reads the instructions last written to the node, while a fork knows what
        // the session it continues was told. Either way, bring its tools note up to date.
        if (!forking) {
          sessionToolsNote = lastWrittenToolsNote
        }
        forking = false
        syncToolsNote()
        touch()
        break
      case 'inputTranscriptDelta':
      case 'outputTranscriptDelta':
      case 'delegationCreated':
        touch()
        break
      case 'sessionStarting':
      case 'sessionDisconnected':
      case 'sessionClosed':
        sessionLive = false
        break
      case 'error': {
        const data = event.data as { type?: string; message?: string } | undefined
        const message = data?.message
        // A refused fork isn't fatal: the node starts a new session instead.
        const forkRefused = forking && data?.type === 'invalid_request_error'
        if (forkRefused) {
          forking = false
        }
        emitError(
          'SESSION_FAILED',
          message?.trim() ? message : `Session error: ${event.raw}`,
          !sessionLive && !forkRefused,
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
    setMuted,
    registerTool,
    unregisterTool,
    stop,
    release,
    /** Whether the engine is started (between {@link start} and {@link stop}). */
    get isRunning(): boolean {
      return running
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
