import { Platform, Share } from 'react-native'
import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'
import { androidModule } from './androidModule'

/** Absolute path to the app's documents directory. */
export function documentsPath(): string {
  if (Platform.OS === 'android') {
    return androidModule()?.getConstants?.().documentsPath ?? ''
  }
  return NativeOpenAILiveToolkit.getDocumentsPath()
}

/** The caches directory, which neither platform backs up. */
export function cachePath(): string {
  if (Platform.OS === 'android') {
    return androidModule()?.getConstants?.().cachePath ?? ''
  }
  return NativeOpenAILiveToolkit.getCachePath()
}

/** Write the SDK's log, and the toolkit's lines in it, to a file in the caches directory too. */
export function startLogFile(): void {
  NativeOpenAILiveToolkit.startLogFile(cachePath())
}

// Hears each line logged from JS, for the recordings' labels.
let logListener: ((message: string) => void) | null = null

/** Have `listener` called with each line logged from JS; null stops it. */
export function setLogListener(listener: ((message: string) => void) | null): void {
  logListener = listener
}

/** Add a line to the log. */
export function log(message: string): void {
  NativeOpenAILiveToolkit.log(message)
  logListener?.(message)
}

/**
 * Open the share sheet with the log file. It holds the SDK's log and the toolkit's events,
 * transcript included, from the last few MB of use. iOS: with `recordings`, a zip of the log and them.
 */
export async function shareLogs(recordings: string[] = []): Promise<void> {
  const path = NativeOpenAILiveToolkit.exportLogFile()
  if (path === '') {
    throw new Error('No log: initialize the toolkit with logFile on.')
  }
  const android = Platform.OS === 'android' ? androidModule() : undefined
  if (android) {
    await android.shareFile(path)
    return
  }
  if (recordings.length === 0) {
    await Share.share({ url: `file://${path}` })
    return
  }
  const zip = `${cachePath()}/openai-live-toolkit-logs.zip`
  const failure = NativeOpenAILiveToolkit.zipFiles([path, ...recordings].join('\n'), zip)
  if (failure) {
    throw new Error(`Couldn't zip the logs: ${failure}`)
  }
  await Share.share({ url: `file://${zip}` })
}
