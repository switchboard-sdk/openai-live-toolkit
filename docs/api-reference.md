# API reference

Everything is exported from `@synervoz/openai-live-toolkit`.

## `<OpenAILiveToolkitProvider>`

Initializes the Switchboard SDK once for the app and exposes the toolkit through context. Settings seed initial state; change them at runtime through the hook.

| Prop | Default | Notes |
| --- | --- | --- |
| `transport` | `'webrtc'` | `'webrtc'`: the Switchboard backend creates the session with the app's OpenAI key. `'websocket'`: straight to OpenAI with `openAIApiKey`. Fixed once the engine is built. See [Credentials](getting-started.md#credentials). |
| `openAIApiKey` | — | Required to start with `'websocket'`. Ignored with `'webrtc'`. |
| `appId`, `appSecret` | demo credentials | Switchboard credentials. The demo credentials are rotated regularly; [register your own](https://console.switchboard.audio/register) for an app you ship. A blank string throws. |
| `apiUrl` | production | Switchboard backend URL. The SDK only accepts `https://<host>.switchboard.audio`. |
| `instructions` | `''` | System prompt. |
| `voice` | `'marin'` | See `VOICES`. |
| `model` | `'gpt-live-1.1'` | Fixed once the engine is built. |
| `delegateModel` | `'gpt-5.5'` | Responses model that runs delegated work and tools. |
| `delegateInstructions` | `''` | Added after the toolkit's own delegate instructions (always call the matching tool). |
| `idleTimeoutMs` | off | Close the session after this long with nobody talking and reopen it on speech. See [Idle mode](getting-started.md#idle-mode). |
| `wakeGraceMs` | `5000` | After a wake, close again after this long unless the model replies. Capped at `idleTimeoutMs`; `0` turns it off. |
| `standbyTimeoutMs` | off | Over `'webrtc'`: pause the model after this long with nobody talking, and resume it about half a second after the user speaks, without reconnecting. 5000 to 60000. Set it above the slowest tool. See [Standby](getting-started.md#standby). |
| `continueConversation` | `false` | Continue the conversation when a session reopens: after a stop, or from a saved `sessionId` after the app was killed. While on, OpenAI stores each session. With `standbyTimeoutMs`, the conversation is also kept on the device for up to 24 h, so it continues with standby. See [Continuing a conversation](getting-started.md#continuing-a-conversation). |
| `webSearch` | `false` | Give the delegate OpenAI's hosted web search, so the model can answer about weather, news and other current information. Each search is billed. |
| `logFile` | `false` | Write the SDK's log and the toolkit's events (sessions, idle and wake, delegations, tool calls, errors, on iOS the engine's state and route, and on Android audio focus changes) to a file in the caches directory, for `shareLogs()`. It starts with the app's name, version and build, the OS version, the device model and the SDK version. |
| `logConversation` | `false` | Include the transcript and tool arguments and results in that log. |
| `diagnosticAudioSeconds` | — | With `logFile`: keep this many seconds of audio from the microphone, what the model hears and the output (`Switchboard.DiagnosticRecorder`). `shareLogs()` then shares a zip of the log, `mic`, `heard` and `output` WAV files, and `labels.txt`: what happened (the toolkit's and the app's log lines, other apps lowered and back, audio route changes) as an Audacity label track, timed against the mic recording by its frame count. A `diagnostics: … recording ends` line in the log marks where each recording ends. About 0.4 MB of memory per second for each. |
| `mixWithOthers` | `false` | Play alongside other apps' audio, like music, instead of stopping it. On iOS, voice processing removes it from what the model hears. On Android the system lowers it while the engine runs, and how well the phone's echo canceller keeps it from the model depends on the phone. |
| `otherAudioDucking` | `'min'` | iOS 17+, with `mixWithOthers`: how far other apps' audio is lowered, and only while someone talks (`'min'`, `'mid'`, `'max'`). `'default'` keeps the system's ducking, which lowers it the whole time. |
| `duckOtherApps` | `false` | iOS, with `mixWithOthers`: lower other apps' audio while a session is open where voice processing doesn't, as over Bluetooth or on the speaker with `echoCancelledInput`. Not while the app's own media plays. iOS pauses the app that plays for each change, so they're lowered only while the app says with `setOtherAudioResumable(true)` that it plays again what plays, from `addOtherAppsDuckListener`, and raising them waits while another app plays. Without that, nothing is lowered. |
| `media` | off | Media alongside the conversation, from an http(s) URL: `true`, or `{ loudness, nowPlayingControls }`. Without it the graph has no media nodes. See [Media](media.md). |
| `echoCancelledInput` | `false` | iOS 18.2+: on iPhones that support it (2024 and later models), cancel the speaker's echo through the audio session instead of voice processing, so a Bluetooth device connecting doesn't restart audio. No automatic gain control, and other apps' audio isn't lowered on the speaker; `duckOtherApps` lowers it there. Other iPhones use voice processing. Needs an SDK with `prefersEchoCancelledInput`. |
| `offlineNotice` | `false` | When the network is gone for 3 s, or a session can't be reached for 10 s, say so once with the device's own voice (on Android, its text-to-speech engine; a phone without one says nothing), and again once the session is back, or the network while idle; it plays through the engine next to the model's voice, with media lowered meanwhile. Plays media that failed meanwhile again once the network is back, and tells the model how long it was offline. `true` says it in English; `{ offline, online, language }` sets the words and the device voice's language. |
| `microphone` | `'phone'` | iOS, with a Bluetooth device connected: `'phone'` plays over Bluetooth in high quality (A2DP) and the model hears the phone's microphone; `'bluetooth'` uses the device's microphone, with call-quality audio (HFP). See [iOS setup](getting-started.md#ios-setup). |
| `onError` | — | Receives every failure, including non-fatal ones. |

## `useOpenAILiveToolkit()`

| Field | Notes |
| --- | --- |
| `isRunning` | Engine started. |
| `connectionStatus` | `'none' \| 'connecting' \| 'connected' \| 'paused' \| 'idle' \| 'error'`. `'paused'`: standby paused the model, and the session resumes on speech. `'idle'`: idle mode closed the session and it reopens on speech. `'error'` stays until a session comes up. |
| `activity` | `'listening' \| 'userSpeaking' \| 'thinking' \| 'speaking'`, while connected. `'userSpeaking'` comes from the voice activity detector (idle mode or media only) and the user's transcript, `'speaking'` from the model's transcript; both end a second after the last fragment. `'thinking'` lasts from a delegation until the model speaks, at most 15 s. |
| `error` | Outstanding fatal `OpenAILiveError`, or null. |
| `start(options?)`, `stop()`, `release()` | Start opens a session; with `continueConversation` it continues the conversation a stop closed, or `options.continueSessionId`. Stop closes it and keeps the engine; release frees it. |
| `sessionId` | The latest session's id, for the app to save and pass to `start` as `continueSessionId`. Null before the first session and after `newConversation()`. |
| `sessionContinued` | Whether the session that's up continues the conversation of the one before it, as when idle mode wakes it. The `sessionStarted` live event carries it as `continued`, and `forked` when the session forked the one before, so it holds the context that one was given; with standby a session is continued from the conversation instead, and the toolkit gives it its notes again. |
| `newConversation()` | Forgets the conversation and clears the transcript, and deletes the conversation kept on the device. A new session starts right away while running, also while idle. |
| `hasMicrophonePermission`, `requestMicrophonePermission()` | `start()` requests it automatically. |
| `transcript`, `clearTranscript()` | `TranscriptEntry[]`: `{ id, speaker: 'user' \| 'assistant', text, startMs, endMs }`, in the order things were said. A new line starts whenever the speaker changes. |
| `instructions`, `setInstructions(text)` | Fixed per session: while running this starts a new session and drops the conversation. `addContext` tells a live session something without dropping it. |
| `addContext(text)` | Quiet context the model uses but doesn't mention unless the user asks. |
| `setSessionNote(key, text, options?)` | Keeps the model told a note, by key, such as what another app plays: each new session hears it, and a continued one only once it changed. With `{ onlyUpdate: true }` only a session that heard an earlier note under the key is told, e.g. that something stopped. `''` drops the note. |
| `say(text)` | Content for the model to say aloud (it may paraphrase). |
| `voice`, `setVoice(voice)` | Fixed per session, like `setInstructions`. |
| `model` | Read-only. |
| `bluetooth` | iOS: `{ connected, microphone, setMicrophone }`. `connected`: a Bluetooth headset, car or speaker is in use or has a microphone; offer the microphone choice while it's true. `setMicrophone('bluetooth' \| 'phone')` applies live; audio restarts briefly. `connected` is always false on Android. |
| `muted`, `setMuted(muted)` | Stops the model hearing the mic. Kept across sessions. |
| `voiceVolume`, `setVoiceVolume(volume)` | How loud the model's voice plays, 0 to 1. The default, 0.5, lifts it 6 dB to about music level; 1 is +12 dB. A limiter on the output keeps it from clipping. Applied live. |
| `voiceProcessing`, `setVoiceProcessing(enabled)` | iOS: whether the engine may use voice processing (echo cancellation), which it does only on the phone's speaker or earpiece. On by default. Applied live. |
| `registerTool(tool)`, `unregisterTool(name)` | See [Tools](tools.md). |
| `shareLogs()` | Opens the share sheet with the log file, about the last 2 MB, zipped with the `diagnosticAudioSeconds` recordings when on. Rejects unless the provider has `logFile` on. |
| `letOtherAudioPlay()` | iOS: stops the app's media if it keeps other apps from playing (`media.nowPlayingControls`), and resolves to whether they can play now. Call it before starting another app's playback, such as the Music app's. In the background it resolves to false and the media keeps playing: iOS won't let the session mix again there, and the other app would cut the conversation off. The same goes for media that stopped in the background, until the app is opened. |
| `otherAppsDucked`, `setOtherAudioResumable(resumable)`, `addOtherAppsDuckListener(listener)` | iOS: whether `duckOtherApps` has other apps lowered; whether the app plays again what a change pauses, such as the Music app while it plays (other apps are lowered only while it does, and while it doesn't, raising them waits for other apps to stop); and `(ducked, othersCanPlay)` after each change. The change paused the app that played: an app that controls it can play it again when `othersCanPlay`, which is false while the app's media keeps other apps from playing. |

`say` takes up to 500 tokens. `addContext` sends longer text in pieces.

## Media hooks

`useMedia()`, `useMediaPosition()` and `useMediaTools()` are in [Media](media.md#api).

## `useVoiceLevels(listener)`

Calls `listener` with `{ input, output }` every 50 ms while the engine runs and the app isn't in the background, then once with zeros when that ends. Both are 0 to 1 on a decibel scale, the RMS over the last 100 ms from -60 dBFS (0) to 0 dBFS (1), so speech sits around 0.5–0.7: `input` is what the model hears, and `output` is the model's voice before the voice volume. It doesn't re-render; drive an `Animated.Value` from it.

## `useTool(tool)`

Registers an `OpenAILiveToolkitTool` (`{ name, description, parameters?, handler }`) for the component's lifetime. See [Tools](tools.md).

## `useVoiceVolumeTool()`

Registers `set_voice_volume` for the component's lifetime, so the model can set `voiceVolume` when asked to speak up or be quieter, exactly or by a step. See [The model's voice volume](tools.md#the-models-voice-volume).

## Errors

Every failure is an `OpenAILiveError` with a `code`, a `message` and `fatal`. Fatal ones land in `error`; all of them go to `onError`.

| Code | Fatal | Meaning |
| --- | --- | --- |
| `INIT_FAILED` | yes | The SDK refused to initialize. |
| `NOT_INITIALIZED` | yes | `start()` before the SDK came up. |
| `MISSING_API_KEY` | yes | No OpenAI key with the `websocket` transport. |
| `MIC_PERMISSION_DENIED` | yes | The user denied the microphone, or (iOS) the app's `Info.plist` has no `NSMicrophoneUsageDescription`. |
| `ENGINE_CREATION_FAILED` | yes | The graph couldn't be built. |
| `ENGINE_START_FAILED` | yes | The engine refused to start. |
| `ENGINE_STOP_FAILED` | yes | The engine refused to stop; it's still running. |
| `SESSION_FAILED` | when the SDK stops reconnecting | A session failed or OpenAI reported an error. Non-fatal during a live session and while the SDK reconnects. Fatal when it stops: a refused session, wrong app credentials or no OpenAI key on the app. Also fatal after 3 tries in a row fail with the network up, though it keeps trying. Tries while offline are only logged. `details` has OpenAI's error `type` and `code` when there is one. |
| `TOOL_HANDLER_FAILED` | no | A handler threw; the model was told. |
| `TOOL_RESULT_UNDELIVERED` | no | A tool result couldn't reach OpenAI. |
| `MEDIA_FAILED` | no | Media couldn't play: `media` is off, the engine isn't running, the URL isn't http(s), or the stream failed. Also in `useMedia().error`. |

## Other exports

- `VOICES`: every `OpenAIVoice`.
- `getDocumentsPath()`, `writeFile(path, contents)`: file helpers for logs and recordings.
- `log(message)`: adds a line to the toolkit's log, which `logFile` writes and `shareLogs()` shares.
