# Getting started

## Install

The package isn't published. Depend on the checkout, or on a tarball from `npm pack` (see [CONTRIBUTING](../CONTRIBUTING.md#testing-against-a-real-consumer-app)):

```sh
npm install /path/to/synervoz-openai-live-toolkit-0.1.0.tgz
cd ios && bundle exec pod install
```

`pod install` runs `scripts/download-ios-frameworks.sh`, which pulls `SwitchboardSDK`, `SwitchboardOpenAI`, and `SwitchboardSileroVAD` with `SwitchboardOnnx` (for idle mode) into `ios/Frameworks/` with the AWS CLI. It needs credentials that can read `s3://switchboard-sdk`:

```sh
aws s3 ls s3://switchboard-sdk/builds/release/   # should list versions
```

By default it fetches `release/3.2.8`. To use another build, set `SWITCHBOARD_BUILD` (`release/<version>`, or a branch build path) before installing:

```sh
SWITCHBOARD_BUILD=release/3.2.9 bundle exec pod install
```

Downloads are skipped when the requested build is already present. CocoaPods only runs the script when it first installs the pod, so after changing `SWITCHBOARD_BUILD` run it directly with `npm run ios:frameworks` (from the toolkit checkout), then `pod install`.

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

- **Microphone string.** Add `NSMicrophoneUsageDescription` to `Info.plist`.
- **Background audio.** To keep a conversation going with the screen locked or the app in the background, add `audio` to `UIBackgroundModes`. Without it iOS suspends the app, the connection drops, and a new session starts when the app returns. The session keeps billing while backgrounded, so stop the engine when the conversation ends.
- **Simulator.** Works without AICoustics. With it linked, build for a physical iPhone: the AICoustics xcframework has no simulator slice.
- **New architecture.** The toolkit is a C++ TurboModule; the app must run with the new architecture (the RN default).
- **Privacy manifest.** The pod ships one declaring the file-timestamp API the frameworks use; it's merged into the app's privacy report automatically.

## Credentials

Pass them to the provider:

| Prop | Required | Notes |
| --- | --- | --- |
| `openAIApiKey` | yes | GPT-Live accepts only a real key. `start()` fails with `MISSING_API_KEY` without one. |
| `aiCousticsLicenseKey` | no | Enables speaker isolation in a build that links AICoustics. Without either the graph has no Quail node. |
| `appId`, `appSecret` | no | Switchboard credentials. Fall back to shared defaults. |

Keep keys out of source. The example app reads them from `example/.env` with `react-native-dotenv`.

## What runs

```
mic → mono → 48→16 kHz → Quail → 16→48 kHz → OpenAI.Live → speaker
```

Without speaker isolation the resamplers and Quail are left out: `mic → mono → OpenAI.Live → speaker`.

The engine runs at 48 kHz with platform echo cancellation (`voiceProcessingEnabled`). The session opens when the engine starts and closes when it stops; GPT-Live bills per second of session.

## Idle mode

Set `idleTimeoutMs` on the provider to stop paying for silence. Once nobody has talked for that long (no speech from the user, nothing from the model, no tool running), the session closes and `connectionStatus` becomes `'idle'`. The engine keeps running, and a Silero VAD on the input the model hears reopens the session when the user speaks:

```
mic → mono → [Quail] → splitter → OpenAI.Live → speaker
                          └─────→ Silero VAD
```

- **The conversation continues.** The new session forks the closed one, so the model remembers what was said. OpenAI stores sessions while idle mode is on, which forking needs. If the stored session is gone, a new one starts instead.
- **Nothing is lost while it reopens.** Reopening takes 2–4 s. The `OpenAI.Live` node keeps what the user says meanwhile, plus a short pre-roll from before the VAD fired, and sends it at three times real-time speed until it catches up. The first reply after a wake comes under a second later than usual.
- **Any voice wakes it.** The VAD can't tell the user from a TV or someone nearby, and Quail doesn't help while the user is silent: it keeps a lone voice. A false wake costs one idle timeout of session time.
- **Instructions and voice.** A fork keeps the closed session's instructions and voice, so changing either while idle makes the next session start fresh.
- **Muted.** Speech doesn't reopen the session while the model is muted.
