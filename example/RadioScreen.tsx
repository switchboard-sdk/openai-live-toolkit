/**
 * Radio: an example of what media adds. Stations the user and the model can play, what's playing,
 * and on iOS the lock screen's Now Playing controls. The provider has `media` and `offlineNotice`
 * on for it.
 *
 * @format
 */

import React, { useEffect } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import {
  useMedia,
  useMediaTools,
  useOpenAILiveToolkit,
  useVoiceVolumeTool,
  type MediaPlayback,
} from '@synervoz/openai-live-toolkit';
import { Section, Segments, styles } from './ui';

// Two MP3 stations and an HE-AAC one, which Android doesn't play yet.
const STATIONS = [
  {
    name: 'BigR 80s Metal',
    label: 'Metal',
    url: 'http://bigrradio.cdnstream1.com/5186_128',
    description: '80s metal',
  },
  {
    name: '0N Classic Rock',
    label: 'Rock',
    url: 'https://0n-classicrock.radionetz.de/0n-classicrock.mp3',
    description: 'classic rock hits',
  },
  ...(Platform.OS === 'ios'
    ? [
        {
          name: 'Newstalk 1010',
          label: 'News',
          url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CFRBAMAAC.aac',
          description: 'Toronto news and talk',
        },
      ]
    : []),
];

const CHOICES = [
  { value: null, label: 'Off' },
  ...STATIONS.map(({ url, label }) => ({ value: url, label })),
];

function nowPlaying(media: MediaPlayback): string {
  if (media.error) {
    return media.error.message;
  }
  if (media.state !== 'ready') {
    return `${media.state}…`;
  }
  const status = [media.station, media.metadata?.title].filter(Boolean).join(' — ') || 'Playing';
  return media.playing ? status : `${status} (paused)`;
}

export function RadioScreen(): React.JSX.Element {
  const { isRunning } = useOpenAILiveToolkit();
  const media = useMedia();
  useMediaTools({ stations: STATIONS });
  // "Speak up" over the music.
  useVoiceVolumeTool();

  // The model's media tools leave with this screen, so the radio does too.
  const stopMedia = media.stop;
  useEffect(() => stopMedia, [stopMedia]);

  return (
    <Section title="Radio">
      {/* Media plays through the conversation's audio, so only while it runs. */}
      {isRunning ? (
        <>
          <Segments
            fill
            options={CHOICES}
            value={media.url}
            onChange={(url) => (url ? media.play(url) : media.stop())}
          />
          {media.url ? (
            <View style={styles.row}>
              <Text style={[styles.hint, styles.flex]} numberOfLines={2}>
                {nowPlaying(media)}
              </Text>
              {media.state === 'ready' ? (
                <TouchableOpacity onPress={media.playing ? media.pause : media.resume}>
                  <Text style={styles.link}>{media.playing ? 'Pause' : 'Play'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.hint}>Start talking, then pick a station or ask for one.</Text>
      )}
    </Section>
  );
}
