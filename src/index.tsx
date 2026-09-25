import NativeOpenAILiveToolkit from './NativeOpenAILiveToolkit'

/**
 * OpenAILiveToolkit — full-duplex OpenAI GPT-Live voice agents on iOS, with
 * ai-coustics speaker isolation, powered by the Switchboard SDK.
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
export type { OpenAILiveToolkitTool } from './OpenAILiveToolkit'
export { OpenAILiveError } from './OpenAILiveToolkit'
export type { OpenAILiveErrorCode } from './OpenAILiveToolkit'
export type { TranscriptEntry, Speaker } from './transcript'
export { VOICES } from './voice'
export type { OpenAIVoice } from './voice'

/** Absolute path to the app's documents directory (for recordings/logs). */
export function getDocumentsPath(): string {
  return NativeOpenAILiveToolkit.getDocumentsPath()
}

/** Write `contents` to `path`, overwriting. Returns whether it succeeded. */
export function writeFile(path: string, contents: string): boolean {
  return NativeOpenAILiveToolkit.writeFile(path, contents)
}
