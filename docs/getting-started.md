# Getting started

## Install

```sh
npm install @synervoz/openai-live-toolkit
cd ios && bundle exec pod install
```

On Android, Gradle gets the libraries from the Synervoz Maven repository instead; see [Android setup](#android-setup).

`pod install` runs `scripts/download-ios-frameworks.sh`, which downloads `SwitchboardSDK`, `SwitchboardOpenAI`, and `SwitchboardSileroVAD` with `SwitchboardOnnx` (for idle mode) from the public Switchboard SDK builds into `ios/Frameworks/`.

By default it fetches the latest 3.3.0 development build, `develop/3.3.0`. To use another build, set `SWITCHBOARD_BUILD` (`develop/<version>` or `release/<version>`) before installing:

```sh
SWITCHBOARD_BUILD=release/<version> bundle exec pod install
```

Downloads are skipped when the requested build is already present, so a newer `develop` build isn't picked up on its own. CocoaPods only runs the script when it first installs the pod, so after changing `SWITCHBOARD_BUILD`, or to get a newer `develop`, delete `ios/Frameworks/` in the toolkit, run `npm run ios:frameworks` (from the toolkit checkout), then `pod install`.

## iOS setup

- **iOS 15.1 or later**, React Native's minimum.
- **Microphone string.** Add `NSMicrophoneUsageDescription` to `Info.plist`.
- **Background audio.** To keep a conversation going with the screen locked or the app in the background, add `audio` to `UIBackgroundModes`. Without it iOS suspends the app, the connection drops, and a new session starts when the app returns. The session keeps billing while backgrounded, so stop the engine when the conversation ends.
- **Bluetooth.** With a Bluetooth headset, car or speaker connected, the model hears the phone's microphone and the voice plays in high quality (A2DP) by default, which suits a phone mounted nearby, as in a car. `microphone: 'bluetooth'`, or `bluetooth.setMicrophone` on the hook while running, uses the device's microphone instead, with call-quality audio (HFP), for a phone in a pocket. A device without a microphone, like a speaker, isn't used then. `bluetooth.connected` tells when to offer the choice; keep offering it while `'bluetooth'` is picked, since a speaker drops out then.
- **Simulator.** Apple silicon Macs only: `SwitchboardOpenAI` has no x86_64 simulator slice.
- **New architecture.** The toolkit is a C++ TurboModule; the app must run with the new architecture (the RN default).
- **Privacy manifest.** The pod ships one declaring the file-timestamp API the frameworks use; it's merged into the app's privacy report automatically.

## Android setup

The C++ TurboModule is compiled in the app's native build and links the Switchboard SDK through Prefab. The toolkit depends on the SDK and its OpenAI extension, and on Silero VAD with Onnx (for idle mode), version 3.3.0, from the Synervoz Maven repository. Set `switchboardVersion` in the root `ext` block, next to the NDK below, to use another version. Until 3.3.0 is released, Maven's 3.3.0 is the latest development build. Gradle keeps the one it downloaded first, so run `./gradlew --refresh-dependencies` to get a newer one.

The app needs four changes:

1. **The Synervoz Maven repository**, in the root `android/build.gradle`:

   ```groovy
   allprojects {
       repositories {
           maven { url "https://s3.amazonaws.com/synervoz-android-maven-repository" }
       }
   }
   ```

2. **Prefab**, in `android/app/build.gradle`:

   ```groovy
   android {
       buildFeatures {
           prefab true
       }
   }
   ```

3. **NDK 29**, in the `buildscript { ext { … } }` block of the root `android/build.gradle`. The React Native template's 27.x builds, but the app fails at launch with `cannot locate symbol "__cxa_init_primary_exception"`:

   ```groovy
   ndkVersion = "29.0.14206865"
   ```

4. **No 32-bit x86**, in `android/gradle.properties`. The AARs ship `arm64-v8a`, `armeabi-v7a` and `x86_64`:

   ```properties
   reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
   ```

The rest comes with the library:

- **Permissions.** `RECORD_AUDIO`, `INTERNET`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS` and the microphone foreground service merge in from its manifest. `start()` asks for the microphone and, on Android 13+, for notifications. Without the latter the conversation still runs, but the foreground service's notification stays hidden.
- **Background.** While the engine runs, a microphone foreground service with an ongoing notification keeps the conversation going with the screen locked or another app in front. Swiping the app away stops it. The session keeps billing meanwhile, so stop the engine when the conversation ends.
- **Echo cancellation.** The mic and speaker open for voice communication and the audio mode switches to communication, routed to a connected headset, else the loudspeaker. Playback follows the in-call volume, which the volume keys control during a conversation. The canceller is the device's, so how well it works varies by phone.
- **Bluetooth** always uses the headset's microphone and call-quality audio (HFP); `microphone` is iOS only.
- **Other apps' audio.** Starting the engine takes the audio focus, so other apps pause, or with `mixWithOthers` keep playing, lowered by the system. See [Other apps' audio](#other-apps-audio).
- **iOS only:** `voiceProcessing`, `echoCancelledInput`, `otherAudioDucking`, `duckOtherApps`, and Now Playing for media (`nowPlayingControls`).
- **Offline notice.** `offlineNotice` speaks with the phone's text-to-speech engine. Most phones have one; on a phone without one the notice is silent, and the rest of it (lowering media, telling the model) still works.

The emulator works for arm64 and x86_64 images.

## Credentials

The toolkit identifies your app to Switchboard with an `appId` and `appSecret`. The toolkit and its example ship with regularly rotated demo credentials, so they run with no setup. When you deploy your own app, register an `appId` at [console.switchboard.audio/register](https://console.switchboard.audio/register).

Pass your app credentials to the provider, from configuration rather than source:

```tsx
<OpenAILiveToolkitProvider appId={SWITCHBOARD_APP_ID} appSecret={SWITCHBOARD_APP_SECRET}>
```

### When a limit is reached

`start()` fails with a fatal `SESSION_FAILED` whose message includes `insufficient_quota`, and the toolkit doesn't retry.

### Your own OpenAI key

Self-serve keys are coming soon in the console. Until then there are two ways to run on your own OpenAI account:

- **On your Switchboard app.** We set your key on the backend, and the app keeps using the default `webrtc` transport, holding no OpenAI key. Email [hello@synervoz.com](mailto:hello@synervoz.com) to ask.
- **In the app, with the `websocket` transport.** Pass `transport="websocket"` and `openAIApiKey`. The session goes straight to OpenAI, and the backend isn't used for it. The key ships inside the app, where anyone with the app can extract it, so this suits development and internal builds. Use a key from its own OpenAI project with a hard spend limit.

### Transports

The provider's `transport` prop sets how the session reaches GPT-Live:

- **`webrtc`** (default). The SDK sends its WebRTC offer to the Switchboard backend, which creates the session with your Switchboard app's OpenAI key and returns OpenAI's answer. Audio and events then go straight between the phone and OpenAI.
- **`websocket`**. Connects straight to OpenAI with `openAIApiKey`.

### Props

| Prop | Required | Notes |
| --- | --- | --- |
| `appId`, `appSecret` | no | Switchboard credentials. Fall back to the demo credentials, which are rotated regularly. |
| `apiUrl` | no | Switchboard backend URL. Defaults to production. Anything other than `https://<host>.switchboard.audio` fails `initialize`. |
| `openAIApiKey` | with `websocket` | `start()` fails with `MISSING_API_KEY` without one. Ignored with `webrtc`. |

The example app reads these from `example/.env` with `react-native-dotenv`. That keeps them out of source control, but not out of the app: the values are compiled into its JavaScript bundle.

## What runs

```
mic → mono → OpenAI.Live → volume → mixer → limiter → speaker
```

The volume is the model's voice volume, and the limiter keeps it from clipping. With [media](media.md) on, a media player plays into the mixer too.

The engine runs at 48 kHz with platform echo cancellation: voice processing on iOS, the voice-communication input on Android. The session opens when the engine starts and closes when it stops; GPT-Live bills per second of session. Starting again begins a new conversation, unless `continueConversation` is set (see [Continuing a conversation](#continuing-a-conversation)).

## Idle mode

Set `idleTimeoutMs` on the provider to stop paying for silence. Once nobody has talked for that long (no speech from the user, nothing from the model, no delegation or tool call in progress), the `OpenAI.Live` node closes the session and `connectionStatus` becomes `'idle'`. The engine keeps running, and a Silero VAD on the input the model hears has the node reopen the session when the user speaks:

```
mic → mono → splitter → OpenAI.Live → speaker
                └─────→ Silero VAD
```

- **The conversation continues.** The new session forks the closed one, so the model remembers what was said. OpenAI stores sessions while idle mode is on, which forking needs. If the stored session is gone, a new one starts instead. With [standby](#standby), the new session is started with the conversation so far instead, and sessions aren't stored.
- **Nothing is lost while it reopens.** Reopening takes 1–4 s, mostly OpenAI forking the session. The `OpenAI.Live` node keeps what the user says meanwhile, plus a short pre-roll from before the VAD fired, and plays it to the model sped up until it catches up: twice real-time speed with the pitch kept over WebRTC, three times over the WebSocket. The first reply after a wake comes about a second later than usual, more when the fork is slow.
- **Forks slow down as the conversation grows**, from 1–2 s to 5 s or more over a long drive, nearly all of it on OpenAI's side. A fork still holds the context the closed session was given, so don't give it again: use `setSessionNote` for context that changes, or check `sessionContinued`.
- **Any voice wakes it**, and some noises: the VAD can't tell the user from a TV or someone nearby, and takes a phone vibrating on a table for speech. A wake the model doesn't answer closes again after `wakeGraceMs` (5 s by default) instead of a full idle timeout.
- **Instructions and voice.** A fork keeps the closed session's instructions and voice, so changing either while idle makes the next session start fresh.
- **Slow tools.** A tool call is waited for up to a minute. A handler that takes longer gets the session closed anyway, and its result is lost.
- **Context.** `addContext` while idle reaches the next session when it opens.
- **Muted.** Speech doesn't reopen the session while the model is muted.

## Standby

Over `'webrtc'`, set `standbyTimeoutMs` on the provider to pause the model in short silences instead of closing the session. Once nobody has talked for that long, OpenAI pauses inference and `connectionStatus` becomes `'paused'`. The connection stays open, and the model resumes about half a second after the user starts speaking, with no reconnect and nothing to catch up on. Paused time is billed at a lower rate than active time.

- **With idle mode.** Paused time is still billed, so for long silences set `idleTimeoutMs` above `standbyTimeoutMs`, e.g. 30 s of standby and a few minutes of idle mode. Standby covers the short silences, and idle mode closes the session in the long ones.
- **The conversation after idle mode.** OpenAI doesn't allow standby on a fork, so idle mode reopens the session as a new one with the conversation so far: what was heard and said, the tools called, and the context the session was given. It takes the newest of it, up to 128 messages and about 8,000 characters. The new session gets the current instructions and voice, and the toolkit gives it its notes again. Sessions aren't stored.
- **Slow tools.** A tool result that comes after the session paused isn't spoken, and the model doesn't bring it up later. OpenAI pauses as soon as the delegate finishes, so set `standbyTimeoutMs` above the slowest tool, with a few seconds to spare.
- **Continued conversations.** With `continueConversation`, `start()` after `stop()` and `start({ continueSessionId })` after the app was killed continue the conversation the same way, with standby, rather than forking. For that the conversation is also kept on the device: see below. A `continueSessionId` of an older conversation, or one from another device, is forked, without standby.
- **What's kept on the device.** With `continueConversation`, the conversation is saved to a file in the app's temporary directory (`tmp/` on iOS, which backups leave out, and the cache directory on Android), which other apps can't read and the OS encrypts at rest. It holds what was heard and said, the tools called with their arguments, and the context the session was given. A new conversation, `newConversation()` (also while stopped) and `release()` delete it, and it's deleted once it's 24 h old. Where the temporary directory is shared, as on Linux, only the user can read it. Call `newConversation()` when a user signs out, and mention it in your privacy policy if that applies.
- **Muted.** Speech doesn't resume a paused session while the model is muted.

## Continuing a conversation

Set `continueConversation` on the provider to keep the conversation when a session reopens. OpenAI stores each session while it's on, which forking needs.

- **Stop and start.** `start()` after `stop()` forks the session the stop closed, so the model remembers what was said.
- **After the app was killed.** The toolkit keeps nothing across launches. Save `sessionId` from `useOpenAILiveToolkit()` and pass it to the first start: `start({ continueSessionId })`. When to resume is up to the app: clear the saved id when the user logs out, so the next user doesn't pick up their conversation, and drop it once it's old. The model remembers, but `transcript` starts empty. A session that was up when the app was killed can only be continued once OpenAI has closed it on its side, which can take up to a couple of minutes; a start before that begins a new conversation.
- **Instructions and voice.** A fork keeps those of the session it continues, so after `setInstructions` or `setVoice` the next session starts fresh. Save them with a session id, and skip the resume when they've changed.
- **Starting over.** `newConversation()` forgets the conversation and clears the transcript; a new session starts right away, also while idle. After `release()` the next session starts fresh too.
- **If it can't be continued**, for example OpenAI no longer has the stored session, a new session starts instead.
- **With standby**, a continued conversation keeps standby: see [Standby](#standby).

## Other apps' audio

Starting the conversation stops other apps' audio, such as the Music app, unless `mixWithOthers` is set.

- **Mixing.** With `mixWithOthers`, other apps keep playing. On iOS, voice processing keeps them out of what the model hears, and `otherAudioDucking` lowers them while someone talks. On Android the system lowers them for as long as the engine runs, and the phone's echo canceller keeps them from the model, how well depending on the phone.
- **Another app starting** to play while the conversation runs plays alongside it. On Android the log says `audio focus: lost`.
- **Where voice processing doesn't lower them** (iOS), as over Bluetooth or on the speaker with `echoCancelledInput`, `duckOtherApps` lowers them while a session is open. The duck changes as a session opens and closes, and each change pauses the other app, so it only happens while the app calls `setOtherAudioResumable(true)`, as it should while it plays the other app itself; play it again from `addOtherAppsDuckListener`.
- **What plays.** An app that controls another app's player, such as the Music app's, can keep the model told what plays with `setSessionNote('music', 'Apple Music is playing "…".')`: each new session hears it, and a continued one only once the note changed. Register tools for it with `useTool`.

With the toolkit's own [media](media.md) on, see [Another app's player](media.md#another-apps-player).
