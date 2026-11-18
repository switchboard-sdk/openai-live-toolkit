import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState, Platform } from 'react-native'
import { asLiveError } from './errors'
import {
  openAILiveToolkit,
  OpenAILiveError,
  type OpenAILiveStartOptions,
  type OpenAILiveToolkit,
  type OpenAILiveToolkitSubscription,
  type OpenAILiveToolkitTool,
  type OpenAILiveTransport,
  type Microphone,
  type OfflineNotice,
  type OtherAppsDuckListener,
  type OtherAudioDucking,
  type VoiceLevels,
} from './OpenAILiveToolkit'
import type { MediaOptions } from './media/types'
import { DEFAULT_MODEL, DEFAULT_VOICE, type OpenAIVoice } from './voice'
import { appendFragment, nextSessionOffset, type TranscriptEntry } from './transcript'
import { voiceVolumeTool } from './voiceVolumeTool'

/**
 * Session connection state. `'idle'` means idle mode closed the session and it reopens
 * when the user speaks. `'error'` means the session was attempted and refused — see
 * {@link OpenAILiveToolkitContextValue.error} for why.
 */
export type OpenAILiveToolkitConnectionStatus =
  | 'none'
  | 'connecting'
  | 'connected'
  | 'idle'
  | 'error'

/**
 * What a connected conversation is doing: waiting for the user, hearing them, working on a
 * delegated request, or talking. Only meaningful while the connection status is `'connected'`.
 */
export type OpenAILiveActivity = 'listening' | 'userSpeaking' | 'thinking' | 'speaking'

// Transcript arrives while someone talks; this long after the last fragment they've stopped.
const ACTIVITY_TAIL_MS = 1000
// A delegation that hasn't led to speech by now counts as done.
const THINKING_TIMEOUT_MS = 15_000

/** Speaker isolation (ai-coustics Quail) controls. */
export interface SpeakerIsolation {
  /** Whether this build links the AICoustics extension (opt-in at `pod install`; iOS only). */
  supported: boolean
  /** Whether the graph has speaker isolation: `supported` and a license key was given. */
  available: boolean
  /** Whether it's on. */
  enabled: boolean
  /** Turn it on or off. Applied live. */
  setEnabled: (enabled: boolean) => void
}

/** iOS Bluetooth controls. */
export interface BluetoothAudio {
  /**
   * Whether a Bluetooth headset, car or speaker is connected. With `microphone: 'bluetooth'` a
   * device without a microphone isn't used, so it isn't reported. Always false on Android.
   */
  connected: boolean
  /** The microphone the model hears while one is: the device's, or the phone's. */
  microphone: Microphone
  /** Choose the microphone. Applied live. No-op on Android. */
  setMicrophone: (microphone: Microphone) => void
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
  /**
   * What the conversation is doing while connected, from the voice activity detector (idle mode
   * only) and the transcript: `'userSpeaking'` and `'speaking'` end a second after the last
   * fragment, `'thinking'` lasts from a delegation until the model speaks.
   */
  activity: OpenAILiveActivity
  /** What both sides said, grouped into entries and ordered by time. */
  transcript: TranscriptEntry[]
  /** Clear {@link transcript}. */
  clearTranscript: () => void
  /**
   * Start the engine and open a session (ensures mic permission first). With
   * `continueConversation`, `continueSessionId` continues a session the app saved.
   */
  start: (options?: OpenAILiveStartOptions) => Promise<void>
  /** Stop the engine and close the session, keeping the engine for a fast restart. */
  stop: () => void
  /** Stop and fully release the engine. The next start() rebuilds it. */
  release: () => void
  /**
   * The latest session's id, for the app to save and pass to `start` as `continueSessionId`.
   * Null before the first session and after {@link newConversation}.
   */
  sessionId: string | null
  /**
   * Whether the session that's up continues the conversation of the one before it, as when idle
   * mode wakes it, so it still holds the context that one was given. False for a new conversation.
   */
  sessionContinued: boolean
  /**
   * Forget the conversation and clear {@link transcript}, so the next session starts fresh. A
   * session that's up is replaced by a new one now.
   */
  newConversation: () => void
  /** Whether microphone permission is granted; `null` until first checked. */
  hasMicrophonePermission: boolean | null
  /** Request microphone permission. Called automatically by {@link start}. */
  requestMicrophonePermission: () => Promise<boolean>
  /** The system prompt. */
  instructions: string
  /**
   * Set the system prompt. GPT-Live fixes it per session, so while running this
   * starts a new session and drops the conversation. {@link addContext} tells a live
   * session something without dropping it.
   */
  setInstructions: (instructions: string) => void
  /** Give the model quiet context it can use but won't say on its own. */
  addContext: (text: string) => boolean
  /**
   * Keep the model told a note, by key, such as what another app plays: each new session is told
   * it, and a session that continues the conversation only once it changed. With `onlyUpdate`, only
   * a session that heard an earlier note under the key is told, e.g. that something stopped. ''
   * drops the note.
   */
  setSessionNote: (key: string, text: string, options?: { onlyUpdate?: boolean }) => void
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
  /** iOS Bluetooth controls: offer the microphone choice while `connected`. */
  bluetooth: BluetoothAudio
  /** Whether the model is prevented from hearing the microphone. */
  muted: boolean
  /** Mute or unmute the microphone for the model. */
  setMuted: (muted: boolean) => void
  /**
   * iOS: whether the engine may use the platform's voice processing (echo cancellation), which it
   * does only on the phone's speaker or earpiece. On by default.
   */
  voiceProcessing: boolean
  /** Allow or disallow voice processing. Applied live. No-op on Android. */
  setVoiceProcessing: (enabled: boolean) => void
  /** The model's voice volume, 0 to 1. The default, 0.5, brings its speech up to music level. */
  voiceVolume: number
  /** Set the voice volume. Applied live. */
  setVoiceVolume: (volume: number) => void
  /** Register a tool the model can call (replaces any tool with the same name). */
  registerTool: (tool: OpenAILiveToolkitTool) => void
  /** Remove a registered tool by name. */
  unregisterTool: (name: string) => void
  /**
   * Open the share sheet with the log file, zipped with `diagnosticAudioSeconds` of recordings when
   * on. Rejects unless the provider has `logFile` on.
   */
  shareLogs: () => Promise<void>
  /**
   * iOS: stop the app's media if it keeps other apps' audio from playing
   * (`media.nowPlayingControls`), and resolve to whether they can play now. Call it before telling
   * another app, such as the Music app, to play. In the background it resolves to false and the
   * media keeps playing: iOS won't let the session mix again there, and another app playing would
   * cut the conversation off. The same goes for media that stopped in the background, until the
   * app is opened.
   */
  letOtherAudioPlay: () => Promise<boolean>
  /** iOS: whether `duckOtherApps` has other apps lowered. */
  otherAppsDucked: boolean
  /**
   * iOS: whether the app plays again what a `duckOtherApps` change pauses, such as the Music app it
   * controls; see {@link addOtherAppsDuckListener}. Other apps are lowered only while it does, and
   * while it doesn't, raising them waits for other apps to stop.
   */
  setOtherAudioResumable: (resumable: boolean) => void
  /**
   * iOS: called after each `duckOtherApps` change. The change paused the app that played; an app
   * that controls it can play it again when `othersCanPlay`.
   */
  addOtherAppsDuckListener: (listener: OtherAppsDuckListener) => OpenAILiveToolkitSubscription
}

const OpenAILiveToolkitContext = createContext<OpenAILiveToolkitContextValue | null>(null)

const VOICE_VOLUME_TOOL = voiceVolumeTool(openAILiveToolkit)

/** Props for {@link OpenAILiveToolkitProvider}. Settings seed initial state. */
export interface OpenAILiveToolkitProviderProps {
  /** Switchboard app ID. Optional: falls back to the shared default credentials. */
  appId?: string
  /** Switchboard app secret. Optional, with the same fallback as {@link appId}. */
  appSecret?: string
  /** Switchboard backend URL. Defaults to production. */
  apiUrl?: string
  /**
   * `'webrtc'` (default): the Switchboard backend creates the session with the app's OpenAI key.
   * `'websocket'`: straight to OpenAI with {@link openAIApiKey}. Fixed once the engine is built.
   */
  transport?: OpenAILiveTransport
  /** OpenAI API key, for the `websocket` transport. */
  openAIApiKey?: string
  /** ai-coustics license key. Speaker isolation needs it and a build with AICoustics. */
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
  /**
   * Close the session after this many ms with nobody talking, and reopen it when the user
   * speaks, continuing the conversation. Off by default. Fixed once initialized.
   */
  idleTimeoutMs?: number
  /**
   * After a wake, close again after this many ms unless the model replies. Defaults to 5000; 0 turns it off.
   * Fixed once initialized.
   */
  wakeGraceMs?: number
  /**
   * Continue the conversation when a session reopens: `start` after `stop` forks the session the
   * stop closed, and `start({ continueSessionId })` forks one the app saved. While on, OpenAI
   * stores each session. Off by default. Fixed once initialized.
   */
  continueConversation?: boolean
  /**
   * Let the delegate search the web, so the model can answer about weather, news and other
   * current information. Off by default; each search is billed. Fixed once initialized.
   */
  webSearch?: boolean
  /** Write the SDK's log and the toolkit's events to a file, for `shareLogs`. Off by default. */
  logFile?: boolean
  /** Include the transcript and tool arguments and results in the log. Off by default. */
  logConversation?: boolean
  /**
   * iOS, with `logFile`: keep this many seconds of audio from the microphone, what the model hears
   * and the output, which `shareLogs` zips with the log. Each takes about 0.4 MB of memory per
   * second. Off by default. Fixed once initialized.
   */
  diagnosticAudioSeconds?: number
  /** iOS: play alongside other apps' audio, like music, instead of stopping it. Off by default. */
  mixWithOthers?: boolean
  /** iOS 17+, with `mixWithOthers`: how far other apps' audio is lowered while someone talks. Defaults to `'min'`. */
  otherAudioDucking?: OtherAudioDucking
  /**
   * Media playing alongside the conversation from an http(s) URL, such as radio, with `useMedia()`
   * and `useMediaTools()`: `true`, or `{ loudness, nowPlayingControls }`. Off by default, with no
   * media nodes in the graph. Fixed once initialized.
   */
  media?: boolean | MediaOptions
  /**
   * iOS, with `mixWithOthers`: lower other apps' audio while a session is open over Bluetooth, or
   * on the speaker with `echoCancelledInput`, where voice processing doesn't. iOS pauses the app
   * that plays for each change, so they're lowered only while the app plays again what plays, such
   * as the Music app it controls (`setOtherAudioResumable` and `addOtherAppsDuckListener`), and
   * raising them waits while another app plays. Off by default.
   */
  duckOtherApps?: boolean
  /**
   * iOS 18.2+: on iPhones that support it, cancel the speaker's echo through the audio session
   * instead of voice processing, so Bluetooth connecting doesn't restart audio. No automatic gain
   * control, and other apps aren't lowered on the speaker. Fixed once the engine is built. Off by
   * default.
   */
  echoCancelledInput?: boolean
  /**
   * iOS: say so with the device's voice when the connection is lost, reconnect and restart media as
   * soon as it's back, and have the model say it's back. `true` says it in English. Off by default.
   */
  offlineNotice?: boolean | OfflineNotice
  /**
   * iOS, with a Bluetooth device connected: `'phone'` (default) plays over Bluetooth in high
   * quality with the phone's microphone; `'bluetooth'` uses the device's microphone, with
   * call-quality audio. Also settable via the hook.
   */
  microphone?: Microphone
  /** Called for every failure, including non-fatal ones that never reach `error`. */
  onError?: (error: OpenAILiveError) => void
  children?: ReactNode
}

/** Initializes the toolkit and exposes its state and controls via {@link useOpenAILiveToolkit}. */
export function OpenAILiveToolkitProvider(props: OpenAILiveToolkitProviderProps) {
  const { appId, appSecret, apiUrl, transport, openAIApiKey, aiCousticsLicenseKey, children } =
    props
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
  const [sessionState, setSessionState] = useState<'none' | 'connecting' | 'connected' | 'idle'>(
    'none'
  )
  const [activity, setActivity] = useState<OpenAILiveActivity>('listening')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionContinued, setSessionContinued] = useState(false)
  const entryIdRef = useRef(0)
  // Shift applied to the current session's fragment times, so a new session (whose timeline
  // restarts at 0) continues after the existing transcript.
  const timelineOffsetRef = useRef(0)
  const [hasMicrophonePermission, setHasMicrophonePermission] = useState<boolean | null>(null)
  const [instructions, setInstructionsState] = useState(props.instructions ?? '')
  const [voice, setVoiceState] = useState<OpenAIVoice>(props.voice ?? DEFAULT_VOICE)
  const [model] = useState(props.model ?? DEFAULT_MODEL)
  const [isolationSupported, setIsolationSupported] = useState(false)
  const [isolationAvailable, setIsolationAvailable] = useState(false)
  const [isolationEnabled, setIsolationEnabled] = useState(props.speakerIsolation ?? true)
  const [muted, setMutedState] = useState(false)
  const [voiceProcessing, setVoiceProcessingState] = useState(true)
  const [voiceVolume, setVoiceVolumeState] = useState(toolkitRef.current.voiceVolume)
  const [microphone, setMicrophoneState] = useState<Microphone>(props.microphone ?? 'phone')
  const [bluetoothConnected, setBluetoothConnected] = useState(false)
  const [otherAppsDucked, setOtherAppsDucked] = useState(false)

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
      apiUrl,
      transport,
      openAIApiKey,
      aiCousticsLicenseKey,
      instructions,
      voice,
      model,
      delegateModel: props.delegateModel,
      delegateInstructions: props.delegateInstructions,
      speakerIsolation: isolationEnabled,
      idleTimeoutMs: props.idleTimeoutMs,
      wakeGraceMs: props.wakeGraceMs,
      continueConversation: props.continueConversation,
      webSearch: props.webSearch,
      logFile: props.logFile,
      logConversation: props.logConversation,
      diagnosticAudioSeconds: props.diagnosticAudioSeconds,
      mixWithOthers: props.mixWithOthers,
      otherAudioDucking: props.otherAudioDucking,
      duckOtherApps: props.duckOtherApps,
      echoCancelledInput: props.echoCancelledInput,
      media: props.media,
      offlineNotice: props.offlineNotice,
      microphone,
    })
    setIsRunning(toolkit.isRunning)
    setIsolationSupported(toolkit.isSpeakerIsolationSupported)
    setIsolationAvailable(toolkit.isSpeakerIsolationAvailable)
    setBluetoothConnected(toolkit.isBluetoothConnected())
    const bluetoothSub = toolkit.addBluetoothListener(setBluetoothConnected)
    setOtherAppsDucked(toolkit.otherAppsDucked)
    const duckSub = toolkit.addOtherAppsDuckListener(setOtherAppsDucked)

    const nextId = () => ++entryIdRef.current
    let activityTimer: ReturnType<typeof setTimeout> | null = null
    // Show `next`, back to listening after `ms` unless another event comes first.
    const showActivity = (next: OpenAILiveActivity, ms?: number) => {
      if (activityTimer) {
        clearTimeout(activityTimer)
        activityTimer = null
      }
      setActivity(next)
      if (ms !== undefined) {
        activityTimer = setTimeout(() => {
          activityTimer = null
          setActivity('listening')
        }, ms)
      }
    }
    const sub = toolkit.addEventListener('live', (e) => {
      switch (e.name) {
        case 'sessionStarting':
        case 'sessionDisconnected':
          setSessionState('connecting')
          showActivity('listening')
          break
        case 'sessionStarted':
          showActivity('listening')
          setSessionState('connected')
          setError(null)
          setSessionId((e.data as { sessionId?: string } | undefined)?.sessionId || null)
          setSessionContinued((e.data as { continued?: boolean } | undefined)?.continued ?? false)
          // Read and set inside the updater so it's ordered with the fragment updates below.
          setTranscript((entries) => {
            timelineOffsetRef.current = nextSessionOffset(entries)
            return entries
          })
          break
        case 'sessionEnded':
          setSessionState('idle')
          showActivity('listening')
          break
        case 'sessionClosed': {
          const reason = (e.data as { reason?: string })?.reason
          setSessionState(reason === 'close_requested' ? 'none' : 'connecting')
          showActivity('listening')
          break
        }
        case 'delegationCreated':
          showActivity('thinking', THINKING_TIMEOUT_MS)
          break
        case 'inputTranscriptDelta':
        case 'outputTranscriptDelta': {
          const d = e.data as { delta?: string; startMs?: number; endMs?: number }
          const speaker = e.name === 'inputTranscriptDelta' ? 'user' : 'assistant'
          showActivity(speaker === 'user' ? 'userSpeaking' : 'speaking', ACTIVITY_TAIL_MS)
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
    // The model's set_voice_volume tool changes it too.
    setVoiceVolumeState(toolkit.voiceVolume)
    const voiceVolumeSub = toolkit.addVoiceVolumeListener(setVoiceVolumeState)
    // Speech the transcript hasn't caught up with yet; only there in idle mode.
    const vadSub = toolkit.addEventListener('vad', (e) => {
      if (e.name === 'speechStarted') {
        showActivity('userSpeaking')
      } else if (e.name === 'speechEnded') {
        setActivity((current) => (current === 'userSpeaking' ? 'listening' : current))
      }
    })
    return () => {
      // Detach this view's listeners only — the engine's lifecycle is app-owned.
      sub.remove()
      errorSub.remove()
      bluetoothSub.remove()
      duckSub.remove()
      voiceVolumeSub.remove()
      vadSub.remove()
      if (activityTimer) {
        clearTimeout(activityTimer)
      }
    }
    // Settings are init-only seeds here; runtime changes go through the setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, appSecret, apiUrl, transport, openAIApiKey, aiCousticsLicenseKey, reportError])

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

  const start = useCallback(
    async (options?: OpenAILiveStartOptions) => {
      setError(null)
      try {
        if (!(await requestMicrophonePermission())) {
          reportError(
            new OpenAILiveError('MIC_PERMISSION_DENIED', 'Microphone permission denied', true)
          )
          return
        }
        await toolkitRef.current?.start(options)
        setIsRunning(true)
      } catch (err) {
        reportError(asLiveError(err, 'ENGINE_START_FAILED', true))
      }
    },
    [requestMicrophonePermission, reportError]
  )

  const stop = useCallback(() => {
    try {
      toolkitRef.current?.stop()
      setIsRunning(false)
      setSessionState('none')
      setError(null)
    } catch (err) {
      // The graph is still live, so leave isRunning true.
      reportError(asLiveError(err, 'ENGINE_STOP_FAILED', true))
    }
  }, [reportError])

  const release = useCallback(() => {
    toolkitRef.current?.release()
    setIsRunning(false)
    setSessionState('none')
    setError(null)
  }, [])

  const clearTranscript = useCallback(() => setTranscript([]), [])

  const shareLogs = useCallback(() => toolkitRef.current.shareLogs(), [])

  const newConversation = useCallback(() => {
    toolkitRef.current?.newConversation()
    setSessionId(null)
    setTranscript([])
  }, [])

  const setInstructions = useCallback((next: string) => {
    setInstructionsState(next)
    toolkitRef.current?.setInstructions(next)
  }, [])
  const addContext = useCallback(
    (text: string) => toolkitRef.current?.addContext(text) ?? false,
    []
  )
  const setSessionNote = useCallback(
    (key: string, text: string, options?: { onlyUpdate?: boolean }) =>
      toolkitRef.current?.setSessionNote(key, text, options),
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

  const setVoiceProcessing = useCallback((next: boolean) => {
    if (Platform.OS !== 'ios') {
      return
    }
    setVoiceProcessingState(next)
    toolkitRef.current?.setVoiceProcessing(next)
  }, [])

  const setVoiceVolume = useCallback((next: number) => toolkitRef.current?.setVoiceVolume(next), [])

  const setMicrophone = useCallback((next: Microphone) => {
    if (Platform.OS !== 'ios') {
      return
    }
    setMicrophoneState(next)
    toolkitRef.current?.setMicrophone(next)
  }, [])

  const registerTool = useCallback((tool: OpenAILiveToolkitTool) => {
    toolkitRef.current?.registerTool(tool)
  }, [])
  const unregisterTool = useCallback((name: string) => {
    toolkitRef.current?.unregisterTool(name)
  }, [])

  const letOtherAudioPlay = useCallback(() => toolkitRef.current.letOtherAudioPlay(), [])
  const setOtherAudioResumable = useCallback(
    (resumable: boolean) => toolkitRef.current.setOtherAudioResumable(resumable),
    []
  )
  const addOtherAppsDuckListener = useCallback(
    (listener: OtherAppsDuckListener) => toolkitRef.current.addOtherAppsDuckListener(listener),
    []
  )

  const connectionStatus: OpenAILiveToolkitConnectionStatus =
    error?.code === 'SESSION_FAILED' ? 'error' : sessionState

  const value: OpenAILiveToolkitContextValue = {
    isRunning,
    error,
    connectionStatus,
    activity,
    transcript,
    clearTranscript,
    start,
    stop,
    release,
    sessionId,
    sessionContinued,
    newConversation,
    hasMicrophonePermission,
    requestMicrophonePermission,
    instructions,
    setInstructions,
    addContext,
    setSessionNote,
    say,
    voice,
    setVoice,
    model,
    speakerIsolation: {
      supported: isolationSupported,
      available: isolationAvailable,
      enabled: isolationEnabled,
      setEnabled: setSpeakerIsolationEnabled,
    },
    bluetooth: { connected: bluetoothConnected, microphone, setMicrophone },
    muted,
    setMuted,
    voiceProcessing,
    setVoiceProcessing,
    voiceVolume,
    setVoiceVolume,
    registerTool,
    unregisterTool,
    shareLogs,
    letOtherAudioPlay,
    otherAppsDucked,
    setOtherAudioResumable,
    addOtherAppsDuckListener,
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
 * Calls `listener` with how loud the user and the model are, every 50 ms while the engine runs and
 * the app is on screen, and once with zeros when that ends. It doesn't re-render: drive an
 * animation from it.
 */
export function useVoiceLevels(listener: (levels: VoiceLevels) => void): void {
  const listenerRef = useRef(listener)
  listenerRef.current = listener
  // 'unknown' early on and 'inactive' under Control Center still count as on screen.
  const [onScreen, setOnScreen] = useState(AppState.currentState !== 'background')

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setOnScreen(state !== 'background')
    )
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!onScreen) {
      return
    }
    const subscription = openAILiveToolkit.addVoiceLevelListener((levels) =>
      listenerRef.current(levels)
    )
    return () => subscription.remove()
  }, [onScreen])
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

/**
 * Let the model set its own voice's volume while this component is mounted, for "speak up",
 * "quieter" and "I can't hear you": registers set_voice_volume. Without it GPT-Live says it speaks
 * louder and nothing changes.
 */
export function useVoiceVolumeTool(): void {
  useTool(VOICE_VOLUME_TOOL)
}
