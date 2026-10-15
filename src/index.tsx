import { Platform } from 'react-native'
import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'
import { androidModule } from './androidModule'

/**
 * OpenAILiveToolkit — full-duplex OpenAI GPT-Live voice agents on iOS and Android, with
 * optional ai-coustics speaker isolation, powered by the Switchboard SDK.
 *
 * Wrap your app in {@link OpenAILiveToolkitProvider} and drive it with the hooks below;
 * the engine and JSON-RPC transport are internal.
 */

export {
  OpenAILiveToolkitProvider,
  useOpenAILiveToolkit,
  useTool,
} from './OpenAILiveToolkitProvider'
export type {
  OpenAILiveToolkitProviderProps,
  OpenAILiveToolkitContextValue,
  OpenAILiveToolkitConnectionStatus,
  SpeakerIsolation,
} from './OpenAILiveToolkitProvider'
export type { OpenAILiveToolkitTool, OpenAILiveTransport } from './OpenAILiveToolkit'
export { OpenAILiveError } from './OpenAILiveToolkit'
export type { OpenAILiveErrorCode } from './OpenAILiveToolkit'
export type { TranscriptEntry, Speaker } from './transcript'
export { VOICES } from './voice'
export type { OpenAIVoice } from './voice'

/** Absolute path to the app's documents directory (for recordings/logs). */
export function getDocumentsPath(): string {
  if (Platform.OS === 'android') {
    return androidModule()?.getConstants().documentsPath ?? ''
  }
  return NativeOpenAILiveToolkit.getDocumentsPath()
}

/** Write `contents` to `path`, overwriting. Returns whether it succeeded. */
export function writeFile(path: string, contents: string): boolean {
  return NativeOpenAILiveToolkit.writeFile(path, contents)
}
