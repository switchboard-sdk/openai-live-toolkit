// Manual Jest mock of the app-wide toolkit, for suites that test the provider and hooks on top
// of it. Jest uses this file when a suite calls `jest.mock('./OpenAILiveToolkit')`. Its methods
// are jest mocks; the `__emit*` functions push events through the listeners the provider added.

import { OpenAILiveError } from '../errors'

export { OpenAILiveError }

const eventListeners: Record<string, ((e: any) => void) | null> = {}
let errorListener: ((e: any) => void) | null = null
let bluetoothListener: ((connected: boolean) => void) | null = null
let duckListener: ((ducked: boolean, othersCanPlay: boolean) => void) | null = null
let voiceLevelListener: ((levels: any) => void) | null = null
let voiceVolumeListener: ((volume: number) => void) | null = null
let mediaStatusListener: (() => void) | null = null

export const NO_MEDIA = {
  url: null,
  station: null,
  state: 'idle',
  playing: false,
  live: false,
  duration: 0,
  metadata: null,
  error: null,
  volume: 1,
}

export const openAILiveToolkit: Record<string, any> = {
  initialize: jest.fn(() => {
    if (openAILiveToolkit.initError) {
      errorListener?.(new OpenAILiveError('INIT_FAILED', openAILiveToolkit.initError, true))
    }
  }),
  isRunning: false,
  isSpeakerIsolationSupported: true,
  isSpeakerIsolationAvailable: true,
  initError: null as string | null,
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(),
  release: jest.fn(),
  newConversation: jest.fn(),
  requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
  setInstructions: jest.fn(),
  addContext: jest.fn(() => true),
  say: jest.fn(() => true),
  setVoice: jest.fn(),
  setSpeakerIsolation: jest.fn(),
  setMicrophone: jest.fn(),
  setVoiceProcessing: jest.fn(),
  voiceVolume: 0.5,
  setVoiceVolume: jest.fn((volume: number) => {
    openAILiveToolkit.voiceVolume = Math.min(1, Math.max(0, volume))
    voiceVolumeListener?.(openAILiveToolkit.voiceVolume)
  }),
  addVoiceVolumeListener: jest.fn((listener: (volume: number) => void) => {
    voiceVolumeListener = listener
    return { remove: jest.fn(() => (voiceVolumeListener = null)) }
  }),
  isBluetoothConnected: jest.fn(() => false),
  addBluetoothListener: jest.fn((listener: (connected: boolean) => void) => {
    bluetoothListener = listener
    return { remove: jest.fn(() => (bluetoothListener = null)) }
  }),
  setMuted: jest.fn(),
  registerTool: jest.fn(),
  unregisterTool: jest.fn(),
  setSessionNote: jest.fn(),
  letOtherAudioPlay: jest.fn(() => Promise.resolve(true)),
  otherAppsDucked: false,
  setOtherAudioResumable: jest.fn(),
  addOtherAppsDuckListener: jest.fn(
    (listener: (ducked: boolean, othersCanPlay: boolean) => void) => {
      duckListener = listener
      return { remove: jest.fn(() => (duckListener = null)) }
    }
  ),
  addVoiceLevelListener: jest.fn((listener: (levels: any) => void) => {
    voiceLevelListener = listener
    return { remove: jest.fn(() => (voiceLevelListener = null)) }
  }),
  addEventListener: jest.fn((type: string, listener: (e: any) => void) => {
    eventListeners[type] = listener
    return { remove: jest.fn(() => (eventListeners[type] = null)) }
  }),
  addErrorListener: jest.fn((listener: (e: any) => void) => {
    errorListener = listener
    return { remove: jest.fn(() => (errorListener = null)) }
  }),
  reportError: jest.fn((error: OpenAILiveError) => errorListener?.(error)),
  shareLogs: jest.fn(() => Promise.resolve()),
  media: {
    status: { ...NO_MEDIA } as Record<string, unknown>,
    addStatusListener: jest.fn((listener: () => void) => {
      mediaStatusListener = listener
      return { remove: jest.fn(() => (mediaStatusListener = null)) }
    }),
    play: jest.fn(),
    waitForStart: jest.fn(() => Promise.resolve(openAILiveToolkit.media.status)),
    pause: jest.fn(),
    resume: jest.fn(),
    stop: jest.fn(),
    seek: jest.fn(() => 0),
    position: jest.fn(() => 0),
    setVolume: jest.fn(),
    setTools: jest.fn(),
  },
}

export const __emitLive = (name: string, data?: unknown) =>
  eventListeners.live?.({ type: 'live', name, data })
export const __emitVad = (name: string) => eventListeners.vad?.({ type: 'vad', name })
export const __emitError = (e: any) => errorListener?.(e)
export const __emitBluetooth = (connected: boolean) => bluetoothListener?.(connected)
export const __emitOtherAppsDuck = (ducked: boolean, othersCanPlay: boolean) =>
  duckListener?.(ducked, othersCanPlay)
export const __emitVoiceLevels = (levels: unknown) => voiceLevelListener?.(levels)
export const __emitMediaStatus = (status: Record<string, unknown>) => {
  openAILiveToolkit.media.status = status
  mediaStatusListener?.()
}
export const __hasVoiceLevelListener = () => voiceLevelListener !== null
export const __hasListeners = () =>
  Boolean(eventListeners.live) &&
  Boolean(eventListeners.vad) &&
  errorListener !== null &&
  voiceVolumeListener !== null
