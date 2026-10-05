# Full-duplex voice agents in React Native

OpenAI's GPT-Live (`gpt-live-1`) is a full-duplex voice model. It listens while it speaks and decides for itself when to take a turn, when to back off, and when someone has interrupted it. There is no turn detection to configure and no barge-in to tune. Conversations feel closer to talking with a person.

`@synervoz/openai-live-toolkit` puts that model in a React Native app. One provider and two hooks handle the Live session, microphone and speaker I/O, platform echo cancellation, tool calls into your app, and a live transcript of both sides. Optional on-device speaker isolation keeps other voices in the room from reaching the model. It's built on the [Switchboard SDK](https://docs.switchboard.audio/).

| Platform | Status    |
| -------- | --------- |
| iOS      | Supported |
| Android  | Not yet   |

## What the API leaves out

GPT-Live makes the conversation itself easy: speech goes up, speech comes back, and the model handles the turn-taking in between. What it gives you is a WebSocket and an audio stream. Building an app on it still means solving:

- **Capture and playback.** Pulling audio off the microphone and playing the reply through the right audio route, at matching sample rates, in real time. The model streams audio continuously, silence included, so playback has to keep pace.
- **The microphone hearing the speaker.** A full-duplex model never stops listening. On speakerphone it hears its own voice the whole time it talks, unless acoustic echo cancellation removes it first.
- **Tool calls.** GPT-Live doesn't call functions. It hands work to a separate Responses model, which does, and it only hands off work it knows your app can do.
- **A transcript.** Both sides arrive as interleaved fragments that need grouping into lines.
- **Staying connected.** The session has to survive the screen locking and the app going to the background.

This toolkit is that layer.

## The easy part

Wrap your app, call the hook, register a tool, press the button.

```tsx
import { Text, TouchableOpacity } from 'react-native'
import {
    OpenAILiveToolkitProvider,
    useOpenAILiveToolkit,
    useTool,
} from '@synervoz/openai-live-toolkit'

export default function App() {
    return (
        <OpenAILiveToolkitProvider
            openAIApiKey={OPENAI_API_KEY}
            instructions="You are a terse, friendly voice assistant.">
            <Screen />
        </OpenAILiveToolkitProvider>
    )
}

function Screen() {
    const { isRunning, start, stop } = useOpenAILiveToolkit()

    // Something the agent can actually do. Ask it the time.
    useTool({
        name: 'get_time',
        description: 'Get the current time.',
        handler: () => ({ time: new Date().toLocaleTimeString() }),
    })

    return (
        <TouchableOpacity onPress={isRunning ? stop : start}>
            <Text>{isRunning ? 'Stop' : 'Start talking'}</Text>
        </TouchableOpacity>
    )
}
```

That is a working voice agent, tool call included. `start()` requests the microphone, builds the audio graph with echo cancellation on, and opens the session. `useTool` tells the model the tool exists and routes the call to your handler; the return value goes back automatically. Talk over the agent and GPT-Live handles the interruption itself.

## Other voices in the room

Because GPT-Live listens all the time, everything the microphone picks up is you as far as the model is concerned. A podcast playing, a colleague on a call at the next desk, a TV in the background: the model hears a second voice talking continuously, decides you haven't finished, and stops taking turns. In our tests with a competing talker, the model answered about one prompt in ten.

Speaker isolation fixes that on the device. ai-coustics Quail separates the main talker from the rest before the audio leaves the phone, so the model hears only the person holding it. With it on, the model answered six to ten prompts in ten in the same tests.

```
mic → mono → 48→16 kHz → Quail → 16→48 kHz → OpenAI.Live → speaker
```

It's a runtime switch, applied to the live session:

```tsx
const { speakerIsolation } = useOpenAILiveToolkit()
speakerIsolation.setEnabled(true)
```

Speaker isolation is optional. It needs an ai-coustics license key and the AICoustics Switchboard extension, which isn't published yet. Without it the graph runs `mic → mono → OpenAI.Live → speaker` and `speakerIsolation.available` is false. See [Getting started](docs/getting-started.md#speaker-isolation).

## Tools

`useTool` scales up to anything your app can do. It takes JSON Schema parameters and can change state or call your backend. Register a `set_background_color` tool and "make the background dark blue" repaints the screen. Handlers run while the conversation continues, so a slow one doesn't freeze the voice. See [Tools](docs/tools.md) for how delegation works, dynamic tool sets, and what happens when a handler throws.

## Before you ship

- **The OpenAI key is in the app.** GPT-Live accepts only a real API key, with no ephemeral tokens yet, so it ends up in the binary. Don't give builds to people you wouldn't give the key to.
- **Private Switchboard builds.** The `OpenAI.Live` node isn't in a public Switchboard release yet, so `pod install` fetches a build from `s3://switchboard-sdk` and needs AWS credentials that can read it.
- **Billing.** GPT-Live bills per second of session, including while the app is backgrounded. Stop the engine when the conversation ends.
- **Physical device with AICoustics.** Its framework has no simulator slice. Everything else runs in the simulator.

## Documentation

- [Getting started](docs/getting-started.md) covers install, frameworks, speaker isolation, iOS setup, and credentials.
- [Tools](docs/tools.md) covers `useTool`, delegation, dynamic tool sets, and tool errors.
- [API reference](docs/api-reference.md) covers the provider, the `useOpenAILiveToolkit()` hook, every export, and the error codes.
- [Example app](example/README.md) is a complete screen with a transcript, the isolation toggle, and two tools.
