# OpenAI Live toolkit

React Native toolkit for full-duplex voice agents on OpenAI GPT-Live (`gpt-live-1`), with optional ai-coustics speaker isolation, built on the Switchboard SDK. iOS only.

GPT-Live listens while it speaks and decides turn-taking itself, so there is no turn detection or barge-in tuning here. What the toolkit adds around the model:

- **Audio I/O and echo cancellation.** The model hears the microphone continuously, so platform echo cancellation keeps it from hearing itself on speakerphone.
- **Speaker isolation (optional).** ai-coustics Quail removes competing talkers before the audio reaches the model. Without it, a background talker reads as continuous user speech and the model stops taking turns. It needs an ai-coustics license key and the AICoustics extension, which isn't published; everything else works without it.
- **Tools.** `useTool` registers functions the model can call through Responses delegation.
- **A live transcript** of both sides, grouped from GPT-Live's interleaved fragments.

```tsx
import { Text, TouchableOpacity } from 'react-native'
import { OpenAILiveToolkitProvider, useOpenAILiveToolkit, useTool } from '@synervoz/openai-live-toolkit'

export default function App() {
  return (
    <OpenAILiveToolkitProvider openAIApiKey={OPENAI_API_KEY}>
      <Screen />
    </OpenAILiveToolkitProvider>
  )
}

function Screen() {
  const { isRunning, start, stop } = useOpenAILiveToolkit()

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

## Requirements

- AWS credentials with read access to `s3://switchboard-sdk`. The `OpenAI.Live` node isn't in a public Switchboard release yet, so `pod install` fetches a private build.
- An OpenAI API key. GPT-Live accepts only a real key (no ephemeral tokens), and it ends up in the app binary, so don't ship builds with it to other people.
- Optional, for speaker isolation: an ai-coustics license key and access to the AICoustics extension (`OPENAI_LIVE_AICOUSTICS=1` at `pod install`). Without them the graph runs without Quail and `speakerIsolation.available` is false. See [Getting started](docs/getting-started.md#speaker-isolation).
- A physical iPhone when AICoustics is linked: its framework has no simulator slice.

## Documentation

- [Getting started](docs/getting-started.md): install, frameworks, credentials.
- [Tools](docs/tools.md): `useTool`, delegation, tool errors.
- [API reference](docs/api-reference.md): provider props, the hook, errors.
- [Example app](example/README.md): a full screen with a transcript, isolation toggle and tools.
