# Example app

A GPT-Live voice assistant screen: start/stop, an optional speaker isolation toggle, mute, a live transcript of both sides, two tools (`set_background_color`, `get_time`), and idle mode after 15 s of silence.

## Setup

Needs Node 22+, Ruby 3.1+ with Bundler, Xcode, and AWS credentials that can read `s3://switchboard-sdk` (see [Getting started](../docs/getting-started.md)).

```sh
cp .env.example .env         # fill in OPENAI_API_KEY
npm install
cd ios && bundle exec pod install && cd ..
npm start
```

Open `ios/OpenAILiveToolkitExample.xcworkspace`, pick your team under Signing & Capabilities, and run it.

### Speaker isolation (optional)

The app runs without it; the toggle stays disabled and says what's missing. To turn it on you need an ai-coustics license key and access to the AICoustics extension:

```sh
# in .env
AIC_LICENSE_KEY=your-ai-coustics-key

cd ios && OPENAI_LIVE_AICOUSTICS=1 bundle exec pod install && cd ..
```

AICoustics has no simulator slice, so run on a physical iPhone once it's linked.

`example/` depends on the checkout (`file:..`), so library changes in `src/` show up on reload.

## Things to try

- Talk over the assistant mid-sentence. GPT-Live handles the interruption itself.
- With speaker isolation on, play a podcast or a second voice nearby, then turn it off. The model stops taking turns when it hears a competing talker as you.
- "What time is it?" and "Make the background dark blue" exercise the tools through delegation.
- Stay quiet for 15 s and the connection shows `idle`. Ask something about the earlier conversation: the session reopens and the model remembers it.
