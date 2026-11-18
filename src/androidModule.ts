import { NativeModules } from 'react-native'

/** Device event from {@link OpenAILiveToolkitAndroidModule.watchNetwork}, with whether the network is up. */
export const NETWORK_CHANGED_EVENT = 'OpenAILiveToolkitNetworkChanged'

/** Device event with how the engine's audio focus changed, such as 'lost'. */
export const AUDIO_FOCUS_CHANGED_EVENT = 'OpenAILiveToolkitAudioFocusChanged'

/** The toolkit's JVM module on Android (`OpenAILiveToolkitAndroidModule.kt`). */
export interface OpenAILiveToolkitAndroidModule {
  /**
   * Start the microphone foreground service, audio focus and the communication audio route. Other
   * apps pause, or with `mixWithOthers` keep playing, lowered by the system.
   */
  startAudioSession(mixWithOthers: boolean): Promise<void>
  /** Restore the normal audio route, give up audio focus and stop the foreground service. */
  stopAudioSession(): Promise<void>
  /** Resolves true after `ms`, false once cancelled. Runs in the background. */
  setTimer(id: number, ms: number): Promise<boolean>
  cancelTimer(id: number): void
  isNetworkAvailable(): boolean
  /** Emit {@link NETWORK_CHANGED_EVENT} whenever {@link isNetworkAvailable} changes. */
  watchNetwork(): void
  /** Resolves to a WAV file of `text` said in `language` with the device's voice, or ''. */
  synthesizeSpeech(text: string, language: string): Promise<string>
  /** Newline-separated files packed into one zip; resolves to '' when done, or why not. */
  zipFiles(paths: string, zipPath: string): Promise<string>
  /** Open the share sheet with a file from the app's cache directory. */
  shareFile(path: string): Promise<void>
  getConstants(): {
    documentsPath: string
    cachePath: string
    /** The app, its version and build, the Android version and the device model. */
    device: string
  }
}

/** The JVM module, or undefined off Android. */
export function androidModule(): OpenAILiveToolkitAndroidModule | undefined {
  return NativeModules.OpenAILiveToolkitAndroid
}
