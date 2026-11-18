# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `OpenAILiveToolkitProvider`, `useOpenAILiveToolkit` and `useTool` for full-duplex GPT-Live voice agents on iOS 15.1 and later.
- Optional Quail speaker isolation, switchable at runtime. Linked with `OPENAI_LIVE_AICOUSTICS=1` at `pod install`.
- Tools through Responses delegation.
- A grouped live transcript of both speakers.
- Context actions: `addContext`, `say`. The model is told not to mention context unless the user asks.
- Example app with a transcript, isolation toggle, mute and two tools.
- `transport` prop: `'webrtc'` by default, where the Switchboard backend creates the session and the app holds no OpenAI key; `'websocket'` with `openAIApiKey`.
- `SWITCHBOARD_LOCAL_BUILD` for frameworks built from a `switchboard-sdk` checkout.
- `apiUrl` prop for another Switchboard backend.
- Android support, without speaker isolation: the Switchboard AARs are fetched on the first Gradle build, a microphone foreground service keeps the conversation going in the background, and the example app has an Android target.
- `idleTimeoutMs`: closes the session during silences and reopens it, forked from the closed one, when the user speaks.
- `continueConversation`: `start()` after `stop()` continues the conversation, forked from the session the stop closed, and `start({ continueSessionId })` continues a session the app saved before it was killed. OpenAI stores each session while it's on. `sessionId` and `newConversation()` on the hook; the example app resumes a conversation from the last 24 hours.
- `logFile`, `logConversation` and `shareLogs()`: the SDK's log and the toolkit's events, optionally with the conversation, in a file in the caches directory, shared through the share sheet. The log starts with the app's name, version and build, the iOS version, the device model and the SDK version. On iOS the log has the engine's state (running, interrupted, failed, stopped, and why) and its route. The example app has a Share logs link.
- `diagnosticAudioSeconds` (iOS): the last seconds of audio from the microphone, what the model hears and the output, zipped with the log and an Audacity label track of what happened by `shareLogs()`.
- `webSearch`: the delegate can search the web, for weather, news and other current information.
- `mixWithOthers` and `otherAudioDucking` (iOS): music from other apps keeps playing, lowered only while someone talks.
- `microphone` and the hook's `bluetooth` (iOS): with a Bluetooth device connected, hear the phone's microphone with high-quality Bluetooth audio (the default), or the device's microphone in call quality. The example app shows a Microphone: Bluetooth / Phone choice while one is connected.
- `media` prop and `useMedia()`: plays an MP3 or AAC stream or file from an http(s) URL, such as internet radio, mixed with the model's voice and ducked while it talks; echo cancellation keeps it from the model. Off by default, with no media nodes in the graph. The example app has a Radio choice while it runs.
- `useMediaTools()`: the model can play a station (or any public URL, with `allowUrls`), pause, resume, change the volume and say what's playing, and is told when the station or song changes. The example app gives it three stations.
- Seeking in media files: `media.seek()`, `media.duration`, `useMediaPosition()` and the `seek_media` tool.
- `sessionContinued` on the hook, and `continued` on the `sessionStarted` event: whether the session continues the conversation, so the app can skip context it already gave.
- `setSessionNote()`: notes the app keeps the model told, by key, such as what another app plays. Each new session hears them; a continued one only those that changed.
- `useMediaTools({ externalPlayer })`: `set_media_volume` says another app's volume can't be set here, and refuses while only that app plays.
- `letOtherAudioPlay()` (iOS): stops the app's media if it keeps other apps from playing, and resolves to whether they can play now: not in the background, where iOS won't let the session mix again, also after the media stopped there.
- `media.nowPlayingControls` (iOS): while media plays, the app is the system's Now Playing app, shown on the lock screen and car displays and controlled by their buttons and a car's volume knob. Another app that interrupts it pauses the media and plays on.
- `duckOtherApps` (iOS): other apps are lowered while a session is open over Bluetooth, where voice processing doesn't lower them. Only while the app plays again what a change pauses, such as the Music app: `setOtherAudioResumable`, `otherAppsDucked` and `addOtherAppsDuckListener`.
- `echoCancelledInput` (iOS 18.2+): on 2024 and later iPhones, the speaker's echo is cancelled through the audio session instead of voice processing, so Bluetooth connecting doesn't restart audio; `duckOtherApps` then lowers other apps on the speaker too.
- `offlineNotice` (iOS): when the connection is lost, and again when it's back, the device says so in its own voice, with media lowered meanwhile; the toolkit reconnects as soon as the network is back, plays media that failed meanwhile again, and tells the model how long it was offline.
- `media.loudness`: media is brought to a loudness in LUFS, so stations and podcasts mastered at different levels play equally loud (`Switchboard.LoudnessNormalizer`).
- `media.waitForStart()`: resolves once what `play` started plays or fails.
- `activity` on the hook: listening, the user speaking, thinking over a delegation, or the model speaking, for showing what the conversation is doing.
- `useVoiceVolumeTool()`: the model can set its own voice's volume, for "speak up" and "quieter".
- `useVoiceLevels()`: how loud the user and the model are, every 50 ms, for animating with their voices. VU meters on what the model hears and on its voice.
