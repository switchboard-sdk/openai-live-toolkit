import type { OpenAILiveToolkitTool } from './OpenAILiveToolkit'
import { targetPercent } from './volumeChange'

/**
 * set_voice_volume: the model sets its own voice's volume, 0 to 100, for "speak up" and "quieter".
 * The tools note tells it that's the only way it can.
 */
export function voiceVolumeTool(voice: {
  voiceVolume: number
  setVoiceVolume: (volume: number) => void
}): OpenAILiveToolkitTool {
  return {
    name: 'set_voice_volume',
    description:
      'Set how loud your own voice is, apart from the music, e.g. when asked to speak up. Give ' +
      'either volume, for an exact level, or change, for louder or quieter.',
    parameters: {
      type: 'object',
      properties: {
        volume: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Volume in percent; 50 is the default.',
        },
        change: {
          type: 'number',
          description: 'Percentage points to add; negative is quieter. About 20 for "a bit".',
        },
      },
      additionalProperties: false,
    },
    handler: (args: { volume?: number; change?: number }) => {
      voice.setVoiceVolume(targetPercent(Math.round(voice.voiceVolume * 100), args) / 100)
      return { volume: Math.round(voice.voiceVolume * 100) }
    },
  }
}
