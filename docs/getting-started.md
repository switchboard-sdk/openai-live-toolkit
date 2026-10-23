# Getting started

## Install

The package isn't published. Depend on the checkout, or on a tarball from `npm pack` (see [CONTRIBUTING](../CONTRIBUTING.md#testing-against-a-real-consumer-app)):

```sh
npm install /path/to/synervoz-openai-live-toolkit-0.1.0.tgz
cd ios && bundle exec pod install
```

On Android the first Gradle build fetches the libraries instead; see [Android setup](#android-setup).

`pod install` runs `scripts/download-ios-frameworks.sh`, which pulls `SwitchboardSDK`, `SwitchboardOpenAI`, and `SwitchboardSileroVAD` with `SwitchboardOnnx` (for idle mode) into `ios/Frameworks/` with the AWS CLI. It needs credentials that can read `s3://switchboard-sdk`:

```sh
aws s3 ls s3://switchboard-sdk/builds/release/   # should list versions
```

By default it fetches `release/3.2.8`. To use another build, set `SWITCHBOARD_BUILD` (`release/<version>`, or a branch build path) before installing:

```sh
SWITCHBOARD_BUILD=release/3.2.9 bundle exec pod install
```

Downloads are skipped when the requested build is already present. CocoaPods only runs the script when it first installs the pod, so after changing `SWITCHBOARD_BUILD` run it directly with `npm run ios:frameworks` (from the toolkit checkout), then `pod install`.

The WebRTC transport needs a Switchboard SDK build that isn't in S3 yet. Build the frameworks from a `switchboard-sdk` checkout and point `SWITCHBOARD_LOCAL_BUILD` at its `out/` directory; packages found there are copied instead of downloaded:

```sh
# in switchboard-sdk
inv sdk.build-ios --clean && inv openai.build-ios && inv onnx.build-ios && inv silerovad.build-ios && inv aicoustics.build-ios

# in the toolkit checkout
SWITCHBOARD_LOCAL_BUILD=/path/to/switchboard-sdk/out OPENAI_LIVE_AICOUSTICS=1 npm run ios:frameworks
```

`--clean` is needed when the last build in that checkout was an extension, which leaves the SDK target out of the CMake cache.

## Speaker isolation

Speaker isolation is optional and off by default. It needs two things:

1. **The AICoustics extension.** It isn't published, so it's only linked when you ask for it, and the download needs the same S3 access:

   ```sh
   OPENAI_LIVE_AICOUSTICS=1 bundle exec pod install
   ```

   Set it on every `pod install`; without it the pod is rebuilt without AICoustics. If the framework doesn't appear, run `OPENAI_LIVE_AICOUSTICS=1 npm run ios:frameworks` from the toolkit checkout first.

2. **An ai-coustics license key**, passed as `aiCousticsLicenseKey`.

With both, `speakerIsolation.available` is true and Quail sits in front of the model. `speakerIsolation.supported` tells you whether the build has the extension, so the app can say which part is missing. A key given to a build without the extension is ignored with a warning.

## iOS setup

- **iOS 14 or later.** `SwitchboardOpenAI` links libwebrtc, which is built for iOS 14.
- **Microphone string.** Add `NSMicrophoneUsageDescription` to `Info.plist`.
- **Background audio.** To keep a conversation going with the screen locked or the app in the background, add `audio` to `UIBackgroundModes`. Without it iOS suspends the app, the connection drops, and a new session starts when the app returns. The session keeps billing while backgrounded, so stop the engine when the conversation ends.
- **Simulator.** Works without AICoustics, on Apple silicon Macs only: `SwitchboardOpenAI` has no x86_64 simulator slice. With AICoustics linked, build for a physical iPhone: its xcframework has no simulator slice.
- **New architecture.** The toolkit is a C++ TurboModule; the app must run with the new architecture (the RN default).
- **Privacy manifest.** The pod ships one declaring the file-timestamp API the frameworks use; it's merged into the app's privacy report automatically.

## Android setup

The C++ TurboModule is compiled in the app's native build and links the Switchboard AARs through Prefab. The first Gradle build runs `scripts/download-android-libraries.sh`, which pulls `SwitchboardSDK`, `SwitchboardOpenAI`, and `SwitchboardSileroVAD` with `SwitchboardOnnx` (for idle mode) into the toolkit's `android/libs/`. It takes the same S3 access, `SWITCHBOARD_BUILD` and `SWITCHBOARD_LOCAL_BUILD` as the iOS script. Later builds reuse the AARs, so after changing either variable run `npm run android:libraries` from the toolkit checkout.

The WebRTC transport needs a local SDK build here too:

```sh
# in switchboard-sdk
inv sdk.build-android && inv openai.build-android && inv onnx.build-android && inv silerovad.build-android

# in the toolkit checkout
SWITCHBOARD_LOCAL_BUILD=/path/to/switchboard-sdk/out npm run android:libraries
```

The app needs three changes:

1. **Prefab**, in `android/app/build.gradle`:

   ```groovy
   android {
       buildFeatures {
           prefab true
       }
   }
   ```

2. **NDK 29**, in the `buildscript { ext { … } }` block of the root `android/build.gradle`. The React Native template's 27.x builds, but the app fails at launch with `cannot locate symbol "__cxa_init_primary_exception"`:

   ```groovy
   ndkVersion = "29.0.14206865"
   ```

3. **No 32-bit x86**, in `android/gradle.properties`. The AARs ship `arm64-v8a`, `armeabi-v7a` and `x86_64`:

   ```properties
   reactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64
   ```

The rest comes with the library:

- **Permissions.** `RECORD_AUDIO`, `INTERNET`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS` and the microphone foreground service merge in from its manifest. `start()` asks for the microphone and, on Android 13+, for notifications. Without the latter the conversation still runs, but the foreground service's notification stays hidden.
- **Background.** While the engine runs, a microphone foreground service with an ongoing notification keeps the conversation going with the screen locked or another app in front. Swiping the app away stops it. The session keeps billing meanwhile, so stop the engine when the conversation ends.
- **Echo cancellation.** The mic and speaker open for voice communication and the audio mode switches to communication, routed to a connected headset, else the loudspeaker. Playback follows the in-call volume, which the volume keys control during a conversation. The canceller is the device's, so how well it works varies by phone.
- **Speaker isolation** isn't available: there is no Android build of the AICoustics extension.

The emulator works for arm64 and x86_64 images.

## Credentials

The session reaches GPT-Live over one of two transports, set with the provider's `transport` prop:

- **`webrtc`** (default). The SDK sends its WebRTC offer to the Switchboard backend, which creates the session with the Switchboard app's OpenAI key and returns OpenAI's answer. Audio and events then go straight between the phone and OpenAI. The app holds no OpenAI key, but the Switchboard app needs one configured on the backend.
- **`websocket`**. Connects straight to OpenAI with `openAIApiKey`.

Pass the credentials to the provider:

| Prop | Required | Notes |
| --- | --- | --- |
| `appId`, `appSecret` | no | Switchboard credentials. Fall back to shared defaults, which only exist on production. |
| `apiUrl` | no | Switchboard backend, e.g. `https://staging.api.switchboard.audio`. Defaults to production. Anything other than `https://<host>.switchboard.audio` fails `initialize`. |
| `openAIApiKey` | with `websocket` | `start()` fails with `MISSING_API_KEY` without one. Ignored with `webrtc`. |
| `aiCousticsLicenseKey` | no | Enables speaker isolation in a build that links AICoustics. Without either the graph has no Quail node. |

Keep keys out of source. The example app reads them from `example/.env` with `react-native-dotenv`.

## What runs

```
mic → mono → 48→16 kHz → Quail → 16→48 kHz → OpenAI.Live → speaker
```

Without speaker isolation the resamplers and Quail are left out: `mic → mono → OpenAI.Live → speaker`.

The engine runs at 48 kHz with platform echo cancellation: voice processing on iOS, the voice-communication input on Android. The session opens when the engine starts and closes when it stops; GPT-Live bills per second of session.

## Idle mode

Set `idleTimeoutMs` on the provider to stop paying for silence. Once nobody has talked for that long (no speech from the user, nothing from the model, no tool running), the session closes and `connectionStatus` becomes `'idle'`. The engine keeps running, and a Silero VAD on the input the model hears reopens the session when the user speaks:

```
mic → mono → [Quail] → splitter → OpenAI.Live → speaker
                          └─────→ Silero VAD
```

- **The conversation continues.** The new session forks the closed one, so the model remembers what was said. OpenAI stores sessions while idle mode is on, which forking needs. If the stored session is gone, a new one starts instead.
- **Nothing is lost while it reopens.** Reopening takes 1–4 s, mostly OpenAI forking the session. The `OpenAI.Live` node keeps what the user says meanwhile, plus a short pre-roll from before the VAD fired, and plays it to the model sped up until it catches up: twice real-time speed with the pitch kept over WebRTC, three times over the WebSocket. The first reply after a wake comes about a second later than usual, more when the fork is slow.
- **Any voice wakes it**, and some noises: the VAD can't tell the user from a TV or someone nearby, and takes a phone vibrating on a table for speech. Quail doesn't help while the user is silent: it keeps a lone voice, and lets the vibration through. A wake the model doesn't answer closes again after `wakeGraceMs` (5 s by default) instead of a full idle timeout.
- **Instructions and voice.** A fork keeps the closed session's instructions and voice, so changing either while idle makes the next session start fresh.
- **Muted.** Speech doesn't reopen the session while the model is muted.
