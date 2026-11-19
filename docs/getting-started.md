# Getting started

## Install

The package isn't published. Depend on the checkout, or on a tarball from `npm pack` (see [CONTRIBUTING](../CONTRIBUTING.md#testing-against-a-real-consumer-app)):

```sh
npm install /path/to/synervoz-openai-live-toolkit-0.1.0.tgz
cd ios && bundle exec pod install
```

On Android, Gradle gets the libraries from the Synervoz Maven repository instead; see [Android setup](#android-setup).

`pod install` runs `scripts/download-ios-frameworks.sh`, which downloads `SwitchboardSDK`, `SwitchboardOpenAI`, and `SwitchboardSileroVAD` with `SwitchboardOnnx` (for idle mode) from the public Switchboard SDK builds into `ios/Frameworks/`.

By default it fetches the latest 3.3.0 development build, `develop/3.3.0`. To use another build, set `SWITCHBOARD_BUILD` (`develop/<version>` or `release/<version>`) before installing:

```sh
SWITCHBOARD_BUILD=release/<version> bundle exec pod install
```

Downloads are skipped when the requested build is already present, so a newer `develop` build isn't picked up on its own. CocoaPods only runs the script when it first installs the pod, so after changing `SWITCHBOARD_BUILD`, or to get a newer `develop`, delete `ios/Frameworks/` in the toolkit, run `npm run ios:frameworks` (from the toolkit checkout), then `pod install`.

## Speaker isolation

Speaker isolation is optional and off by default. It needs two things:

1. **The AICoustics extension.** It's in early access ([hello@synervoz.com](mailto:hello@synervoz.com)), so it's only linked when you ask for it, from a local Switchboard SDK build that has it:

   ```sh
   SWITCHBOARD_LOCAL_BUILD=/path/to/switchboard-sdk/out OPENAI_LIVE_AICOUSTICS=1 bundle exec pod install
   ```

   Set both on every `pod install`; without them the pod is rebuilt without AICoustics. If the framework doesn't appear, run the same variables with `npm run ios:frameworks` from the toolkit checkout first.

2. **An ai-coustics license key**, passed as `aiCousticsLicenseKey`.

With both, `speakerIsolation.available` is true and Quail sits in front of the model. `speakerIsolation.supported` tells you whether the build has the extension, so the app can say which part is missing. A key given to a build without the extension is ignored with a warning.

## iOS setup

- **iOS 15.1 or later**, React Native's minimum.
- **Microphone string.** Add `NSMicrophoneUsageDescription` to `Info.plist`.
- **Background audio.** To keep a conversation going with the screen locked or the app in the background, add `audio` to `UIBackgroundModes`. Without it iOS suspends the app, the connection drops, and a new session starts when the app returns. The session keeps billing while backgrounded, so stop the engine when the conversation ends.
- **Bluetooth.** With a Bluetooth headset, car or speaker connected, the model hears the phone's microphone and the voice plays in high quality (A2DP) by default, which suits a phone mounted nearby, as in a car. `microphone: 'bluetooth'`, or `bluetooth.setMicrophone` on the hook while running, uses the device's microphone instead, with call-quality audio (HFP), for a phone in a pocket. A device without a microphone, like a speaker, isn't used then. `bluetooth.connected` tells when to offer the choice; keep offering it while `'bluetooth'` is picked, since a speaker drops out then.
- **Simulator.** Works without AICoustics, on Apple silicon Macs only: `SwitchboardOpenAI` has no x86_64 simulator slice. With AICoustics linked, build for a physical iPhone: its xcframework has no simulator slice.
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
- **Offline notice.** `offlineNotice` speaks with the phone's text-to-speech engine. Most phones have one; on a phone without one the notice is silent, and the rest of it (reconnecting, lowering media, telling the model) still works.
- **Speaker isolation** isn't available: there is no Android build of the AICoustics extension.

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
| `aiCousticsLicenseKey` | no | Enables speaker isolation in a build that links AICoustics. Without either the graph has no Quail node. |

The example app reads these from `example/.env` with `react-native-dotenv`. That keeps them out of source control, but not out of the app: the values are compiled into its JavaScript bundle.

## What runs

```
mic → mono → 48→16 kHz → Quail → 16→48 kHz → OpenAI.Live → volume → mixer → limiter → speaker
```

Without speaker isolation the resamplers and Quail are left out: `mic → mono → OpenAI.Live → volume → mixer → limiter → speaker`. The volume is the model's voice volume, and the limiter keeps it from clipping. With [media](media.md) on, a media player plays into the mixer too.

The engine runs at 48 kHz with platform echo cancellation: voice processing on iOS, the voice-communication input on Android. The session opens when the engine starts and closes when it stops; GPT-Live bills per second of session. Starting again begins a new conversation, unless `continueConversation` is set (see [Continuing a conversation](#continuing-a-conversation)).

## Idle mode

Set `idleTimeoutMs` on the provider to stop paying for silence. Once nobody has talked for that long (no speech from the user, nothing from the model, no tool running), the session closes and `connectionStatus` becomes `'idle'`. The engine keeps running, and a Silero VAD on the input the model hears reopens the session when the user speaks:

```
mic → mono → [Quail] → splitter → OpenAI.Live → speaker
                          └─────→ Silero VAD
```

- **The conversation continues.** The new session forks the closed one, so the model remembers what was said. OpenAI stores sessions while idle mode is on, which forking needs. If the stored session is gone, a new one starts instead.
- **Nothing is lost while it reopens.** Reopening takes 1–4 s, mostly OpenAI forking the session. The `OpenAI.Live` node keeps what the user says meanwhile, plus a short pre-roll from before the VAD fired, and plays it to the model sped up until it catches up: twice real-time speed with the pitch kept over WebRTC, three times over the WebSocket. The first reply after a wake comes about a second later than usual, more when the fork is slow.
- **Forks slow down as the conversation grows**, from 1–2 s to 5 s or more over a long drive, nearly all of it on OpenAI's side. A fork still holds the context the closed session was given, so don't give it again: use `setSessionNote` for context that changes, or check `sessionContinued`.
- **Any voice wakes it**, and some noises: the VAD can't tell the user from a TV or someone nearby, and takes a phone vibrating on a table for speech. Quail doesn't help while the user is silent: it keeps a lone voice, and lets the vibration through. A wake the model doesn't answer closes again after `wakeGraceMs` (5 s by default) instead of a full idle timeout.
- **Instructions and voice.** A fork keeps the closed session's instructions and voice, so changing either while idle makes the next session start fresh.
- **Muted.** Speech doesn't reopen the session while the model is muted.

## Continuing a conversation

Set `continueConversation` on the provider to keep the conversation when a session reopens. OpenAI stores each session while it's on, which forking needs.

- **Stop and start.** `start()` after `stop()` forks the session the stop closed, so the model remembers what was said.
- **After the app was killed.** The toolkit keeps nothing across launches. Save `sessionId` from `useOpenAILiveToolkit()` and pass it to the first start: `start({ continueSessionId })`. When to resume is up to the app: clear the saved id when the user logs out, so the next user doesn't pick up their conversation, and drop it once it's old. The model remembers, but `transcript` starts empty. A session that was up when the app was killed can only be continued once OpenAI has closed it on its side, which can take up to a couple of minutes; a start before that begins a new conversation.
- **Instructions and voice.** A fork keeps those of the session it continues, so after `setInstructions` or `setVoice` the next session starts fresh. Save them with a session id, and skip the resume when they've changed.
- **Starting over.** `newConversation()` forgets the conversation and clears the transcript; a session that's up is replaced right away. After `release()` the next session starts fresh too.
- **If it can't be continued**, for example OpenAI no longer has the stored session, a new session starts instead.

## Other apps' audio

Starting the conversation stops other apps' audio, such as the Music app, unless `mixWithOthers` is set.

- **Mixing.** With `mixWithOthers`, other apps keep playing. On iOS, voice processing keeps them out of what the model hears, and `otherAudioDucking` lowers them while someone talks. On Android the system lowers them for as long as the engine runs, and the phone's echo canceller keeps them from the model, how well depending on the phone.
- **Another app starting** to play while the conversation runs plays alongside it. On Android the log says `audio focus: lost`.
- **Where voice processing doesn't lower them** (iOS), as over Bluetooth or on the speaker with `echoCancelledInput`, `duckOtherApps` lowers them while a session is open. The duck changes as a session opens and closes, and each change pauses the other app, so it only happens while the app calls `setOtherAudioResumable(true)`, as it should while it plays the other app itself; play it again from `addOtherAppsDuckListener`.
- **What plays.** An app that controls another app's player, such as the Music app's, can keep the model told what plays with `setSessionNote('music', 'Apple Music is playing "…".')`: each new session hears it, and a continued one only once the note changed. Register tools for it with `useTool`.

With the toolkit's own [media](media.md) on, see [Another app's player](media.md#another-apps-player).
