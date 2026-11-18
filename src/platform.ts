import { DeviceEventEmitter, Platform } from 'react-native'
import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'
import { androidModule, AUDIO_FOCUS_CHANGED_EVENT, NETWORK_CHANGED_EVENT } from './androidModule'

// What the C++ module does with its iOS hooks, the JVM module does on Android.
function android() {
  return Platform.OS === 'android' ? androidModule() : undefined
}

let nextTimerId = 1

/**
 * Calls `callback` after `ms`, also while an Android app is in the background, where React Native
 * stops JS timers. Returns a function that cancels it.
 */
export function backgroundTimeout(callback: () => void, ms: number): () => void {
  const module = android()
  if (!module) {
    const timer = setTimeout(callback, ms)
    return () => clearTimeout(timer)
  }
  const id = nextTimerId++
  module.setTimer(id, ms).then((fired) => {
    if (fired) {
      callback()
    }
  })
  return () => module.cancelTimer(id)
}

export function isNetworkAvailable(): boolean {
  const module = android()
  return module ? module.isNetworkAvailable() : NativeOpenAILiveToolkit.isNetworkAvailable()
}

/** Calls `listener` whenever {@link isNetworkAvailable} changes. */
export function onNetworkChanged(listener: (available: boolean) => void): { remove(): void } {
  const module = android()
  if (!module) {
    return NativeOpenAILiveToolkit.onNetworkChanged(listener)
  }
  const subscription = DeviceEventEmitter.addListener(NETWORK_CHANGED_EVENT, listener)
  module.watchNetwork()
  return subscription
}

/** Android: calls `listener` with how the engine's audio focus changed, such as 'lost'. Null elsewhere. */
export function onAudioFocusChanged(listener: (change: string) => void): { remove(): void } | null {
  return android() ? DeviceEventEmitter.addListener(AUDIO_FOCUS_CHANGED_EVENT, listener) : null
}

/** Resolves to a WAV file of `text` said in `language` with the device's voice, or ''. */
export function synthesizeSpeech(text: string, language: string): Promise<string> {
  const module = android()
  return module
    ? module.synthesizeSpeech(text, language)
    : NativeOpenAILiveToolkit.synthesizeSpeech(text, language)
}

/** Newline-separated files packed into one zip; resolves to '' when done, or why not. */
export async function zipFiles(paths: string, zipPath: string): Promise<string> {
  const module = android()
  return module ? module.zipFiles(paths, zipPath) : NativeOpenAILiveToolkit.zipFiles(paths, zipPath)
}
