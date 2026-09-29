# API reference

Everything is exported from `@synervoz/openai-live-toolkit`.

## `<OpenAILiveToolkitProvider>`

Initializes the Switchboard SDK once for the app and exposes the toolkit through context. Settings seed initial state; change them at runtime through the hook.

| Prop | Default | Notes |
| --- | --- | --- |
| `openAIApiKey` | — | Required to start. |
| `aiCousticsLicenseKey` | — | Enables speaker isolation in a build that links AICoustics. |
| `appId`, `appSecret` | shared defaults | Switchboard credentials. A blank string throws. |
| `instructions` | `''` | System prompt. |
| `voice` | `'marin'` | See `VOICES`. |
| `model` | `'gpt-live-1'` | Fixed once the engine is built. |
| `delegateModel` | `'gpt-5.5'` | Responses model that runs delegated work and tools. |
| `delegateInstructions` | `''` | Added after the toolkit's own delegate instructions (always call the matching tool). |
| `speakerIsolation` | `true` | Start with Quail on, when it's available. |
| `onError` | — | Receives every failure, including non-fatal ones. |

## `useOpenAILiveToolkit()`

| Field | Notes |
| --- | --- |
| `isRunning` | Engine started. |
| `connectionStatus` | `'none' \| 'connecting' \| 'connected' \| 'error'`. `'error'` stays until a session comes up. |
| `error` | Outstanding fatal `OpenAILiveError`, or null. |
| `start()`, `stop()`, `release()` | Start opens a session; stop closes it and keeps the engine; release frees it. |
| `hasMicrophonePermission`, `requestMicrophonePermission()` | `start()` requests it automatically. |
| `transcript`, `clearTranscript()` | `TranscriptEntry[]`: `{ id, speaker: 'user' \| 'assistant', text, startMs, endMs }`, in the order things were said. A new line starts whenever the speaker changes. |
| `instructions`, `setInstructions(text)` | Fixed per session: while running this starts a new session and drops the conversation. |
| `appendInstructions(text)` | Adds trusted instructions to the live session. Returns false with no session. |
| `addContext(text)` | Quiet context the model uses but doesn't say. |
| `say(text)` | Content for the model to say aloud (it may paraphrase). |
| `voice`, `setVoice(voice)` | Fixed per session, like `setInstructions`. |
| `model` | Read-only. |
| `speakerIsolation` | `{ supported, available, enabled, setEnabled }`. `supported`: the build links AICoustics. `available`: supported and a license key was given. Applied live. See [Speaker isolation](getting-started.md#speaker-isolation). |
| `muted`, `setMuted(muted)` | Stops the model hearing the mic. Kept across sessions. |
| `registerTool(tool)`, `unregisterTool(name)` | See [Tools](tools.md). |

`appendInstructions`, `addContext` and `say` take up to 500 tokens each.

## `useTool(tool)`

Registers an `OpenAILiveToolkitTool` (`{ name, description, parameters?, handler }`) for the component's lifetime. See [Tools](tools.md).

## Errors

Every failure is an `OpenAILiveError` with a `code`, a `message` and `fatal`. Fatal ones land in `error`; all of them go to `onError`.

| Code | Fatal | Meaning |
| --- | --- | --- |
| `INIT_FAILED` | yes | The SDK refused to initialize. |
| `NOT_INITIALIZED` | yes | `start()` before the SDK came up. |
| `MISSING_API_KEY` | yes | No OpenAI key. |
| `MIC_PERMISSION_DENIED` | yes | The user denied the microphone. |
| `ENGINE_CREATION_FAILED` | yes | The graph couldn't be built. |
| `ENGINE_START_FAILED` | yes | The engine refused to start. |
| `ENGINE_STOP_FAILED` | yes | The engine refused to stop; it's still running. |
| `SESSION_FAILED` | if no session is up | OpenAI reported an error. During a live session it's non-fatal. |
| `TOOL_HANDLER_FAILED` | no | A handler threw; the model was told. |
| `TOOL_RESULT_UNDELIVERED` | no | A tool result couldn't reach OpenAI. |

## Other exports

- `VOICES`: every `OpenAIVoice`.
- `getDocumentsPath()`, `writeFile(path, contents)`: file helpers for logs and recordings.
