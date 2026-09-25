import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  openAILiveToolkit,
  OpenAILiveError,
  type OpenAILiveErrorCode,
  type OpenAILiveToolkit,
  type OpenAILiveToolkitTool,
} from './OpenAILiveToolkit'
import { DEFAULT_MODEL, DEFAULT_VOICE, type OpenAIVoice } from './voice'
import { appendFragment, nextSessionOffset, type TranscriptEntry } from './transcript'

/**
 * Session connection state. `'error'` means the session was attempted and refused —
 * see {@link OpenAILiveToolkitContextValue.error} for why.
 */
export type OpenAILiveToolkitConnectionStatus = 'none' | 'connecting' | 'connected' | 'error'

/** Speaker isolation (ai-coustics Quail) controls. */
export interface SpeakerIsolation {
  /** Whether the graph has speaker isolation at all (an ai-coustics license key was given). */
  available: boolean
  /** Whether it's on. */
  enabled: boolean
  /** Turn it on or off. Applied live. */
  setEnabled: (enabled: boolean) => void
}

/** Value exposed by {@link useOpenAILiveToolkit}. */
export interface OpenAILiveToolkitContextValue {
  /** Whether the engine is currently running. */
  isRunning: boolean
  /**
   * The outstanding failure, or null. Holds only failures the app has to act on
   * (`fatal`). Cleared by `start()`, `stop()`, `release()`, and by a session coming up.
   * Pass an `onError` prop to observe the non-fatal ones too.
   */
  error: OpenAILiveError | null
  /** Session connection state. `'error'` stays until a session comes up. */
  connectionStatus: OpenAILiveToolkitConnectionStatus
  /** What both sides said, grouped into entries and ordered by time. */
  transcript: TranscriptEntry[]
  /** Clear {@link transcript}. */
  clearTranscript: () => void
  /** Start the engine and open a session (ensures mic permission first). */
  start: () => Promise<void>
  /** Stop the engine and close the session, keeping the engine for a fast restart. */
  stop: () => void
  /** Stop and fully release the engine. The next start() rebuilds it. */
  release: () => void
  /** Whether microphone permission is granted; `null` until first checked. */
  hasMicrophonePermission: boolean | null
  /** Request microphone permission. Called automatically by {@link start}. */
  requestMicrophonePermission: () => Promise<boolean>
  /** The system prompt. */
  instructions: string
  /**
   * Set the system prompt. GPT-Live fixes it per session, so while running this
   * starts a new session and drops the conversation. Use {@link appendInstructions}
   * to adjust a live conversation instead.
   */
  setInstructions: (instructions: string) => void
  /** Add trusted instructions to the live session. Returns false with no session. */
  appendInstructions: (text: string) => boolean
  /** Give the model quiet context it can use but won't say on its own. */
  addContext: (text: string) => boolean
  /** Give the model something to say aloud (it may paraphrase). */
  say: (text: string) => boolean
  /** The voice the model speaks with. */
  voice: OpenAIVoice
  /** Set the voice. Fixed per session: while running this starts a new session. */
  setVoice: (voice: OpenAIVoice) => void
  /** The GPT-Live model id. Set once via the provider's `model` prop. */
  model: string
  /** Speaker isolation controls. */
  speakerIsolation: SpeakerIsolation
  /** Whether the model is prevented from hearing the microphone. */
  muted: boolean
  /** Mute or unmute the microphone for the model. */
  setMuted: (muted: boolean) => void
  /** Register a tool the model can call (replaces any tool with the same name). */
  registerTool: (tool: OpenAILiveToolkitTool) => void
  /** Remove a registered tool by name. */
  unregisterTool: (name: string) => void
}

const OpenAILiveToolkitContext = createContext<OpenAILiveToolkitContextValue | null>(null)

/** Anything the toolkit rejects with is already an {@link OpenAILiveError}; this covers an unexpected throw. */
function asLiveError(err: unknown, fallbackCode: OpenAILiveErrorCode): OpenAILiveError {
  if (err instanceof OpenAILiveError) {
    return err
  }
  return new OpenAILiveError(fallbackCode, err instanceof Error ? err.message : String(err), true)
}

/** Props for {@link OpenAILiveToolkitProvider}. Settings seed initial state. */
export interface OpenAILiveToolkitProviderProps {
  /** Switchboard app ID. Optional: falls back to the shared default credentials. */
  appId?: string
  /** Switchboard app secret. Optional, with the same fallback as {@link appId}. */
  appSecret?: string
  /** OpenAI API key. Required to start: GPT-Live has no ephemeral tokens. */
  openAIApiKey?: string
  /** ai-coustics license key. Without it there's no speaker isolation. */
  aiCousticsLicenseKey?: string
  /** System prompt. Initial value; also settable via the hook. */
  instructions?: string
  /** Voice (defaults to `'marin'`). Initial value; also settable via the hook. */
  voice?: OpenAIVoice
  /** GPT-Live model id (defaults to `'gpt-live-1'`). Fixed once the engine is built. */
  model?: string
  /** Model that handles delegated work and calls tools (defaults to `'gpt-5.5'`). */
  delegateModel?: string
  /** Instructions for the delegate model. */
  delegateInstructions?: string
  /** Start with speaker isolation on (default true). Also settable via the hook. */
  speakerIsolation?: boolean
  /** Called for every failure, including non-fatal ones that never reach `error`. */
  onError?: (error: OpenAILiveError) => void
  children?: ReactNode
}

/** Initializes the toolkit and exposes its state and controls via {@link useOpenAILiveToolkit}. */
export function OpenAILiveToolkitProvider(props: OpenAILiveToolkitProviderProps) {
  const { appId, appSecret, openAIApiKey, aiCousticsLicenseKey, children } = props
  if (appId !== undefined && !appId.trim()) {
    throw new Error('OpenAILiveToolkitProvider: appId is required')
  }
  if (appSecret !== undefined && !appSecret.trim()) {
    throw new Error('OpenAILiveToolkitProvider: appSecret is required')
  }

  const toolkitRef = useRef<OpenAILiveToolkit>(openAILiveToolkit)
  const onErrorRef = useRef(props.onError)
  onErrorRef.current = props.onError

  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<OpenAILiveError | null>(null)
  const [sessionState, setSessionState] = useState<'none' | 'connecting' | 'connected'>('none')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const entryIdRef = useRef(0)
  // Shift applied to the current session's fragment times, so a new session (whose timeline
  // restarts at 0) continues after the existing transcript.
  const timelineOffsetRef = useRef(0)
  const [hasMicrophonePermission, setHasMicrophonePermission] = useState<boolean | null>(null)
  const [instructions, setInstructionsState] = useState(props.instructions ?? '')
  const [voice, setVoiceState] = useState<OpenAIVoice>(props.voice ?? DEFAULT_VOICE)
  const [model] = useState(props.model ?? DEFAULT_MODEL)
  const [isolationAvailable, setIsolationAvailable] = useState(false)
  const [isolationEnabled, setIsolationEnabled] = useState(props.speakerIsolation ?? true)
  const [muted, setMutedState] = useState(false)

  const reportError = useCallback((err: OpenAILiveError) => {
    onErrorRef.current?.(err)
    if (err.fatal) {
      setError(err)
    } else if (!onErrorRef.current) {
      console.warn(`[OpenAILiveToolkit] ${err.code}: ${err.message}`)
    }
  }, [])

  useEffect(() => {
    const toolkit = toolkitRef.current
    // Subscribed before initialize() so an SDK-level refusal lands in `error`.
    const errorSub = toolkit.addErrorListener(reportError)

    toolkit.initialize({
      appId,
      appSecret,
      openAIApiKey,
      aiCousticsLicenseKey,
      instructions,
      voice,
      model,
      delegateModel: props.delegateModel,
      delegateInstructions: props.delegateInstructions,
      speakerIsolation: isolationEnabled,
    })
    setIsRunning(toolkit.isRunning)
    setIsolationAvailable(toolkit.isSpeakerIsolationAvailable)

    const nextId = () => ++entryIdRef.current
    const sub = toolkit.addEventListener('live', (e) => {
      switch (e.name) {
        case 'sessionStarting':
        case 'sessionDisconnected':
          setSessionState('connecting')
          break
        case 'sessionStarted':
          setSessionState('connected')
          setError(null)
          // Read and set inside the updater so it's ordered with the fragment updates below.
          setTranscript((entries) => {
            timelineOffsetRef.current = nextSessionOffset(entries)
            return entries
          })
          break
        case 'sessionClosed': {
          const reason = (e.data as { reason?: string })?.reason
          setSessionState(reason === 'close_requested' ? 'none' : 'connecting')
          break
        }
        case 'inputTranscriptDelta':
        case 'outputTranscriptDelta': {
          const d = e.data as { delta?: string; startMs?: number; endMs?: number }
          const speaker = e.name === 'inputTranscriptDelta' ? 'user' : 'assistant'
          setTranscript((entries) =>
            appendFragment(
              entries,
              speaker,
              d.delta ?? '',
              (d.startMs ?? 0) + timelineOffsetRef.current,
              (d.endMs ?? 0) + timelineOffsetRef.current,
              nextId
            )
          )
          break
        }
      }
    })
    return () => {
      // Detach this view's listeners only — the engine's lifecycle is app-owned.
      sub.remove()
      errorSub.remove()
    }
    // Settings are init-only seeds here; runtime changes go through the setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, appSecret, openAIApiKey, aiCousticsLicenseKey, reportError])

  const requestMicrophonePermission = useCallback(async (): Promise<boolean> => {
    try {
      const granted = (await toolkitRef.current?.requestMicrophonePermission()) ?? false
      setHasMicrophonePermission(granted)
      return granted
    } catch {
      setHasMicrophonePermission(false)
      return false
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      if (!(await requestMicrophonePermission())) {
        reportError(
          new OpenAILiveError('MIC_PERMISSION_DENIED', 'Microphone permission denied', true)
        )
        return
      }
      await toolkitRef.current?.start()
      setIsRunning(true)
    } catch (err) {
      reportError(asLiveError(err, 'ENGINE_START_FAILED'))
    }
  }, [requestMicrophonePermission, reportError])

  const stop = useCallback(() => {
    try {
      toolkitRef.current?.stop()
      setIsRunning(false)
      setSessionState('none')
      setError(null)
    } catch (err) {
      // The graph is still live, so leave isRunning true.
      reportError(asLiveError(err, 'ENGINE_STOP_FAILED'))
    }
  }, [reportError])

  const release = useCallback(() => {
    toolkitRef.current?.release()
    setIsRunning(false)
    setSessionState('none')
    setError(null)
  }, [])

  const clearTranscript = useCallback(() => setTranscript([]), [])

  const setInstructions = useCallback((next: string) => {
    setInstructionsState(next)
    toolkitRef.current?.setInstructions(next)
  }, [])
  const appendInstructions = useCallback(
    (text: string) => toolkitRef.current?.appendInstructions(text) ?? false,
    []
  )
  const addContext = useCallback(
    (text: string) => toolkitRef.current?.addContext(text) ?? false,
    []
  )
  const say = useCallback((text: string) => toolkitRef.current?.say(text) ?? false, [])

  const setVoice = useCallback((next: OpenAIVoice) => {
    setVoiceState(next)
    toolkitRef.current?.setVoice(next)
  }, [])

  const setSpeakerIsolationEnabled = useCallback((next: boolean) => {
    setIsolationEnabled(next)
    toolkitRef.current?.setSpeakerIsolation(next)
  }, [])

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next)
    toolkitRef.current?.setMuted(next)
  }, [])

  const registerTool = useCallback((tool: OpenAILiveToolkitTool) => {
    toolkitRef.current?.registerTool(tool)
  }, [])
  const unregisterTool = useCallback((name: string) => {
    toolkitRef.current?.unregisterTool(name)
  }, [])

  const connectionStatus: OpenAILiveToolkitConnectionStatus =
    error?.code === 'SESSION_FAILED' ? 'error' : sessionState

  const value: OpenAILiveToolkitContextValue = {
    isRunning,
    error,
    connectionStatus,
    transcript,
    clearTranscript,
    start,
    stop,
    release,
    hasMicrophonePermission,
    requestMicrophonePermission,
    instructions,
    setInstructions,
    appendInstructions,
    addContext,
    say,
    voice,
    setVoice,
    model,
    speakerIsolation: {
      available: isolationAvailable,
      enabled: isolationEnabled,
      setEnabled: setSpeakerIsolationEnabled,
    },
    muted,
    setMuted,
    registerTool,
    unregisterTool,
  }

  return (
    <OpenAILiveToolkitContext.Provider value={value}>{children}</OpenAILiveToolkitContext.Provider>
  )
}

/** Access the toolkit state + controls. Must be used within {@link OpenAILiveToolkitProvider}. */
export function useOpenAILiveToolkit(): OpenAILiveToolkitContextValue {
  const ctx = useContext(OpenAILiveToolkitContext)
  if (!ctx) {
    throw new Error('useOpenAILiveToolkit must be used within an OpenAILiveToolkitProvider')
  }
  return ctx
}

/**
 * Register a tool for the model to call, scoped to this component's lifetime.
 * Registers on mount, unregisters on unmount, and re-registers when `name`,
 * `description` or `parameters` change. The `handler` is kept live through a ref,
 * so it always sees current state without re-registering.
 *
 * @example
 * useTool({
 *   name: 'get_weather',
 *   description: 'Current weather for a city',
 *   parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
 *   handler: async ({ city }) => fetchWeather(city),
 * })
 */
export function useTool(tool: OpenAILiveToolkitTool): void {
  const { registerTool, unregisterTool } = useOpenAILiveToolkit()
  const toolRef = useRef(tool)
  toolRef.current = tool

  const parametersKey = JSON.stringify(tool.parameters)
  useEffect(() => {
    const name = toolRef.current.name
    registerTool({
      name,
      description: toolRef.current.description,
      parameters: toolRef.current.parameters,
      handler: (args) => toolRef.current.handler(args),
    })
    return () => unregisterTool(name)
  }, [tool.name, tool.description, parametersKey, registerTool, unregisterTool])
}
