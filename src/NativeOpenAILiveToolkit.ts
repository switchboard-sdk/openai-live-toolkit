import type { TurboModule } from 'react-native'
import { TurboModuleRegistry, CodegenTypes } from 'react-native'

/**
 * TurboModule spec consumed by React Native Codegen (new architecture).
 *
 * The native surface is intentionally tiny: everything flows through a single
 * JSON-RPC 2.0 string channel (`processCommand`), plus an event stream. The
 * higher-level API (SwitchboardClient) is built on top of this in TypeScript,
 * so adding new Switchboard actions never requires touching native code.
 */
export interface Spec extends TurboModule {
  /** Execute a JSON-RPC 2.0 command and return the JSON-RPC response string. */
  readonly processCommand: (command: string) => string

  /** Absolute path to the app's documents directory (for recordings/logs). */
  readonly getDocumentsPath: () => string

  /** Write `contents` to `path`, overwriting. Returns whether it succeeded. */
  readonly writeFile: (path: string, contents: string) => boolean

  /** Request microphone permission; resolves to whether it's granted. */
  readonly requestMicrophonePermission: () => Promise<boolean>

  /** Whether this build links the AICoustics extension (opt-in at `pod install`). */
  readonly isSpeakerIsolationSupported: () => boolean

  /** Absolute path to the app's caches directory, which isn't backed up. */
  readonly getCachePath: () => string

  /** Also write the SDK's log to a file in `directory`. Once per process; later calls do nothing. */
  readonly startLogFile: (directory: string) => void

  /** Write a line to the SDK's log as the toolkit. */
  readonly log: (message: string) => void

  /** The log file joined into one for sharing: its path, or '' before startLogFile. */
  readonly exportLogFile: () => string

  /** Stream of Switchboard events, delivered as JSON strings. */
  readonly onEventReceived: CodegenTypes.EventEmitter<string>

  /**
   * iOS: whether a Bluetooth device is connected: a Bluetooth microphone is available, or audio
   * goes to Bluetooth. Always false on Android.
   */
  readonly isBluetoothConnected: () => boolean

  /** iOS: {@link isBluetoothConnected} whenever the audio route changes. */
  readonly onBluetoothChanged: CodegenTypes.EventEmitter<boolean>

  /**
   * iOS: show what plays as the system's Now Playing (lock screen, Control Center, car displays) and
   * take its buttons. JSON: title, artist, live, duration, position, playing, next, previous,
   * skipForward and skipBackward (seconds, 0 for none) and seek. '' clears it and lets the buttons go.
   */
  readonly setNowPlaying: (info: string) => void
  /**
   * iOS: a Now Playing button: 'play', 'pause', 'toggle', 'next', 'previous', 'skipForward',
   * 'skipBackward', or 'seek:<seconds>'.
   */
  readonly onRemoteCommand: CodegenTypes.EventEmitter<string>
  /**
   * iOS: lower other apps (true) or bring them back (false) through `engine`'s duckOthers, where
   * voice processing doesn't already lower them. A change pauses the app that plays, so they're
   * lowered only while {@link setOtherAudioResumable} says the app plays it again, and raising them
   * waits while another app plays unless it does. Asynchronous: {@link onOtherAppsDuckChanged}
   * reports each change made.
   */
  readonly duckOtherApps: (duck: boolean, engine: string) => void
  /** iOS: whether the app plays again what a {@link duckOtherApps} change pauses. */
  readonly setOtherAudioResumable: (resumable: boolean) => void
  /** iOS: after each change {@link duckOtherApps} made, whether other apps are lowered now. */
  readonly onOtherAppsDuckChanged: CodegenTypes.EventEmitter<boolean>
  /**
   * iOS: `text` spoken by the system's on-device voice for `language` (e.g. 'en-US'), for when the
   * model can't be reached: resolves to the path of a WAV file in the caches directory, or '' if it
   * couldn't be made.
   */
  readonly synthesizeSpeech: (text: string, language: string) => Promise<string>
  /** iOS: whether another app plays audio. Always false on Android. */
  readonly isOtherAudioPlaying: () => boolean
  /** iOS: whether the device has a network path. Always true on Android. */
  readonly isNetworkAvailable: () => boolean
  /** iOS: {@link isNetworkAvailable} whenever it changes. */
  readonly onNetworkChanged: CodegenTypes.EventEmitter<boolean>
  /** iOS: newline-separated files packed into one zip at `zipPath`: '' when done, or why not. */
  readonly zipFiles: (paths: string, zipPath: string) => string
}

function loadNativeModule(): Spec {
  const native = TurboModuleRegistry.get<Spec>('OpenAILiveToolkit')
  if (!native) {
    throw new Error(
      "openai-live-toolkit's native module isn't in this app build. Rebuild the app after " +
        'installing the package, with `pod install` in ios/ first on iOS. It needs the new ' +
        'architecture and runs in iOS and Android builds, not in Expo Go or on the web.'
    )
  }
  return native
}

export default loadNativeModule()
