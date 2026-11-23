# Example app

A GPT-Live voice assistant with two screens that share one conversation: a live transcript of both sides, start/stop, and idle mode after 15 s of silence.

- **Basics** ([`BasicsScreen.tsx`](BasicsScreen.tsx)) is the core, as in the README's quickstart: two tools (`get_time`, `set_background_color`), mute, and the Bluetooth microphone choice.
- **Radio** ([`RadioScreen.tsx`](RadioScreen.tsx)) is an example implementation of [media](../docs/media.md): three stations the user and the model can play with `useMediaTools`, what's playing, Now Playing on the iOS lock screen, and the offline notice. Leaving the screen stops the radio, since the model's media tools go with it.

The provider in [`App.tsx`](App.tsx) has every setting both screens use, and the transcript and Start button are in [`Conversation.tsx`](Conversation.tsx).

## Setup

Needs Node 22+. iOS needs Ruby 3.1+ with Bundler and Xcode; Android needs JDK 17 and the Android SDK with NDK 29.0.14206865.

The app uses the toolkit's demo credentials, which are rotated regularly, and the WebRTC transport, so it needs no OpenAI key: the Switchboard backend creates the session. To use your own Switchboard app ([register one](https://console.switchboard.audio/register)) or another backend, set `SWITCHBOARD_APP_ID`, `SWITCHBOARD_APP_SECRET` and `SWITCHBOARD_API_URL` in `.env`, then restart Metro with `npm start -- --reset-cache` so it picks them up.

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

`example/` depends on the checkout (`file:..`), so library changes in `src/` show up on reload.

## Things to try

On Basics:

- Talk over the assistant mid-sentence. GPT-Live handles the interruption itself.
- "What time is it?" and "Make the background dark blue" exercise the tools through delegation.
- Stay quiet for 15 s and the connection shows `idle`. Ask something about the earlier conversation: the session reopens and the model remembers it.

On Radio, after Start talking:

- "Play some rock", "What's this song?", "Turn it down" and "Play something else". The model's voice ducks the radio while it talks.
- Lock the phone (iOS): the lock screen shows the station and song, and its buttons pause it or change the station.
- Turn on airplane mode while the radio plays: the phone says the connection is lost, with the radio lowered, and says so again when it's back. The radio plays again.

Android plays MP3 only for now, so Radio has no News station there.
