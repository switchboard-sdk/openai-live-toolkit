# Example app

A GPT-Live voice assistant screen: start/stop, a speaker isolation toggle, mute, a live transcript of both sides, and two tools (`set_background_color`, `get_time`).

## Setup

Needs Node 22+, Ruby 3.1+ with Bundler, Xcode, a physical iPhone, and AWS credentials that can read `s3://switchboard-sdk` (see [Getting started](../docs/getting-started.md)).

```sh
cp .env.example .env         # fill in OPENAI_API_KEY and AIC_LICENSE_KEY
npm install
cd ios && bundle exec pod install && cd ..
npm start
```

Open `ios/OpenAILiveToolkitExample.xcworkspace`, pick your team under Signing & Capabilities, and run on the device. The simulator isn't supported.

`example/` depends on the checkout (`file:..`), so library changes in `src/` show up on reload.

## Things to try

- Talk over the assistant mid-sentence. GPT-Live handles the interruption itself.
- Play a podcast or a second voice nearby, then turn speaker isolation off. The model stops taking turns when it hears a competing talker as you.
- "What time is it?" and "Make the background dark blue" exercise the tools through delegation.
