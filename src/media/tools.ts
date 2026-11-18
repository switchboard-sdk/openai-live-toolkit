import type { OpenAILiveToolkitTool } from '../OpenAILiveToolkit'
import { targetPercent } from '../volumeChange'
import { isLocalUrl, redactUrl, streamText } from './sanitize'
import type { ExternalPlayer, MediaStation, MediaStatus } from './types'

export const MEDIA_TOOL_NAMES = [
  'play_media',
  'pause_media',
  'resume_media',
  'set_media_volume',
  'get_now_playing',
  'seek_media',
] as const

/** What the media tools control. */
export interface MediaToolsPlayer {
  status(): MediaStatus
  /** @throws {OpenAILiveError} `MEDIA_FAILED` when it can't play. */
  play(url: string): void
  waitForStart(): Promise<MediaStatus>
  pause(): void
  resume(): void
  setVolume(volume: number): void
  position(): number
  /** @returns where it moved to. */
  seek(seconds: number): number
  /** The station called `name`, or with no name, the next one after what's playing. */
  pickStation(name?: string): MediaStation | undefined
  voiceVolume(): number
}

/** The station as the model is told it, quoted: its name can come from a directory or the stream. */
export function stationForModel(status: MediaStatus): string | null {
  return status.station ? `"${streamText(status.station)}"` : null
}

// iOS has no way for one app to set another's volume.
function externalVolumeNote(player: ExternalPlayer): string {
  return `${player.name}'s volume can't be set from this app, only the app's own radio and podcasts.`
}

/**
 * Tools that let the model play stations (and URLs, with `allowUrls`), pause, resume, set the
 * media's volume, seek in a file and say what's playing. `stations` are
 * already cleaned for the model.
 */
export function mediaTools(
  player: MediaToolsPlayer,
  options: { stations: MediaStation[]; allowUrls: boolean; externalPlayer: ExternalPlayer | null }
): OpenAILiveToolkitTool[] {
  const { stations, allowUrls, externalPlayer } = options
  const names = stations.map((st) => st.name)
  // Station text can come from a directory, so it stays out of the description, which the live
  // model is told too, and is quoted in the parameter only the delegate sees.
  const stationList = stations
    .map((st) => (st.description ? `"${st.name}" (${st.description})` : `"${st.name}"`))
    .join('; ')
  const play: OpenAILiveToolkitTool = {
    name: 'play_media',
    description:
      'Play a radio station or audio stream, replacing what is playing. ' +
      (names.length > 0
        ? `With no station${allowUrls ? ' or URL' : ''}, plays a different station from the one playing, for "play something else".`
        : 'Needs a stream URL.'),
    parameters: {
      type: 'object',
      properties: {
        ...(names.length > 0
          ? {
              station: {
                type: 'string',
                enum: names,
                description: `The station to play: ${stationList}.`,
              },
            }
          : {}),
        ...(allowUrls
          ? {
              url: {
                type: 'string',
                description: 'An http(s) MP3 or AAC stream URL, when the user gives one.',
              },
            }
          : {}),
      },
      additionalProperties: false,
    },
    handler: async ({ station, url }: { station?: string; url?: string }) => {
      if (url && !allowUrls) {
        return { error: 'Only the listed stations can be played.' }
      }
      if (url && isLocalUrl(url)) {
        return { error: "URLs on the device or a local network can't be played." }
      }
      const target = url ? { url } : player.pickStation(station)
      if (!target) {
        return {
          error: station ? `There's no station called ${station}.` : 'There is no other station.',
        }
      }
      player.play(target.url)
      const status = await player.waitForStart()
      if (status.state === 'error') {
        return { error: streamText(status.error?.message ?? "It couldn't be played.") }
      }
      return {
        playing: stationForModel(status) ?? redactUrl(target.url),
        ...(status.metadata?.title ? { title: streamText(status.metadata.title) } : {}),
        ...(status.state === 'ready' ? {} : { note: 'Still connecting.' }),
      }
    },
  }
  return [
    // Nothing to play without stations or URLs.
    ...(names.length > 0 || allowUrls ? [play] : []),
    {
      name: 'pause_media',
      description: 'Pause the music or radio that is playing.',
      handler: () => {
        const status = player.status()
        if (!status.url || !status.playing) {
          return { error: 'Nothing is playing.' }
        }
        player.pause()
        return { paused: stationForModel(player.status()) }
      },
    },
    {
      name: 'resume_media',
      description: 'Resume the music or radio after a pause.',
      handler: () => {
        if (!player.status().url) {
          return { error: 'Nothing is paused; play a station instead.' }
        }
        player.resume()
        return { playing: stationForModel(player.status()) }
      },
    },
    {
      name: 'set_media_volume',
      description:
        'Set how loud the music or radio plays, not your voice. Give either volume, for an exact level, ' +
        'or change, for louder or quieter.' +
        (externalPlayer ? ` ${externalVolumeNote(externalPlayer)}` : ''),
      parameters: {
        type: 'object',
        properties: {
          volume: { type: 'number', minimum: 0, maximum: 100, description: 'Volume in percent.' },
          change: {
            type: 'number',
            description: 'Percentage points to add; negative is quieter. About 20 for "a bit".',
          },
        },
        additionalProperties: false,
      },
      handler: ({ volume, change }: { volume?: number; change?: number }) => {
        // Otherwise the model says the other app got quieter.
        if (!player.status().url && externalPlayer?.isPlaying()) {
          return {
            error: `Only ${externalPlayer.name} is playing. ${externalVolumeNote(externalPlayer)} The car's or phone's volume sets how loud it is.`,
          }
        }
        player.setVolume(
          targetPercent(Math.round(player.status().volume * 100), { volume, change }) / 100
        )
        return { volume: Math.round(player.status().volume * 100) }
      },
    },
    {
      name: 'get_now_playing',
      description:
        "What's playing in the app: the station, the song or show, whether it's paused, its " +
        'volume, and how loud your voice is.',
      handler: () => {
        const status = player.status()
        return {
          state: !status.url
            ? 'stopped'
            : status.state === 'error'
              ? 'failed'
              : status.playing
                ? 'playing'
                : 'paused',
          station: stationForModel(status),
          title: status.metadata?.title ? streamText(status.metadata.title) : null,
          // With nothing loaded, a volume reads as another app's.
          ...(status.url ? { volume: Math.round(status.volume * 100) } : {}),
          voice_volume: Math.round(player.voiceVolume() * 100),
          ...(status.url && !status.live
            ? { position: Math.round(player.position()), duration: Math.round(status.duration) }
            : {}),
        }
      },
    },
    {
      name: 'seek_media',
      description:
        'Skip forward or back in a podcast or other file by some seconds ("skip ahead a minute", ' +
        '"go back 30 seconds"), or jump to a time ("go back to the start"). Live radio can\'t skip.',
      parameters: {
        type: 'object',
        properties: {
          by: {
            type: 'number',
            description: 'Seconds to skip; negative goes back, e.g. 30 or -60. 0 when using to.',
          },
          to: {
            type: 'number',
            minimum: 0,
            description:
              'Seconds from the start to jump to, e.g. 0 for the start. Ignored unless by is 0.',
          },
        },
        additionalProperties: false,
      },
      handler: ({ by, to }: { by?: number; to?: number }) => {
        const status = player.status()
        if (!status.url) {
          return { error: 'Nothing is playing.' }
        }
        if (status.live) {
          return { error: "This is live; it can't skip." }
        }
        // The delegate fills in both, with 0 for the one it doesn't mean.
        const here = player.position()
        const position = player.seek(by ? here + by : (to ?? here))
        const duration = player.status().duration
        return {
          position: Math.round(position),
          ...(duration > 0 ? { duration: Math.round(duration) } : {}),
        }
      },
    },
  ]
}
