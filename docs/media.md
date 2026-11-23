# Media

Media plays an MP3 or AAC stream or file from an http(s) URL, such as internet radio or a podcast, alongside the conversation. The model can control it and is told what's playing. The [example app](../example/README.md)'s Radio screen is an example implementation: stations the user and the model can play, what's playing, and Now Playing on iOS.

Media is optional and off by default. Turn it on with the provider's `media` prop:

```tsx
<OpenAILiveToolkitProvider media>

// or with settings
<OpenAILiveToolkitProvider media={{ loudness: -14, nowPlayingControls: true }}>
```

| Setting | Default | Notes |
| --- | --- | --- |
| `loudness` | — | Bring media to this loudness in LUFS (e.g. `-14`), so stations and podcasts mastered at different levels play equally loud. The gain follows the media's measured loudness slowly, within ±12 dB, and starts over with each `play`. Needs an SDK with `Switchboard.LoudnessNormalizer`. |
| `nowPlayingControls` | `false` | iOS: while media plays, the app is the system's Now Playing app. See [Now Playing](#now-playing). |

`media` is fixed once the provider is initialized. Without it the graph has no media nodes, `useMedia().play` fails with `MEDIA_FAILED`, and `useMediaTools` is ignored with a warning.

## What runs

```
mic → … → OpenAI.Live → volume → mixer → limiter → speaker
               │                   ↑
               └─────────→ ducking ┘
                              ↑
           player → volume ───┘
```

The player is mixed into the speaker output with the model's voice, so echo cancellation keeps it from the model. The ducking node follows the model's voice and lowers the media by about 16 dB while the model talks. While the user talks over the phone's loudspeaker, and for a second after, the volume drops to a tenth (about 20 dB), coming back up over 0.6 s, so echo cancellation doesn't cut up their speech along with the media. Not on headphones or Bluetooth, which don't play into the microphone. A voice activity detector says when; nothing changes while muted. With `loudness`, a loudness normalizer sits between the player and the volume.

## Playing

`useMedia()` plays a URL and follows the player:

```tsx
const media = useMedia()
media.play('https://playerservices.streamtheworld.com/api/livestream-redirect/CFRBAMAAC.aac')
// media.state, media.playing, media.live, media.metadata?.title, media.error
media.pause()
media.resume()
media.setVolume(0.5)
media.stop()
```

- **Only while the engine runs.** `play` before `start()` fails with `MEDIA_FAILED` in `media.error`; `stop()` stops the media and closes the stream. Idle mode leaves it playing while the session is closed.
- **Formats.** MP3 and AAC (LC, HE-AAC, HE-AAC v2): live streams, files and HLS playlists, with packed audio or MPEG-TS segments (not fMP4 or encrypted ones). Android plays MP3 only for now.
- **What's playing.** Shoutcast and Icecast stations fill `metadata`: `stationName` once connected, and `title` when the song or show changes. HTML entities some stations send, such as `&amp;`, are decoded.
- **Pausing a live stream** resumes close to live, not where it paused.
- **Offline.** With `offlineNotice`, media is lowered while the device says the connection is lost or back, and media that failed while offline plays again once the network is back.

## Letting the model control media

`useMediaTools()` gives the model media tools and tells it what's playing, while the component that calls it is mounted:

```tsx
useMediaTools({
    stations: [
        {
            name: 'Newstalk 1010',
            url: 'https://…/CFRBAMAAC.aac',
            description: 'Toronto news and talk',
        },
        {
            name: '0N Classic Rock',
            url: 'https://…/0n-classicrock.mp3',
            description: 'classic rock hits',
        },
    ],
})
```

- **Tools.** `play_media` plays a station by name; with none it plays the next station, for "play something else", skipping stations that failed. With `allowUrls: true` it also plays any public http(s) URL the model is given. `pause_media`, `resume_media`, `set_media_volume` (exact or louder/quieter; not another app's, whose volume can't be set from here: with `externalPlayer` it says so while only that app plays), `seek_media` (skip by or jump to a time in a file) and `get_now_playing` (with the position in a file and the voice's volume) do what they say. They run through delegation, like the app's own tools, so they take a couple of seconds and count toward the tools note in the instructions. The note also tells the model it can't control playback itself, so it delegates skips and pauses instead of only saying it did them. For "speak up", add [`useVoiceVolumeTool()`](tools.md#the-models-voice-volume).
- **Now playing.** When the station, the song or show, or the paused state changes, the session gets a line like "Now playing on Newstalk 1010: The Morning Show." as quiet context, so the model can answer "what's this song?" without a tool. A new session is told what's playing when it starts; a continued one only what changed.
- **Stations.** `description` helps the model pick one ("play some news"). The list can change at runtime, e.g. with search results.
- **What streams say is data.** Whoever runs a station controls its title and name, so the model is told them quoted, on one line and capped. With `allowUrls`, `play_media` still refuses URLs that name the device or a local network, but that isn't protection against the model reaching them: a name that resolves to a local address, or a redirect to one, gets through. Turn it on only where that's acceptable.

## Now Playing

With `nowPlayingControls` (iOS), the app is the system's Now Playing app while media plays:

- **Shown and controlled by the system.** The lock screen, Control Center and car displays show the station or episode. Their buttons (play/pause, next and previous station, skips and seeking in a file), headphone buttons and a car's volume knob control it. Next and previous go on past a station that fails, and skip it after.
- **Other apps' audio stops** meanwhile, even with `mixWithOthers`, which is back once the media stops.
- **Interruptions.** Another app's audio that interrupts it pauses the media and plays on. After an interruption that leaves no other app playing, such as a call, the media resumes.

## Another app's player

An app that controls another app's player, such as the Music app's, registers its own tools for it with `useTool`, and keeps it playing next to the conversation as in [Other apps' audio](getting-started.md#other-apps-audio). With media on too:

- **Volume.** `useMediaTools({ externalPlayer: { name: 'Apple Music', isPlaying } })` makes `set_media_volume` say that app's volume can't be set here, and refuse while only it plays.
- **Starting it.** With `nowPlayingControls`, the app's own media stops other apps. Call `await letOtherAudioPlay()` before telling the other app to play, and don't if it resolves to false: in the background iOS won't let the session mix again, even once the app's media stopped there, and the other app would cut the conversation off until the app is opened.

## API

### `useMedia()`

| Field | Notes |
| --- | --- |
| `play(url)` | Plays an MP3 or AAC stream, file or HLS playlist from an http(s) URL, replacing what was playing. Needs `media` on and a running engine; otherwise `error` is set. |
| `waitForStart(timeoutMs?)` | Resolves with the status once what `play` started is playing (`state` `'ready'`) or has failed (`'error'`), or after `timeoutMs` (default 8000) with it still connecting. |
| `pause()`, `resume()` | A paused live stream resumes close to live; a finished file starts over. |
| `stop()` | Stops and closes the stream. `stop()` on the engine does this too. |
| `url` | The URL loaded, or null. |
| `station` | The station's name: from `useMediaTools` stations, else what the stream says. |
| `state` | `'idle' \| 'connecting' \| 'buffering' \| 'ready' \| 'finished' \| 'error'`. `'ready'` is playing audio, or ready to. |
| `playing` | Playing, or waiting for audio to play, rather than paused or stopped. |
| `live` | A live stream rather than a file. Known once `state` is `'ready'`. |
| `duration` | A file's length in seconds, estimated from its size, once `state` is `'ready'`. 0 for a live stream or when the server doesn't say. |
| `seek(seconds)` | Moves to `seconds` into a file, clamped to its length. Live streams don't seek. |
| `metadata` | `{ title, stationName, genre, url }` from the stream, or null until it says. |
| `error` | The `MEDIA_FAILED` error from the last `play`, or null. A refused `play` also goes to the provider's `onError`. |
| `volume`, `setVolume(volume)` | 0 to 1, before ducking. Defaults to 1. |

The model's media tools change this too.

### `useMediaPosition(intervalMs?)`

Where the media file is, in seconds, read every `intervalMs` (1000 by default). 0 for a live stream or with nothing loaded. Only components that call it re-render as it moves.

### `useMediaTools(options?)`

| Option | Notes |
| --- | --- |
| `stations` | `MediaStation[]`: `{ name, url, description? }`. The model plays them by name. Names and descriptions reach the model quoted, on one line, capped and without double quotes, and only the delegate sees the list, so they can come from a directory. Can change at runtime. |
| `allowUrls` | `false`. Lets the model play any http(s) URL too, not only `stations`. URLs that name the device or a local network are refused, but names resolving to local addresses and redirects aren't checked. |
| `externalPlayer` | `{ name, isPlaying }`: a player in another app, such as the Music app, that these tools don't control. `set_media_volume` says its volume can't be set here, and refuses while only it plays. `isPlaying` is read when the tool runs. |

Registers `play_media`, `pause_media`, `resume_media`, `set_media_volume`, `seek_media` and `get_now_playing`, and tells the session what's playing as quiet context.
