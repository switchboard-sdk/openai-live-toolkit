import React, { type ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react-native'
import { AppState } from 'react-native'

// The provider's job: credential validation, wiring the Live event channel to React
// state, and keeping the setters reactive while delegating to the engine. Asserted
// against a spy of the app-wide singleton.
jest.mock('./NativeOpenAILiveToolkit')
jest.mock('./OpenAILiveToolkit')

import {
  OpenAILiveToolkitProvider,
  useOpenAILiveToolkit,
  useVoiceLevels,
  useVoiceVolumeTool,
} from './OpenAILiveToolkitProvider'
import { OpenAILiveError } from './OpenAILiveToolkit'

const mockModule = jest.requireMock(
  './OpenAILiveToolkit'
) as typeof import('./__mocks__/OpenAILiveToolkit')
const toolkit = mockModule.openAILiveToolkit as Record<string, any>
const emitLive = (name: string, data?: unknown) => act(() => mockModule.__emitLive(name, data))
const emitVad = (name: string) => act(() => mockModule.__emitVad(name))

const CREDS = {
  appId: 'app-1',
  appSecret: 'secret-1',
  transport: 'websocket' as const,
  openAIApiKey: 'sk-1',
  aiCousticsLicenseKey: 'aic-1',
}

function renderProvider(
  props: Partial<React.ComponentProps<typeof OpenAILiveToolkitProvider>> = {}
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OpenAILiveToolkitProvider {...CREDS} {...props}>
      {children}
    </OpenAILiveToolkitProvider>
  )
  return renderHook(() => useOpenAILiveToolkit(), { wrapper })
}

beforeEach(() => {
  jest.clearAllMocks()
  toolkit.initError = null
  toolkit.isRunning = false
  toolkit.isSpeakerIsolationSupported = true
  toolkit.isSpeakerIsolationAvailable = true
  toolkit.start.mockImplementation(() => Promise.resolve())
  toolkit.requestMicrophonePermission.mockImplementation(() => Promise.resolve(true))
  toolkit.isBluetoothConnected.mockReturnValue(false)
})

describe('initialization', () => {
  it('initializes the engine with credentials and seeds', () => {
    renderProvider({
      apiUrl: 'https://example.switchboard.audio',
      instructions: 'Be terse.',
      voice: 'cedar',
      speakerIsolation: false,
      delegateModel: 'gpt-6',
      media: { loudness: -14 },
    })
    expect(toolkit.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        ...CREDS,
        apiUrl: 'https://example.switchboard.audio',
        instructions: 'Be terse.',
        voice: 'cedar',
        model: 'gpt-live-1',
        delegateModel: 'gpt-6',
        speakerIsolation: false,
        media: { loudness: -14 },
      })
    )
  })

  it('exposes defaults before anything happens', () => {
    const { result } = renderProvider()
    expect(result.current).toMatchObject({
      isRunning: false,
      error: null,
      connectionStatus: 'none',
      transcript: [],
      voice: 'marin',
      model: 'gpt-live-1',
      muted: false,
      bluetooth: { connected: false, microphone: 'phone' },
      speakerIsolation: { supported: true, available: true, enabled: true },
    })
  })

  it('follows Bluetooth devices coming and going', () => {
    toolkit.isBluetoothConnected.mockReturnValue(true)
    const { result } = renderProvider()
    expect(result.current.bluetooth.connected).toBe(true)
    act(() => mockModule.__emitBluetooth(false))
    expect(result.current.bluetooth.connected).toBe(false)
  })

  it('follows other apps being lowered', () => {
    const { result } = renderProvider({ duckOtherApps: true })
    expect(toolkit.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ duckOtherApps: true })
    )
    expect(result.current.otherAppsDucked).toBe(false)
    act(() => mockModule.__emitOtherAppsDuck(true, true))
    expect(result.current.otherAppsDucked).toBe(true)

    const listener = jest.fn()
    result.current.addOtherAppsDuckListener(listener)
    expect(toolkit.addOtherAppsDuckListener).toHaveBeenLastCalledWith(listener)
    result.current.setOtherAudioResumable(true)
    expect(toolkit.setOtherAudioResumable).toHaveBeenCalledWith(true)
  })

  it('reports isolation as unavailable when the engine has no license key', () => {
    toolkit.isSpeakerIsolationAvailable = false
    const { result } = renderProvider()
    expect(result.current.speakerIsolation.available).toBe(false)
  })

  it('reports isolation as unsupported when the build has no AICoustics', () => {
    toolkit.isSpeakerIsolationSupported = false
    toolkit.isSpeakerIsolationAvailable = false
    const { result } = renderProvider()
    expect(result.current.speakerIsolation).toMatchObject({ supported: false, available: false })
  })

  it('throws for a blank Switchboard credential', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderProvider({ appId: ' ' })).toThrow('appId')
    expect(() => renderProvider({ appSecret: '' })).toThrow('appSecret')
  })

  it('lands an SDK refusal in error', () => {
    toolkit.initError = 'bad creds'
    const { result } = renderProvider()
    expect(result.current.error?.code).toBe('INIT_FAILED')
  })

  it('detaches its listeners on unmount', () => {
    const { unmount } = renderProvider()
    expect(mockModule.__hasListeners()).toBe(true)
    unmount()
    expect(mockModule.__hasListeners()).toBe(false)
  })
})

describe('session state', () => {
  it('follows the session lifecycle events', () => {
    const { result } = renderProvider()
    emitLive('sessionStarting')
    expect(result.current.connectionStatus).toBe('connecting')
    emitLive('sessionStarted', { sessionId: 's1' })
    expect(result.current.connectionStatus).toBe('connected')
    emitLive('sessionClosed', { reason: 'expired' })
    expect(result.current.connectionStatus).toBe('connecting')
    emitLive('sessionStarted', { sessionId: 's2' })
    emitLive('sessionClosed', { reason: 'close_requested' })
    expect(result.current.connectionStatus).toBe('none')
  })

  it('says whether the session continues the conversation', () => {
    const { result } = renderProvider()
    emitLive('sessionStarted', { sessionId: 's1', continued: false })
    expect(result.current.sessionContinued).toBe(false)
    emitLive('sessionStarted', { sessionId: 's2', continued: true })
    expect(result.current.sessionContinued).toBe(true)
    emitLive('sessionStarted', { sessionId: 's3' })
    expect(result.current.sessionContinued).toBe(false)
  })

  it("shows 'idle' while idle mode has the session closed", () => {
    const { result } = renderProvider({ idleTimeoutMs: 20_000 })
    expect(toolkit.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ idleTimeoutMs: 20_000 })
    )
    emitLive('sessionStarted', { sessionId: 's1' })
    emitLive('sessionEnded')
    expect(result.current.connectionStatus).toBe('idle')
    emitLive('sessionStarting')
    expect(result.current.connectionStatus).toBe('connecting')
  })

  it("shows 'error' for a fatal session failure until a session comes up", () => {
    const { result } = renderProvider()
    act(() => mockModule.__emitError(new OpenAILiveError('SESSION_FAILED', 'invalid key', true)))
    expect(result.current.connectionStatus).toBe('error')
    emitLive('sessionStarting')
    expect(result.current.connectionStatus).toBe('error')
    emitLive('sessionStarted')
    expect(result.current.connectionStatus).toBe('connected')
    expect(result.current.error).toBeNull()
  })

  it('keeps non-fatal failures out of error but passes them to onError', () => {
    const onError = jest.fn()
    const { result } = renderProvider({ onError })
    const err = new OpenAILiveError('TOOL_HANDLER_FAILED', 'boom', false)
    act(() => mockModule.__emitError(err))
    expect(result.current.error).toBeNull()
    expect(onError).toHaveBeenCalledWith(err)
  })
})

describe('activity', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const connected = () => {
    const rendered = renderProvider()
    emitLive('sessionStarted', { sessionId: 's1' })
    return rendered
  }

  it('is listening once a session starts', () => {
    const { result } = connected()
    expect(result.current.activity).toBe('listening')
  })

  it("is speaking while the model's transcript arrives, and listening a second after", () => {
    const { result } = connected()
    emitLive('outputTranscriptDelta', { delta: 'Sure.', startMs: 0, endMs: 400 })
    expect(result.current.activity).toBe('speaking')
    act(() => jest.advanceTimersByTime(900))
    emitLive('outputTranscriptDelta', { delta: ' Here.', startMs: 400, endMs: 800 })
    act(() => jest.advanceTimersByTime(900))
    expect(result.current.activity).toBe('speaking')
    act(() => jest.advanceTimersByTime(200))
    expect(result.current.activity).toBe('listening')
  })

  it("is userSpeaking while the user's transcript arrives", () => {
    const { result } = connected()
    emitLive('inputTranscriptDelta', { delta: 'Play jazz', startMs: 0, endMs: 600 })
    expect(result.current.activity).toBe('userSpeaking')
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current.activity).toBe('listening')
  })

  it('is thinking from a delegation until the model speaks', () => {
    const { result } = connected()
    emitLive('delegationCreated', { delegationId: 'd1', target: 'client' })
    expect(result.current.activity).toBe('thinking')
    act(() => jest.advanceTimersByTime(5000))
    expect(result.current.activity).toBe('thinking')
    emitLive('outputTranscriptDelta', { delta: 'Playing.', startMs: 0, endMs: 400 })
    expect(result.current.activity).toBe('speaking')
  })

  it('stops thinking after a while without speech', () => {
    const { result } = connected()
    emitLive('delegationCreated', { delegationId: 'd1', target: 'client' })
    act(() => jest.advanceTimersByTime(15_000))
    expect(result.current.activity).toBe('listening')
  })

  it('follows the voice activity detector, which only ends the user speaking', () => {
    const { result } = connected()
    emitVad('speechStarted')
    expect(result.current.activity).toBe('userSpeaking')
    act(() => jest.advanceTimersByTime(5000))
    expect(result.current.activity).toBe('userSpeaking')
    emitVad('speechEnded')
    expect(result.current.activity).toBe('listening')
    emitLive('delegationCreated', { delegationId: 'd1', target: 'client' })
    emitVad('speechEnded')
    expect(result.current.activity).toBe('thinking')
  })

  it('goes back to listening when the session closes', () => {
    const { result } = connected()
    emitLive('outputTranscriptDelta', { delta: 'Sure.', startMs: 0, endMs: 400 })
    emitLive('sessionEnded')
    expect(result.current.activity).toBe('listening')
  })
})

describe('transcript', () => {
  it('builds entries from both speakers and clears them', () => {
    const { result } = renderProvider()
    emitLive('inputTranscriptDelta', { delta: ' What time', startMs: 0, endMs: 200 })
    emitLive('inputTranscriptDelta', { delta: ' is it', startMs: 200, endMs: 400 })
    emitLive('outputTranscriptDelta', { delta: ' It is noon.', startMs: 800, endMs: 1000 })
    expect(result.current.transcript.map((e) => [e.speaker, e.text])).toEqual([
      ['user', 'What time is it'],
      ['assistant', 'It is noon.'],
    ])
    act(() => result.current.clearTranscript())
    expect(result.current.transcript).toEqual([])
  })

  it("doesn't merge a new session's lines into the previous session's", () => {
    const { result } = renderProvider()
    emitLive('sessionStarted', { sessionId: 's1' })
    emitLive('inputTranscriptDelta', { delta: ' First session', startMs: 30000, endMs: 30200 })
    emitLive('sessionStarted', { sessionId: 's2' })
    // The new session's timeline starts at 0 again.
    emitLive('inputTranscriptDelta', { delta: ' Second session', startMs: 0, endMs: 200 })
    emitLive('inputTranscriptDelta', { delta: ' continues', startMs: 200, endMs: 400 })
    expect(result.current.transcript.map((e) => e.text)).toEqual([
      'First session',
      'Second session continues',
    ])
  })
})

describe('start / stop / release', () => {
  it('start requests the mic, starts the engine and marks running', async () => {
    const { result } = renderProvider()
    await act(() => result.current.start())
    expect(toolkit.start).toHaveBeenCalled()
    expect(result.current.isRunning).toBe(true)
    expect(result.current.hasMicrophonePermission).toBe(true)
  })

  it('a denied mic lands in error without starting', async () => {
    toolkit.requestMicrophonePermission.mockImplementation(() => Promise.resolve(false))
    const { result } = renderProvider()
    await act(() => result.current.start())
    expect(toolkit.start).not.toHaveBeenCalled()
    expect(result.current.error?.code).toBe('MIC_PERMISSION_DENIED')
  })

  it('a failed start lands in error with its code', async () => {
    toolkit.start.mockImplementation(() =>
      Promise.reject(new OpenAILiveError('MISSING_API_KEY', 'no key', true))
    )
    const { result } = renderProvider()
    await act(() => result.current.start())
    expect(result.current.error?.code).toBe('MISSING_API_KEY')
    expect(result.current.isRunning).toBe(false)
  })

  it('wraps an unexpected throw as ENGINE_START_FAILED', async () => {
    toolkit.start.mockImplementation(() => Promise.reject(new Error('weird')))
    const { result } = renderProvider()
    await act(() => result.current.start())
    expect(result.current.error).toMatchObject({ code: 'ENGINE_START_FAILED', message: 'weird' })
  })

  it('stop clears running and session state; a refused stop keeps running', async () => {
    const { result } = renderProvider()
    await act(() => result.current.start())
    emitLive('sessionStarted')
    act(() => result.current.stop())
    expect(result.current.isRunning).toBe(false)
    expect(result.current.connectionStatus).toBe('none')

    await act(() => result.current.start())
    toolkit.stop.mockImplementation(() => {
      throw new OpenAILiveError('ENGINE_STOP_FAILED', 'nope', true)
    })
    act(() => result.current.stop())
    expect(result.current.isRunning).toBe(true)
    expect(result.current.error?.code).toBe('ENGINE_STOP_FAILED')
  })

  it('release clears running', async () => {
    const { result } = renderProvider()
    await act(() => result.current.start())
    act(() => result.current.release())
    expect(toolkit.release).toHaveBeenCalled()
    expect(result.current.isRunning).toBe(false)
  })

  it('start passes a saved session through', async () => {
    const { result } = renderProvider()
    await act(() => result.current.start({ continueSessionId: 'saved' }))
    expect(toolkit.start).toHaveBeenCalledWith({ continueSessionId: 'saved' })
  })
})

describe('conversation', () => {
  it('sessionId follows the latest session; newConversation clears it and the transcript', () => {
    const { result } = renderProvider()
    expect(result.current.sessionId).toBeNull()
    emitLive('sessionStarted', { sessionId: 's1' })
    emitLive('inputTranscriptDelta', { delta: ' Hello', startMs: 0, endMs: 200 })
    expect(result.current.sessionId).toBe('s1')
    act(() => result.current.newConversation())
    expect(toolkit.newConversation).toHaveBeenCalled()
    expect(result.current.sessionId).toBeNull()
    expect(result.current.transcript).toEqual([])
  })
})

describe('setters delegate and stay reactive', () => {
  it('instructions, voice, isolation, Bluetooth, mute, voice processing and volume', () => {
    const { result } = renderProvider()
    act(() => result.current.setInstructions('New prompt'))
    act(() => result.current.setVoice('cedar'))
    act(() => result.current.speakerIsolation.setEnabled(false))
    act(() => result.current.bluetooth.setMicrophone('bluetooth'))
    act(() => result.current.setMuted(true))
    act(() => result.current.setVoiceProcessing(false))
    act(() => result.current.setVoiceVolume(0.8))
    expect(toolkit.setInstructions).toHaveBeenCalledWith('New prompt')
    expect(toolkit.setVoice).toHaveBeenCalledWith('cedar')
    expect(toolkit.setSpeakerIsolation).toHaveBeenCalledWith(false)
    expect(toolkit.setMicrophone).toHaveBeenCalledWith('bluetooth')
    expect(toolkit.setMuted).toHaveBeenCalledWith(true)
    expect(toolkit.setVoiceProcessing).toHaveBeenCalledWith(false)
    expect(toolkit.setVoiceVolume).toHaveBeenCalledWith(0.8)
    expect(result.current).toMatchObject({
      instructions: 'New prompt',
      voice: 'cedar',
      bluetooth: { microphone: 'bluetooth' },
      muted: true,
      voiceProcessing: false,
      voiceVolume: 0.8,
      speakerIsolation: { enabled: false },
    })
  })

  it('context actions pass through their delivery result', () => {
    const { result } = renderProvider()
    expect(result.current.addContext('b')).toBe(true)
    toolkit.say.mockReturnValue(false)
    expect(result.current.say('c')).toBe(false)
    expect(toolkit.addContext).toHaveBeenCalledWith('b')
  })
})

describe('useVoiceVolumeTool', () => {
  function renderVoiceVolumeTool() {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <OpenAILiveToolkitProvider {...CREDS}>{children}</OpenAILiveToolkitProvider>
    )
    return renderHook(() => useVoiceVolumeTool(), { wrapper })
  }

  beforeEach(() => {
    toolkit.voiceVolume = 0.5
  })

  it('registers set_voice_volume while mounted', () => {
    const { unmount } = renderVoiceVolumeTool()
    expect(toolkit.registerTool).toHaveBeenCalledTimes(1)
    expect(toolkit.registerTool.mock.calls[0][0].name).toBe('set_voice_volume')
    unmount()
    expect(toolkit.unregisterTool).toHaveBeenCalledWith('set_voice_volume')
  })

  it("sets the toolkit's voice volume", async () => {
    renderVoiceVolumeTool()
    const { handler } = toolkit.registerTool.mock.calls[0][0]
    expect(await handler({ change: 20 })).toEqual({ volume: 70 })
    expect(toolkit.setVoiceVolume).toHaveBeenLastCalledWith(0.7)
  })
})

describe('useVoiceLevels', () => {
  let appStateChange: ((state: string) => void) | null = null

  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateChange = handler as (state: string) => void
      return { remove: jest.fn() } as any
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function renderLevels(listener: (levels: unknown) => void) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <OpenAILiveToolkitProvider {...CREDS}>{children}</OpenAILiveToolkitProvider>
    )
    return renderHook(() => useVoiceLevels(listener), { wrapper })
  }

  it('passes the levels on without re-rendering, and lets go on unmount', () => {
    const listener = jest.fn()
    let renders = 0
    const wrapper = ({ children }: { children: ReactNode }) => (
      <OpenAILiveToolkitProvider {...CREDS}>{children}</OpenAILiveToolkitProvider>
    )
    const { unmount } = renderHook(
      () => {
        renders++
        useVoiceLevels(listener)
      },
      { wrapper }
    )
    const before = renders
    act(() => mockModule.__emitVoiceLevels({ input: 0.3, output: 0.6 }))
    expect(listener).toHaveBeenCalledWith({ input: 0.3, output: 0.6 })
    expect(renders).toBe(before)
    unmount()
    expect(mockModule.__hasVoiceLevelListener()).toBe(false)
  })

  it('listens only while the app is on screen', () => {
    const listener = jest.fn()
    renderLevels(listener)
    expect(mockModule.__hasVoiceLevelListener()).toBe(true)
    act(() => appStateChange?.('background'))
    expect(mockModule.__hasVoiceLevelListener()).toBe(false)
    act(() => appStateChange?.('active'))
    expect(mockModule.__hasVoiceLevelListener()).toBe(true)
  })
})
