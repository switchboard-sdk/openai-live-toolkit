import type { OpenAILiveError } from '../errors'

/** The provider's `media` settings. */
export interface MediaOptions {
  /**
   * Bring media to this loudness, in LUFS (e.g. -14), so stations and podcasts mastered at
   * different levels play equally loud: the media's gain follows its measured loudness slowly,
   * and starts over with each `play`. Needs an SDK with `Switchboard.LoudnessNormalizer`.
   * Fixed for the engine's lifetime. Off by default.
   */
  loudness?: number
  /**
   * iOS: while media plays, the app is the system's Now Playing app: the lock screen, Control
   * Center and car displays show it, and their buttons, a car's volume knob included, control it.
   * Other apps' audio stops meanwhile, even with `mixWithOthers`, which is back once the media
   * stops. Another app's audio that interrupts it pauses the media and plays on; after an
   * interruption that leaves no other app playing, such as a call, the media resumes. Off by default.
   */
  nowPlayingControls?: boolean
}

/**
 * Where the media player is. `'connecting'` and `'buffering'` wait for audio, `'finished'` is a file
 * played to its end, `'idle'` is nothing loaded.
 */
export type MediaState = 'idle' | 'connecting' | 'buffering' | 'ready' | 'finished' | 'error'

/** What a stream says is playing. Fields it doesn't say are empty. */
export interface MediaMetadata {
  /** Usually "Artist - Title". */
  title: string
  stationName: string
  genre: string
  /** The station's website. */
  url: string
}

/** Where the media is, as `useMedia()` shows it. */
export interface MediaStatus {
  /** The URL loaded, or null. */
  url: string | null
  /** The station's name: from the media tools' stations, else what the stream says. */
  station: string | null
  /** Where the player is: connecting, buffering, playing audio (`'ready'`), finished, failed. */
  state: MediaState
  /** Playing, or waiting for audio to play, rather than paused or stopped. */
  playing: boolean
  /** Whether it's a live stream, such as radio, rather than a file. Known once `state` is `'ready'`. */
  live: boolean
  /**
   * A file's length in seconds, estimated from its size, once `state` is `'ready'`. 0 for a live
   * stream, or when the server doesn't say.
   */
  duration: number
  /** What the stream says is playing, or null until it says. */
  metadata: MediaMetadata | null
  /** Why the last URL failed to play, or null. */
  error: OpenAILiveError | null
  /** 0 to 1, before ducking. */
  volume: number
}

/**
 * A station the model can play through the media tools. Its name and description reach the model
 * on one line, capped and without double quotes, so they can come from a station directory.
 */
export interface MediaStation {
  /** What the user calls it, e.g. "Newstalk 1010". */
  name: string
  /** An http(s) MP3 or AAC stream. */
  url: string
  /** What it plays, so the model can pick, e.g. "Toronto news and talk". */
  description?: string
}

/** Options for `useMediaTools`. */
export interface MediaToolsOptions {
  /** Stations the model can play by name. */
  stations?: MediaStation[]
  /**
   * Let the model play any public http(s) URL, such as one the user reads out or one it found.
   * Off by default: the model then plays only {@link stations}.
   */
  allowUrls?: boolean
  /**
   * A player in another app, such as the Music app, that these tools don't control: the model is
   * told its volume can't be set here, and set_media_volume refuses while only it plays.
   */
  externalPlayer?: ExternalPlayer
}

/** A player in another app, for {@link MediaToolsOptions.externalPlayer}. */
export interface ExternalPlayer {
  /** What the model calls it, e.g. "Apple Music". */
  name: string
  /** Whether it plays now. */
  isPlaying: () => boolean
}
