# Example app

A GPT-Live voice assistant screen: start/stop, an optional speaker isolation toggle, mute, a live transcript of both sides, and two tools (`set_background_color`, `get_time`).

## Setup

Needs Node 22+ and AWS credentials that can read `s3://switchboard-sdk` (see [Getting started](../docs/getting-started.md)). iOS needs Ruby 3.1+ with Bundler and Xcode; Android needs JDK 17 and the Android SDK with NDK 29.0.14206865.

The app uses the shared Switchboard credentials and the WebRTC transport, so it needs no OpenAI key: the Switchboard backend creates the session. To use another app or backend, such as staging, set `SWITCHBOARD_APP_ID`, `SWITCHBOARD_APP_SECRET` and `SWITCHBOARD_API_URL` in `.env`, then restart Metro with `npm start -- --reset-cache` so it picks them up.

```sh
cp .env.example .env
npm install
cd ios && bundle exec pod install && cd ..
npm start
```

Open `ios/OpenAILiveToolkitExample.xcworkspace`, pick your team under Signing & Capabilities, and run it.

### Android

```sh
npm run android
```

The first build fetches the Switchboard AARs into the toolkit's `android/libs/`. For a local SDK build, copy it in first from the toolkit checkout with `SWITCHBOARD_LOCAL_BUILD=/path/to/switchboard-sdk/out npm run android:libraries` (see [Android setup](../docs/getting-started.md#android-setup)). Runs on a phone or an arm64/x86_64 emulator.

### Speaker isolation (optional)

The app runs without it; the toggle stays disabled and says what's missing. To turn it on you need an ai-coustics license key and access to the AICoustics extension:

```sh
# in .env
AIC_LICENSE_KEY=your-ai-coustics-key

cd ios && OPENAI_LIVE_AICOUSTICS=1 bundle exec pod install && cd ..
```

AICoustics has no simulator slice, so run on a physical iPhone once it's linked. There is no Android build of it.

`example/` depends on the checkout (`file:..`), so library changes in `src/` show up on reload.

## Things to try

- Talk over the assistant mid-sentence. GPT-Live handles the interruption itself.
- With speaker isolation on, play a podcast or a second voice nearby, then turn it off. The model stops taking turns when it hears a competing talker as you.
- "What time is it?" and "Make the background dark blue" exercise the tools through delegation.
