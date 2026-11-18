# Example app

A GPT-Live voice assistant screen: start/stop, an optional speaker isolation toggle, mute, a live transcript of both sides, two tools (`set_background_color`, `get_time`), and idle mode after 15 s of silence.

## Setup

Needs Node 22+. iOS needs Ruby 3.1+ with Bundler and Xcode; Android needs JDK 17 and the Android SDK with NDK 29.0.14206865.

The app uses the shared Switchboard credentials and the WebRTC transport, so it needs no OpenAI key: the Switchboard backend creates the session. To use your own Switchboard app or another backend, set `SWITCHBOARD_APP_ID`, `SWITCHBOARD_APP_SECRET` and `SWITCHBOARD_API_URL` in `.env`, then restart Metro with `npm start -- --reset-cache` so it picks them up.

Install the toolkit's own dependencies in the repo root first. Installing `example/` builds the toolkit with its `tsc`, and without them that build uses whatever `tsc` is on your `PATH`, which can fail.

```sh
(cd .. && npm install)
cp .env.example .env
npm install
cd ios && bundle exec pod install && cd ..
npm start
```

Open `ios/OpenAILiveToolkitExample.xcworkspace`, pick your team under Signing & Capabilities, and run it. For the simulator, pick a specific device such as iPhone 17 Pro, not Any iOS Simulator Device: `SwitchboardOpenAI` has no x86_64 simulator slice, so the generic destination fails with an rsync error.

### Android

```sh
npm run android
```

The first build downloads the Switchboard SDK from the Synervoz Maven repository (see [Android setup](../docs/getting-started.md#android-setup)). Runs on a phone or an arm64/x86_64 emulator.

### Speaker isolation (optional)

The app runs without it; the toggle stays disabled and says what's missing. To turn it on you need an ai-coustics license key and a local Switchboard SDK build with the AICoustics extension, which isn't published:

```sh
# in .env
AIC_LICENSE_KEY=your-ai-coustics-key

cd ios && SWITCHBOARD_LOCAL_BUILD=/path/to/switchboard-sdk/out OPENAI_LIVE_AICOUSTICS=1 bundle exec pod install && cd ..
```

AICoustics has no simulator slice, so run on a physical iPhone once it's linked. There is no Android build of it.

`example/` depends on the checkout (`file:..`), so library changes in `src/` show up on reload.

## Things to try

- Talk over the assistant mid-sentence. GPT-Live handles the interruption itself.
- With speaker isolation on, play a podcast or a second voice nearby, then turn it off. The model stops taking turns when it hears a competing talker as you.
- "What time is it?" and "Make the background dark blue" exercise the tools through delegation.
- Stay quiet for 15 s and the connection shows `idle`. Ask something about the earlier conversation: the session reopens and the model remembers it.
