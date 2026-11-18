import { voiceVolumeTool } from './voiceVolumeTool'

// The tool the model sets its own voice's volume with: percent in, the clamped result out.

function tool() {
  const voice = {
    voiceVolume: 0.5,
    setVoiceVolume: (volume: number) => {
      voice.voiceVolume = Math.min(1, Math.max(0, volume))
    },
  }
  return { voice, handler: voiceVolumeTool(voice).handler }
}

it('sets the voice volume, absolute or relative, in percent', async () => {
  const { voice, handler } = tool()
  expect(await handler({ volume: 30 })).toEqual({ volume: 30 })
  expect(await handler({ change: 20 })).toEqual({ volume: 50 })
  expect(await handler({ change: 200 })).toEqual({ volume: 100 })
  expect(voice.voiceVolume).toBe(1)
})

it('takes the delegate filling in both, with 0 for the one it means not', async () => {
  const { handler } = tool()
  expect(await handler({ volume: 0, change: 20 })).toEqual({ volume: 70 })
  expect(await handler({ volume: 30, change: 0 })).toEqual({ volume: 30 })
})

it('keeps the volume when given neither', async () => {
  const { handler } = tool()
  expect(await handler({})).toEqual({ volume: 50 })
})
