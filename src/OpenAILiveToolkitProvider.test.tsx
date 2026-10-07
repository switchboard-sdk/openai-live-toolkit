import React, { type ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react-native'

// The provider's job: credential validation, wiring the Live event channel to React
// state, and keeping the setters reactive while delegating to the engine. Asserted
// against a spy of the app-wide singleton.
jest.mock('./NativeOpenAILiveToolkit')

jest.mock('./OpenAILiveToolkit', () => {
  // The real error class — the provider branches on `instanceof`.
  const { OpenAILiveError } = jest.requireActual('./OpenAILiveToolkit')
  let liveListener: ((e: any) => void) | null = null
  let errorListener: ((e: any) => void) | null = null
  const openAILiveToolkit = {
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
    requestMicrophonePermission: jest.fn(() => Promise.resolve(true)),
    setInstructions: jest.fn(),
    appendInstructions: jest.fn(() => true),
    addContext: jest.fn(() => true),
    say: jest.fn(() => true),
    setVoice: jest.fn(),
    setSpeakerIsolation: jest.fn(),
    setMuted: jest.fn(),
    registerTool: jest.fn(),
    unregisterTool: jest.fn(),
    addEventListener: jest.fn((_type: string, listener: (e: any) => void) => {
      liveListener = listener
      return { remove: jest.fn(() => (liveListener = null)) }
    }),
    addErrorListener: jest.fn((listener: (e: any) => void) => {
      errorListener = listener
      return { remove: jest.fn(() => (errorListener = null)) }
    }),
  }
  return {
    openAILiveToolkit,
    OpenAILiveError,
    __emitLive: (name: string, data?: unknown) => liveListener?.({ type: 'live', name, data }),
    __emitError: (e: any) => errorListener?.(e),
    __hasListeners: () => liveListener !== null && errorListener !== null,
  }
})

import { OpenAILiveToolkitProvider, useOpenAILiveToolkit } from './OpenAILiveToolkitProvider'
import { OpenAILiveError } from './OpenAILiveToolkit'

const mockModule = jest.requireMock('./OpenAILiveToolkit') as {
  openAILiveToolkit: Record<string, any>
  __emitLive: (name: string, data?: unknown) => void
  __emitError: (e: OpenAILiveError) => void
  __hasListeners: () => boolean
}
const toolkit = mockModule.openAILiveToolkit
const emitLive = (name: string, data?: unknown) => act(() => mockModule.__emitLive(name, data))

const CREDS = {
  appId: 'app-1',
  appSecret: 'secret-1',
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
})

describe('initialization', () => {
  it('initializes the engine with credentials and seeds', () => {
    renderProvider({
      instructions: 'Be terse.',
      voice: 'cedar',
      speakerIsolation: false,
      delegateModel: 'gpt-6',
    })
    expect(toolkit.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        ...CREDS,
        instructions: 'Be terse.',
        voice: 'cedar',
        model: 'gpt-live-1',
        delegateModel: 'gpt-6',
        speakerIsolation: false,
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
      speakerIsolation: { supported: true, available: true, enabled: true },
    })
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
})

describe('setters delegate and stay reactive', () => {
  it('instructions, voice, isolation and mute', () => {
    const { result } = renderProvider()
    act(() => result.current.setInstructions('New prompt'))
    act(() => result.current.setVoice('cedar'))
    act(() => result.current.speakerIsolation.setEnabled(false))
    act(() => result.current.setMuted(true))
    expect(toolkit.setInstructions).toHaveBeenCalledWith('New prompt')
    expect(toolkit.setVoice).toHaveBeenCalledWith('cedar')
    expect(toolkit.setSpeakerIsolation).toHaveBeenCalledWith(false)
    expect(toolkit.setMuted).toHaveBeenCalledWith(true)
    expect(result.current).toMatchObject({
      instructions: 'New prompt',
      voice: 'cedar',
      muted: true,
      speakerIsolation: { enabled: false },
    })
  })

  it('context actions pass through their delivery result', () => {
    const { result } = renderProvider()
    expect(result.current.appendInstructions('a')).toBe(true)
    expect(result.current.addContext('b')).toBe(true)
    toolkit.say.mockReturnValue(false)
    expect(result.current.say('c')).toBe(false)
    expect(toolkit.appendInstructions).toHaveBeenCalledWith('a')
    expect(toolkit.addContext).toHaveBeenCalledWith('b')
  })
})
