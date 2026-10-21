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

/** Write the SDK's log, and the toolkit's lines in it, to a file in the documents directory too. */
export function startLogFile(): void {
  NativeOpenAILiveToolkit.startLogFile(documentsPath())
}

/** Add a line to the log. */
export function log(message: string): void {
  NativeOpenAILiveToolkit.log(message)
}

/**
 * Open the share sheet with the log file. It holds the SDK's log and the toolkit's events,
 * transcript included, from the last few MB of use.
 */
export async function shareLogs(): Promise<void> {
  const path = NativeOpenAILiveToolkit.exportLogFile()
  if (path === '') {
    throw new Error('No log yet: it starts when the toolkit initializes.')
  }
  const android = Platform.OS === 'android' ? androidModule() : undefined
  if (android) {
    await android.shareFile(path)
    return
  }
  await Share.share({ url: `file://${path}` })
}
