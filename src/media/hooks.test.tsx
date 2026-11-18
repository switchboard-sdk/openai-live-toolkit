import React, { type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react-native'

// The media hooks: mirroring the toolkit's media status, passing the controls through, and
// registering the media tools for a component's lifetime. Asserted against the mocked toolkit.
jest.mock('../NativeOpenAILiveToolkit')
jest.mock('../OpenAILiveToolkit')

import { OpenAILiveToolkitProvider } from '../OpenAILiveToolkitProvider'
import { OpenAILiveError } from '../OpenAILiveToolkit'
import { useMedia, useMediaPosition, useMediaTools } from './hooks'

const mockModule = jest.requireMock(
  '../OpenAILiveToolkit'
) as typeof import('../__mocks__/OpenAILiveToolkit')
const media = mockModule.openAILiveToolkit.media as Record<string, any>
const emitStatus = (status: Record<string, unknown>) =>
  act(() => mockModule.__emitMediaStatus(status))

const URL = 'https://radio.example/stream'
const PLAYING = {
  url: URL,
  station: 'Test Radio',
  state: 'ready',
  playing: true,
  live: true,
  duration: 0,
  metadata: { title: 'Artist - Song', stationName: 'Test Radio', genre: '', url: '' },
  error: null,
  volume: 0.5,
}

function wrapperWith(props: { onError?: (error: OpenAILiveError) => void } = {}) {
  return ({ children }: { children: ReactNode }) => (
    <OpenAILiveToolkitProvider media {...props}>
      {children}
    </OpenAILiveToolkitProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  media.status = { ...mockModule.NO_MEDIA }
})

describe('useMedia', () => {
  it("mirrors the toolkit's media status", () => {
    const { result } = renderHook(() => useMedia(), { wrapper: wrapperWith() })
    expect(result.current).toMatchObject({ url: null, state: 'idle', volume: 1 })
    emitStatus(PLAYING)
    expect(result.current).toMatchObject(PLAYING)
  })

  it('passes the controls through', () => {
    const { result } = renderHook(() => useMedia(), { wrapper: wrapperWith() })
    act(() => result.current.play(URL))
    act(() => result.current.pause())
    act(() => result.current.resume())
    act(() => result.current.setVolume(0.3))
    act(() => result.current.seek(42))
    act(() => result.current.stop())
    result.current.waitForStart(1000)
    expect(media.play).toHaveBeenCalledWith(URL)
    expect(media.pause).toHaveBeenCalled()
    expect(media.resume).toHaveBeenCalled()
    expect(media.setVolume).toHaveBeenCalledWith(0.3)
    expect(media.seek).toHaveBeenCalledWith(42)
    expect(media.stop).toHaveBeenCalled()
    expect(media.waitForStart).toHaveBeenCalledWith(1000)
  })

  it('keeps the same controls across renders', () => {
    const { result } = renderHook(() => useMedia(), { wrapper: wrapperWith() })
    const play = result.current.play
    emitStatus(PLAYING)
    expect(result.current.play).toBe(play)
  })

  it('a refused play goes to onError, not error', () => {
    const refusal = new OpenAILiveError(
      'MEDIA_FAILED',
      'Media plays only while the engine runs.',
      false
    )
    media.play.mockImplementationOnce(() => {
      throw refusal
    })
    const onError = jest.fn()
    const { result } = renderHook(() => useMedia(), { wrapper: wrapperWith({ onError }) })
    act(() => result.current.play(URL))
    expect(onError).toHaveBeenCalledWith(refusal)
  })

  it('throws outside the provider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useMedia())).toThrow(/OpenAILiveToolkitProvider/)
    consoleError.mockRestore()
  })
})

describe('useMediaPosition', () => {
  const FILE = { ...PLAYING, station: null, live: false, duration: 120, metadata: null }

  afterEach(() => {
    jest.useRealTimers()
  })

  it("reads a file's position every second", () => {
    jest.useFakeTimers()
    media.position.mockReturnValueOnce(5).mockReturnValueOnce(6)
    const { result } = renderHook(() => useMediaPosition(), { wrapper: wrapperWith() })
    expect(result.current).toBe(0)
    emitStatus(FILE)
    expect(result.current).toBe(5)
    act(() => jest.advanceTimersByTime(1000))
    expect(result.current).toBe(6)
  })

  it('is 0 for a live stream', () => {
    jest.useFakeTimers()
    const { result } = renderHook(() => useMediaPosition(), { wrapper: wrapperWith() })
    emitStatus({ ...FILE, live: true })
    act(() => jest.advanceTimersByTime(3000))
    expect(result.current).toBe(0)
    expect(media.position).not.toHaveBeenCalled()
  })
})

describe('useMediaTools', () => {
  const STATIONS = [{ name: 'Big R Radio', url: 'http://big.example/r' }]

  function renderMediaTools(stations?: typeof STATIONS) {
    return renderHook(
      ({ list }: { list?: typeof STATIONS }) =>
        useMediaTools(list ? { stations: list } : undefined),
      { wrapper: wrapperWith(), initialProps: { list: stations } }
    )
  }

  it('turns the media tools on with the stations, and off on unmount', () => {
    const { unmount } = renderMediaTools(STATIONS)
    expect(media.setTools).toHaveBeenLastCalledWith({ stations: STATIONS, allowUrls: false })
    unmount()
    expect(media.setTools).toHaveBeenLastCalledWith(null)
  })

  it('updates when the stations change, not on every render', () => {
    const { rerender } = renderMediaTools(STATIONS)
    rerender({ list: [...STATIONS] })
    expect(media.setTools).toHaveBeenCalledTimes(1)
    const more = [...STATIONS, { name: 'Newstalk 1010', url: 'https://news.example/1010.aac' }]
    rerender({ list: more })
    expect(media.setTools).toHaveBeenLastCalledWith({ stations: more, allowUrls: false })
  })

  it('works without stations', () => {
    renderMediaTools()
    expect(media.setTools).toHaveBeenLastCalledWith({ stations: [], allowUrls: false })
  })

  it('passes allowUrls on', () => {
    renderHook(() => useMediaTools({ allowUrls: true }), { wrapper: wrapperWith() })
    expect(media.setTools).toHaveBeenLastCalledWith({ stations: [], allowUrls: true })
  })

  it('passes the external player on, reading whether it plays from the latest render', () => {
    const { rerender } = renderHook(
      ({ playing }: { playing: boolean }) =>
        useMediaTools({ externalPlayer: { name: 'Apple Music', isPlaying: () => playing } }),
      { wrapper: wrapperWith(), initialProps: { playing: false } }
    )
    rerender({ playing: true })
    expect(media.setTools).toHaveBeenCalledTimes(1)
    const options = media.setTools.mock.calls[0][0]
    expect(options).toMatchObject({ stations: [], allowUrls: false })
    expect(options.externalPlayer.name).toBe('Apple Music')
    expect(options.externalPlayer.isPlaying()).toBe(true)
  })

  it('throws outside the provider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useMediaTools())).toThrow(/OpenAILiveToolkitProvider/)
    consoleError.mockRestore()
  })
})
