# API reference

Everything is exported from `@synervoz/openai-live-toolkit`.

## `<OpenAILiveToolkitProvider>`

Initializes the Switchboard SDK once for the app and exposes the toolkit through context. Settings seed initial state; change them at runtime through the hook.

| Prop | Default | Notes |
| --- | --- | --- |
| `transport` | `'webrtc'` | `'webrtc'`: the Switchboard backend creates the session with the app's OpenAI key. `'websocket'`: straight to OpenAI with `openAIApiKey`. Fixed once the engine is built. See [Credentials](getting-started.md#credentials). |
| `openAIApiKey` | — | Required to start with `'websocket'`. Ignored with `'webrtc'`. |
| `aiCousticsLicenseKey` | — | Enables speaker isolation in a build that links AICoustics. |
| `appId`, `appSecret` | shared defaults | Switchboard credentials. A blank string throws. |
| `apiUrl` | production | Switchboard backend, e.g. `https://staging.api.switchboard.audio`. The SDK only accepts `https://<host>.switchboard.audio`. |
| `instructions` | `''` | System prompt. |
| `voice` | `'marin'` | See `VOICES`. |
| `model` | `'gpt-live-1'` | Fixed once the engine is built. |
| `delegateModel` | `'gpt-5.5'` | Responses model that runs delegated work and tools. |
| `delegateInstructions` | `''` | Added after the toolkit's own delegate instructions (always call the matching tool). |
| `speakerIsolation` | `true` | Start with Quail on, when it's available. |
| `idleTimeoutMs` | off | Close the session after this long with nobody talking and reopen it on speech. See [Idle mode](getting-started.md#idle-mode). |
| `wakeGraceMs` | `5000` | After a wake, close again after this long unless the model replies. Capped at `idleTimeoutMs`; `0` turns it off. |
| `continueConversation` | `false` | Continue the conversation when a session reopens: after a stop, or from a saved `sessionId` after the app was killed. While on, OpenAI stores each session. See [Continuing a conversation](getting-started.md#continuing-a-conversation). |
| `webSearch` | `false` | Give the delegate OpenAI's hosted web search, so the model can answer about weather, news and other current information. Each search is billed. |
| `logFile` | `false` | Write the SDK's log and the toolkit's events (sessions, idle and wake, delegations, tool calls, errors) to a file in the caches directory, for `shareLogs()`. |
| `logConversation` | `false` | Include the transcript and tool arguments and results in that log. |
| `mixWithOthers` | `false` | iOS: play alongside other apps' audio, like music, instead of stopping it. Voice processing removes it from what the model hears. |
| `otherAudioDucking` | `'min'` | iOS 17+, with `mixWithOthers`: how far other apps' audio is lowered, and only while someone talks (`'min'`, `'mid'`, `'max'`). `'default'` keeps the system's ducking, which lowers it the whole time. |
| `microphone` | `'phone'` | iOS, with a Bluetooth device connected: `'phone'` plays over Bluetooth in high quality (A2DP) and the model hears the phone's microphone; `'bluetooth'` uses the device's microphone, with call-quality audio (HFP). See [iOS setup](getting-started.md#ios-setup). |
| `onError` | — | Receives every failure, including non-fatal ones. |

## `useOpenAILiveToolkit()`

| Field | Notes |
| --- | --- |
| `isRunning` | Engine started. |
| `connectionStatus` | `'none' \| 'connecting' \| 'connected' \| 'idle' \| 'error'`. `'idle'`: idle mode closed the session and it reopens on speech. `'error'` stays until a session comes up. |
| `error` | Outstanding fatal `OpenAILiveError`, or null. |
| `start(options?)`, `stop()`, `release()` | Start opens a session; with `continueConversation` it continues the conversation a stop closed, or `options.continueSessionId`. Stop closes it and keeps the engine; release frees it. |
| `sessionId` | The latest session's id, for the app to save and pass to `start` as `continueSessionId`. Null before the first session and after `newConversation()`. |
| `newConversation()` | Forgets the conversation and clears the transcript. A session that's up is replaced by a new one. |
| `hasMicrophonePermission`, `requestMicrophonePermission()` | `start()` requests it automatically. |
| `transcript`, `clearTranscript()` | `TranscriptEntry[]`: `{ id, speaker: 'user' \| 'assistant', text, startMs, endMs }`, in the order things were said. A new line starts whenever the speaker changes. |
| `instructions`, `setInstructions(text)` | Fixed per session: while running this starts a new session and drops the conversation. |
| `appendInstructions(text)` | Adds trusted instructions to the live session. Returns false with no session. |
| `addContext(text)` | Quiet context the model uses but doesn't say. |
| `say(text)` | Content for the model to say aloud (it may paraphrase). |
| `voice`, `setVoice(voice)` | Fixed per session, like `setInstructions`. |
| `model` | Read-only. |
| `speakerIsolation` | `{ supported, available, enabled, setEnabled }`. `supported`: the build links AICoustics. `available`: supported and a license key was given. Applied live. See [Speaker isolation](getting-started.md#speaker-isolation). |
| `bluetooth` | iOS: `{ connected, microphone, setMicrophone }`. `connected`: a Bluetooth headset, car or speaker is in use or has a microphone; offer the microphone choice while it's true. `setMicrophone('bluetooth' \| 'phone')` applies live; audio restarts briefly. `connected` is always false on Android. |
| `muted`, `setMuted(muted)` | Stops the model hearing the mic. Kept across sessions. |
| `registerTool(tool)`, `unregisterTool(name)` | See [Tools](tools.md). |
| `shareLogs()` | Opens the share sheet with the log file, about the last 2 MB. Rejects unless the provider has `logFile` on. |
| `media` | Media playback; see `useMedia()`. |

`appendInstructions`, `addContext` and `say` take up to 500 tokens each.

## `useMedia()`

Media playing alongside the conversation, mixed with the model's voice and ducked while it talks. See [Media](getting-started.md#media).

| Field | Notes |
| --- | --- |
| `play(url)` | Plays an MP3 or AAC stream or file from an http(s) URL, replacing what was playing. Needs a running engine; otherwise `error` is set. |
| `pause()`, `resume()` | A paused live stream resumes close to live; a finished file starts over. |
| `stop()` | Stops and closes the stream. `stop()` on the engine does this too. |
| `url` | The URL loaded, or null. |
| `station` | The station's name: from `useMediaTools` stations, else what the stream says. |
| `state` | `'idle' \| 'connecting' \| 'buffering' \| 'ready' \| 'finished' \| 'error'`. `'ready'` is playing audio, or ready to. |
| `playing` | Playing, or waiting for audio to play, rather than paused or stopped. |
| `live` | A live stream rather than a file. Known once `state` is `'ready'`. |
| `metadata` | `{ title, stationName, genre, url }` from the stream, or null until it says. |
| `error` | The `MEDIA_FAILED` error from the last `play`, or null. |
| `volume`, `setVolume(volume)` | 0 to 1, before ducking. Defaults to 1. |

The model's media tools change this too.

## `useMediaTools(options?)`

Lets the model control media and know what's playing while the component is mounted. See [Letting the model control media](getting-started.md#letting-the-model-control-media).

| Option | Notes |
| --- | --- |
| `stations` | `MediaStation[]`: `{ name, url, description? }`. The model plays them by name. Can change at runtime. |
| `allowUrls` | `false`. Lets the model play any public http(s) URL too, not only `stations`. URLs on the device or a local network are always refused. |

Registers `play_media`, `pause_media`, `resume_media`, `set_media_volume` and `get_now_playing`, and tells the session what's playing as quiet context.

## `useTool(tool)`

Registers an `OpenAILiveToolkitTool` (`{ name, description, parameters?, handler }`) for the component's lifetime. See [Tools](tools.md).

## Errors

Every failure is an `OpenAILiveError` with a `code`, a `message` and `fatal`. Fatal ones land in `error`; all of them go to `onError`.

| Code | Fatal | Meaning |
| --- | --- | --- |
| `INIT_FAILED` | yes | The SDK refused to initialize. |
| `NOT_INITIALIZED` | yes | `start()` before the SDK came up. |
| `MISSING_API_KEY` | yes | No OpenAI key with the `websocket` transport. |
| `MIC_PERMISSION_DENIED` | yes | The user denied the microphone. |
| `ENGINE_CREATION_FAILED` | yes | The graph couldn't be built. |
| `ENGINE_START_FAILED` | yes | The engine refused to start. |
| `ENGINE_STOP_FAILED` | yes | The engine refused to stop; it's still running. |
| `SESSION_FAILED` | if no session is up | OpenAI reported an error. During a live session it's non-fatal. |
| `TOOL_HANDLER_FAILED` | no | A handler threw; the model was told. |
| `TOOL_RESULT_UNDELIVERED` | no | A tool result couldn't reach OpenAI. |
| `MEDIA_FAILED` | no | Media couldn't play: the engine isn't running, the URL isn't http(s), or the stream failed. Also in `media.error`. |

## Other exports

- `VOICES`: every `OpenAIVoice`.
- `getDocumentsPath()`, `writeFile(path, contents)`: file helpers for logs and recordings.
