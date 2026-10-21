// Manual Jest mock for the native TurboModule seam.
//
// `TurboModuleRegistry.getEnforcing('OpenAILiveToolkit')` throws under Jest (no native
// module registered), so every suite that pulls in code touching
// `./NativeOpenAILiveToolkit` must mock it. Jest auto-uses this file when a suite calls
// `jest.mock('./NativeOpenAILiveToolkit')`.
//
// The event emitter is modeled faithfully: `onEventReceived(cb)` records the
// subscriber and returns a subscription with a real `remove()`, so tests can
// assert the "replace the old subscription so we never double-deliver" contract
// in NativeModuleRPCClient. Use `emit()` to push an event through the *current*
// subscriber (mirrors the native event stream).

type EventCallback = (eventJSON: string) => void

// The subscriber currently registered via onEventReceived (null once removed).
let currentCallback: EventCallback | null = null

const processCommand = jest.fn<string, [string]>(() => '{"jsonrpc":"2.0","id":1,"result":null}')
const getDocumentsPath = jest.fn<string, []>(() => '/mock/documents')
const writeFile = jest.fn<boolean, [string, string]>(() => true)
const requestMicrophonePermission = jest.fn<Promise<boolean>, []>(() => Promise.resolve(true))
const isSpeakerIsolationSupported = jest.fn<boolean, []>(() => true)
const getCachePath = jest.fn<string, []>(() => '/mock/caches')
const startLogFile = jest.fn<void, [string]>()
const log = jest.fn<void, [string]>()
const exportLogFile = jest.fn<string, []>(() => '/mock/caches/openai-live-toolkit-log.txt')

const onEventReceived = jest.fn((cb: EventCallback) => {
  currentCallback = cb
  return {
    remove: jest.fn(() => {
      // Only clear if this subscription is still the active one.
      if (currentCallback === cb) {
        currentCallback = null
      }
    }),
  }
})

/** Push an event JSON string through the currently-subscribed listener. */
export function emit(eventJSON: string): void {
  currentCallback?.(eventJSON)
}

/** Whether a listener is currently subscribed (for the double-delivery test). */
export function hasSubscriber(): boolean {
  return currentCallback !== null
}

/** Reset all mock fns and the captured subscriber between tests. */
export function resetNativeMock(): void {
  processCommand.mockReset()
  processCommand.mockReturnValue('{"jsonrpc":"2.0","id":1,"result":null}')
  getDocumentsPath.mockReset()
  getDocumentsPath.mockReturnValue('/mock/documents')
  writeFile.mockReset()
  writeFile.mockReturnValue(true)
  requestMicrophonePermission.mockReset()
  requestMicrophonePermission.mockResolvedValue(true)
  isSpeakerIsolationSupported.mockReset()
  isSpeakerIsolationSupported.mockReturnValue(true)
  getCachePath.mockReset()
  getCachePath.mockReturnValue('/mock/caches')
  startLogFile.mockReset()
  log.mockReset()
  exportLogFile.mockReset()
  exportLogFile.mockReturnValue('/mock/caches/openai-live-toolkit-log.txt')
  onEventReceived.mockClear()
  currentCallback = null
}

const NativeOpenAILiveToolkitMock = {
  processCommand,
  getDocumentsPath,
  writeFile,
  requestMicrophonePermission,
  isSpeakerIsolationSupported,
  getCachePath,
  startLogFile,
  log,
  exportLogFile,
  onEventReceived,
}

export default NativeOpenAILiveToolkitMock
