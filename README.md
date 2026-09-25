# OpenAI Live toolkit

Internal React Native toolkit for full-duplex voice agents on OpenAI GPT-Live (`gpt-live-1`), with ai-coustics speaker isolation, built on the Switchboard SDK. iOS only, device only.

GPT-Live listens while it speaks and decides turn-taking itself, so there is no turn detection or barge-in tuning here. What the toolkit adds around the model:

- **Audio I/O and echo cancellation.** The model hears the microphone continuously, so platform echo cancellation keeps it from hearing itself on speakerphone.
- **Speaker isolation.** Quail removes competing talkers before the audio reaches the model. Without it, a background talker reads as continuous user speech and the model stops taking turns ([SWI-6905](https://linear.app/switchboard/issue/SWI-6905/validate-speaker-isolation-with-gpt-live-1)).
- **Tools.** `useTool` registers functions the model can call through Responses delegation.
- **A live transcript** of both sides, grouped from GPT-Live's interleaved fragments.

```tsx
import { Text, TouchableOpacity } from 'react-native'
import { OpenAILiveToolkitProvider, useOpenAILiveToolkit, useTool } from '@synervoz/openai-live-toolkit'

export default function App() {
  return (
    <OpenAILiveToolkitProvider openAIApiKey={OPENAI_API_KEY} aiCousticsLicenseKey={AIC_LICENSE_KEY}>
      <Screen />
    </OpenAILiveToolkitProvider>
  )
}

function Screen() {
  const { isRunning, start, stop, speakerIsolation } = useOpenAILiveToolkit()

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

- AWS credentials with read access to `s3://switchboard-sdk`. The AICoustics extension is only built privately, so `pod install` fetches private Switchboard builds.
- An OpenAI API key. GPT-Live accepts only a real key (no ephemeral tokens), so keep builds internal.
- An ai-coustics license key for speaker isolation. Without one the graph runs without Quail.
- A physical iPhone. The private AICoustics framework has no simulator slice.

## Documentation

- [Getting started](docs/getting-started.md): install, frameworks, credentials.
- [Tools](docs/tools.md): `useTool`, delegation, tool errors.
- [API reference](docs/api-reference.md): provider props, the hook, errors.
- [Example app](example/README.md): a full screen with a transcript, isolation toggle and tools.
