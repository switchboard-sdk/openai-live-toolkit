import { NativeModules } from 'react-native'

/** The toolkit's JVM module on Android (`OpenAILiveToolkitAndroidModule.kt`). */
export interface OpenAILiveToolkitAndroidModule {
  /** Start the microphone foreground service and the communication audio route. */
  startAudioSession(): Promise<void>
  /** Restore the normal audio route and stop the foreground service. */
  stopAudioSession(): Promise<void>
  getConstants(): { documentsPath: string }
}

/** The JVM module, or undefined off Android. */
export function androidModule(): OpenAILiveToolkitAndroidModule | undefined {
  return NativeModules.OpenAILiveToolkitAndroid
}
