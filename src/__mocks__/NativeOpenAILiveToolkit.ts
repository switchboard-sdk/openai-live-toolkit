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
const isBluetoothConnected = jest.fn<boolean, []>(() => false)

// The subscriber currently registered via onBluetoothChanged (null once removed).
let bluetoothCallback: ((connected: boolean) => void) | null = null
const onBluetoothChanged = jest.fn((cb: (connected: boolean) => void) => {
  bluetoothCallback = cb
  return {
    remove: jest.fn(() => {
      if (bluetoothCallback === cb) {
        bluetoothCallback = null
      }
    }),
  }
})

const setNowPlaying = jest.fn<void, [string]>()
const duckOtherApps = jest.fn<void, [boolean, string]>()
const setOtherAudioResumable = jest.fn<void, [boolean]>()

// The subscriber currently registered via onOtherAppsDuckChanged (null once removed).
let otherAppsDuckCallback: ((ducked: boolean) => void) | null = null
const onOtherAppsDuckChanged = jest.fn((cb: (ducked: boolean) => void) => {
  otherAppsDuckCallback = cb
  return {
    remove: jest.fn(() => {
      if (otherAppsDuckCallback === cb) {
        otherAppsDuckCallback = null
      }
    }),
  }
})

/** Report a change duckOtherApps made through the onOtherAppsDuckChanged listener. */
export function emitOtherAppsDuck(ducked: boolean): void {
  otherAppsDuckCallback?.(ducked)
}

const synthesizeSpeech = jest.fn<Promise<string>, [string, string]>(() =>
  Promise.resolve('/mock/caches/speech.wav')
)
const isOtherAudioPlaying = jest.fn<boolean, []>(() => false)
const isNetworkAvailable = jest.fn<boolean, []>(() => true)
const zipFiles = jest.fn<string, [string, string]>(() => '')

// The subscriber currently registered via onNetworkChanged (null once removed).
let networkCallback: ((available: boolean) => void) | null = null
const onNetworkChanged = jest.fn((cb: (available: boolean) => void) => {
  networkCallback = cb
  return {
    remove: jest.fn(() => {
      if (networkCallback === cb) {
        networkCallback = null
      }
    }),
  }
})

// The subscriber currently registered via onRemoteCommand (null once removed).
let remoteCommandCallback: ((command: string) => void) | null = null
const onRemoteCommand = jest.fn((cb: (command: string) => void) => {
  remoteCommandCallback = cb
  return {
    remove: jest.fn(() => {
      if (remoteCommandCallback === cb) {
        remoteCommandCallback = null
      }
    }),
  }
})

/** Report the network gained or lost through the onNetworkChanged listener. */
export function emitNetwork(available: boolean): void {
  networkCallback?.(available)
}

/** Press a Now Playing button through the onRemoteCommand listener. */
export function emitRemoteCommand(command: string): void {
  remoteCommandCallback?.(command)
}

/** Push an audio route change through the onBluetoothChanged listener. */
export function emitBluetooth(connected: boolean): void {
  bluetoothCallback?.(connected)
}

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
  isBluetoothConnected.mockReset()
  isBluetoothConnected.mockReturnValue(false)
  onBluetoothChanged.mockClear()
  bluetoothCallback = null
  setNowPlaying.mockReset()
  duckOtherApps.mockReset()
  setOtherAudioResumable.mockReset()
  onOtherAppsDuckChanged.mockClear()
  otherAppsDuckCallback = null
  synthesizeSpeech.mockReset()
  synthesizeSpeech.mockResolvedValue('/mock/caches/speech.wav')
  isOtherAudioPlaying.mockReset()
  isOtherAudioPlaying.mockReturnValue(false)
  isNetworkAvailable.mockReset()
  isNetworkAvailable.mockReturnValue(true)
  onNetworkChanged.mockClear()
  networkCallback = null
  zipFiles.mockReset()
  zipFiles.mockReturnValue('')
  onRemoteCommand.mockClear()
  remoteCommandCallback = null
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
  isBluetoothConnected,
  onBluetoothChanged,
  setNowPlaying,
  onRemoteCommand,
  duckOtherApps,
  setOtherAudioResumable,
  onOtherAppsDuckChanged,
  synthesizeSpeech,
  isOtherAudioPlaying,
  isNetworkAvailable,
  onNetworkChanged,
  zipFiles,
}

export default NativeOpenAILiveToolkitMock
