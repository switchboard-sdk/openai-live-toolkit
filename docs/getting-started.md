# Getting started

## Install

The package isn't published. Depend on the checkout, or on a tarball from `npm pack` (see [CONTRIBUTING](../CONTRIBUTING.md#testing-against-a-real-consumer-app)):

```sh
npm install /path/to/synervoz-openai-live-toolkit-0.1.0.tgz
cd ios && bundle exec pod install
```

`pod install` runs `scripts/download-ios-frameworks.sh`, which pulls `SwitchboardSDK`, `SwitchboardOpenAI` and `SwitchboardAICoustics` into `ios/Frameworks/` with the AWS CLI. It needs credentials that can read `s3://switchboard-sdk`:

```sh
aws s3 ls s3://switchboard-sdk/builds/release/   # should list versions
```

By default it fetches the SWI-6906 branch build, which has the `OpenAI.Live` node. To use another build, set `SWITCHBOARD_BUILD` (a branch build path, or `release/<version>`) before installing:

```sh
SWITCHBOARD_BUILD=release/3.2.9 bundle exec pod install
```

Downloads are skipped when the requested build is already present. CocoaPods only runs the script when it first installs the pod, so after changing `SWITCHBOARD_BUILD` run it directly with `npm run ios:frameworks` (from the toolkit checkout), then `pod install`.

## iOS setup

- **Microphone string.** Add `NSMicrophoneUsageDescription` to `Info.plist`.
- **Device only.** The AICoustics xcframework has no simulator slice, so build for a physical iPhone.
- **New architecture.** The toolkit is a C++ TurboModule; the app must run with the new architecture (the RN default).
- **Privacy manifest.** The pod ships one declaring the file-timestamp API the frameworks use; it's merged into the app's privacy report automatically.

## Credentials

Pass them to the provider:

| Prop | Required | Notes |
| --- | --- | --- |
| `openAIApiKey` | yes | GPT-Live accepts only a real key. `start()` fails with `MISSING_API_KEY` without one. |
| `aiCousticsLicenseKey` | no | Enables speaker isolation. Without it the graph has no Quail node. |
| `appId`, `appSecret` | no | Switchboard credentials. Fall back to shared defaults. |

Keep keys out of source. The example app reads them from `example/.env` with `react-native-dotenv`.

## What runs

```
mic → mono → 48→16 kHz → Quail → 16→48 kHz → OpenAI.Live → speaker
```

The engine runs at 48 kHz with platform echo cancellation (`voiceProcessingEnabled`). The session opens when the engine starts and closes when it stops; GPT-Live bills per second of session.
