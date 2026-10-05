/**
 * OpenAILiveToolkit example — a full-duplex GPT-Live voice assistant with
 * optional speaker isolation.
 *
 * All orchestration lives in the library. This app wraps itself in
 * <OpenAILiveToolkitProvider> with credentials, and the screen drives it with
 * useOpenAILiveToolkit() — lifecycle, the live transcript, speaker isolation and mute.
 *
 * @format
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  OpenAILiveToolkitProvider,
  useOpenAILiveToolkit,
  useTool,
} from '@synervoz/openai-live-toolkit';
import { OPENAI_API_KEY, AIC_LICENSE_KEY } from '@env';
import { colors } from './colors';

const INSTRUCTIONS =
  'You are a terse, friendly voice assistant. Keep answers to one sentence.';

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <OpenAILiveToolkitProvider
        openAIApiKey={OPENAI_API_KEY}
        aiCousticsLicenseKey={AIC_LICENSE_KEY}
        instructions={INSTRUCTIONS}>
        <Screen />
      </OpenAILiveToolkitProvider>
    </SafeAreaProvider>
  );
}

function Screen(): React.JSX.Element {
  const {
    isRunning,
    error,
    connectionStatus,
    transcript,
    clearTranscript,
    start,
    stop,
    speakerIsolation,
    muted,
    setMuted,
  } = useOpenAILiveToolkit();

  const [backgroundColor, setBackgroundColor] = useState(colors.bg);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript]);

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
      setBackgroundColor(color);
      return { success: true, color };
    },
  });

  useTool({
    name: 'get_time',
    description: 'Get the current local time.',
    handler: () => ({ time: new Date().toLocaleTimeString() }),
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>
      <StatusBar barStyle="light-content" backgroundColor={backgroundColor} />
      <Text style={styles.title}>Duplex Voice Agent</Text>

      {error ? <Text style={styles.error}>{error.message}</Text> : null}

      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Audio</Text>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Speaker isolation</Text>
          <Switch
            value={speakerIsolation.available && speakerIsolation.enabled}
            onValueChange={speakerIsolation.setEnabled}
            disabled={!speakerIsolation.available}
          />
        </View>
        {speakerIsolation.available ? null : (
          <Text style={styles.hint}>
            {speakerIsolation.supported
              ? 'Needs an ai-coustics license key. Set AIC_LICENSE_KEY in .env.'
              : 'Needs the AICoustics extension and an ai-coustics license key. ' +
                'See the example README.'}
          </Text>
        )}
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Mute microphone</Text>
          <Switch value={muted} onValueChange={setMuted} />
        </View>
      </View>

      <View style={[styles.section, styles.transcriptSection]}>
        <View style={styles.toggleRow}>
          <Text style={styles.sectionHeader}>Connection: {connectionStatus}</Text>
          <TouchableOpacity onPress={clearTranscript}>
            <Text style={styles.link}>Clear</Text>
          </TouchableOpacity>
        </View>
        <ScrollView ref={scrollRef}>
          {transcript.length === 0 ? (
            <Text style={styles.hint}>
              Talk over it, ask it to change the background color, or ask the time.
            </Text>
          ) : (
            transcript.map((entry) => (
              <Text key={entry.id} style={styles.transcript}>
                <Text style={styles.speaker}>
                  {entry.speaker === 'user' ? 'You: ' : 'Assistant: '}
                </Text>
                {entry.text}
              </Text>
            ))
          )}
        </ScrollView>
      </View>

      <TouchableOpacity
        style={[styles.talkButton, isRunning && styles.talkButtonActive]}
        onPress={isRunning ? stop : start}>
        <Text style={styles.buttonText}>
          {isRunning ? 'Stop talking' : 'Start talking'}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24, backgroundColor: colors.bg },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  talkButton: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  talkButtonActive: { backgroundColor: colors.danger },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13 },
  section: {
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
  },
  transcriptSection: { flex: 1 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.dim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  link: { fontSize: 13, color: colors.muted },
  hint: { fontSize: 13, color: colors.dim },
  transcript: { fontSize: 14, color: colors.body, marginBottom: 8 },
  speaker: { fontWeight: '600', color: colors.text },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: { fontSize: 14, color: colors.body },
});
