/**
 * Basics: the README's quickstart grown into a screen. Two tools the model can call, and the
 * microphone controls.
 *
 * @format
 */

import React from 'react';
import { Switch, Text, View } from 'react-native';
import { useOpenAILiveToolkit, useTool } from '@synervoz/openai-live-toolkit';
import { Section, Segments, styles } from './ui';

const MICROPHONES = [
  { value: 'bluetooth', label: 'Bluetooth' },
  { value: 'phone', label: 'Phone' },
] as const;

export function BasicsScreen({
  onBackgroundColor,
}: {
  onBackgroundColor: (color: string) => void;
}): React.JSX.Element {
  const { bluetooth, muted, setMuted } = useOpenAILiveToolkit();

  useTool({
    name: 'get_time',
    description: 'Get the current local time.',
    handler: () => ({ time: new Date().toLocaleTimeString() }),
  });

  useTool({
    name: 'set_background_color',
    description:
      "Changes the application's background color. Call only when the user " +
      'asks to change the background color of the app.',
    parameters: {
      type: 'object',
      properties: {
        color: { type: 'string', description: 'A CSS color name.' },
      },
      required: ['color'],
    },
    handler: async ({ color }: { color: string }) => {
      onBackgroundColor(color);
      return { success: true, color };
    },
  });

  return (
    <Section title="Audio">
      {/* Also while Bluetooth is picked: a device without a microphone then drops out, and this is
          the way back. */}
      {bluetooth.connected || bluetooth.microphone !== 'phone' ? (
        <>
          <View style={styles.row}>
            <Text style={styles.label}>Microphone</Text>
            <Segments
              options={MICROPHONES}
              value={bluetooth.microphone}
              onChange={bluetooth.setMicrophone}
            />
          </View>
          <Text style={styles.hint}>
            {bluetooth.microphone === 'phone'
              ? 'Bluetooth plays in high quality; the model hears the phone.'
              : 'The model hears the Bluetooth microphone, in call quality.'}
          </Text>
        </>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.label}>Mute microphone</Text>
        <Switch value={muted} onValueChange={setMuted} />
      </View>
    </Section>
  );
}
