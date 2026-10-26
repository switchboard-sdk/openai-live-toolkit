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
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OpenAILiveToolkitProvider,
  useMedia,
  useOpenAILiveToolkit,
  useTool,
  type MediaPlayback,
} from '@synervoz/openai-live-toolkit';
import {
  AIC_LICENSE_KEY,
  SWITCHBOARD_API_URL,
  SWITCHBOARD_APP_ID,
  SWITCHBOARD_APP_SECRET,
} from '@env';
import { colors } from './colors';

const INSTRUCTIONS =
  'You are a terse, friendly voice assistant. Keep answers to one sentence.';
// Close the session after this much silence; speaking reopens it.
const IDLE_TIMEOUT_MS = 15_000;
// The last conversation, which Start continues after the app was killed, unless it's older than
// MAX_RESUME_AGE_MS.
const SAVED_CONVERSATION_KEY = 'savedConversation';
const MAX_RESUME_AGE_MS = 24 * 60 * 60 * 1000;

const MICROPHONES = [
  { value: 'bluetooth', label: 'Bluetooth' },
  { value: 'phone', label: 'Phone' },
] as const;

// Radio played alongside the conversation: an MP3 and an HE-AAC station.
const STATIONS = [
  { label: 'Off', url: null },
  { label: 'MP3', url: 'http://bigrradio.cdnstream1.com/5186_128' },
  {
    label: 'AAC+',
    url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/CFRBAMAAC.aac',
  },
] as const;

type SavedConversation = { sessionId: string; savedAt: number; settings: string };

function radioStatus(media: MediaPlayback): string {
  if (media.error) {
    return media.error.message;
  }
  if (media.state !== 'ready') {
    return `${media.state}…`;
  }
  const { stationName, title } = media.metadata ?? {};
  return [stationName, title].filter(Boolean).join(' — ') || 'Playing';
}

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      {/* Empty .env values fall back to the shared app on production. */}
      <OpenAILiveToolkitProvider
        appId={SWITCHBOARD_APP_ID || undefined}
        appSecret={SWITCHBOARD_APP_SECRET || undefined}
        apiUrl={SWITCHBOARD_API_URL}
        aiCousticsLicenseKey={AIC_LICENSE_KEY}
        instructions={INSTRUCTIONS}
        idleTimeoutMs={IDLE_TIMEOUT_MS}
        continueConversation
        webSearch
        // Keep music from other apps playing.
        mixWithOthers
        // A testing app: keep the conversation in the log, for Share logs.
        logFile
        logConversation>
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
    sessionId,
    newConversation,
    instructions,
    voice,
    speakerIsolation,
    bluetooth,
    muted,
    setMuted,
    shareLogs,
  } = useOpenAILiveToolkit();
  const media = useMedia();

  const [backgroundColor, setBackgroundColor] = useState(colors.bg);
  const scrollRef = useRef<ScrollView>(null);
  // A fork keeps the instructions and voice it started with, so a saved conversation is only
  // resumed while they're unchanged.
  const settings = JSON.stringify({ instructions, voice });
  // Saved by an earlier launch; the first start continues it.
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [transcript]);

  useEffect(() => {
    AsyncStorage.getItem(SAVED_CONVERSATION_KEY)
      .then((raw) => {
        const saved: SavedConversation | null = raw ? JSON.parse(raw) : null;
        if (
          !saved ||
          saved.settings !== settings ||
          Date.now() - saved.savedAt > MAX_RESUME_AGE_MS
        ) {
          return;
        }
        setSavedSessionId(saved.sessionId);
      })
      .catch((e) => console.warn(`Couldn't read the saved conversation: ${e}`));
    // Only at launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    const saved: SavedConversation = { sessionId, savedAt: Date.now(), settings };
    AsyncStorage.setItem(SAVED_CONVERSATION_KEY, JSON.stringify(saved)).catch((e) =>
      console.warn(`Couldn't save the conversation: ${e}`),
    );
  }, [sessionId, settings]);

  const startTalking = () => {
    setResumed(savedSessionId !== null);
    setSavedSessionId(null);
    start(savedSessionId ? { continueSessionId: savedSessionId } : undefined);
  };

  const startNewConversation = () => {
    newConversation();
    setSavedSessionId(null);
    setResumed(false);
    AsyncStorage.removeItem(SAVED_CONVERSATION_KEY).catch((e) =>
      console.warn(`Couldn't forget the saved conversation: ${e}`),
    );
  };

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
      <Text style={styles.title}>Switchboard Duplex Voice</Text>

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
              : Platform.OS === 'android'
                ? 'Not available on Android yet.'
                : 'Needs the AICoustics extension and an ai-coustics license key. ' +
                  'See the example README.'}
          </Text>
        )}
        {/* Also while Bluetooth is picked: a device without a microphone then drops out, and
            this is the way back. */}
        {bluetooth.connected || bluetooth.microphone !== 'phone' ? (
          <>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Microphone</Text>
              <View style={styles.segments}>
                {MICROPHONES.map(({ value, label }) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.segment, bluetooth.microphone === value && styles.segmentActive]}
                    onPress={() => bluetooth.setMicrophone(value)}>
                    <Text style={styles.segmentText}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={styles.hint}>
              {bluetooth.microphone === 'phone'
                ? 'Bluetooth plays in high quality; the model hears the phone.'
                : 'The model hears the Bluetooth microphone, in call quality.'}
            </Text>
          </>
        ) : null}
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Mute microphone</Text>
          <Switch value={muted} onValueChange={setMuted} />
        </View>
        {/* Media plays through the conversation's audio, so only while it runs. */}
        {isRunning ? (
          <>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Radio</Text>
              <View style={styles.segments}>
                {STATIONS.map(({ label, url }) => (
                  <TouchableOpacity
                    key={label}
                    style={[styles.segment, media.url === url && styles.segmentActive]}
                    onPress={() => (url ? media.play(url) : media.stop())}>
                    <Text style={styles.segmentText}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {media.url ? <Text style={styles.hint}>{radioStatus(media)}</Text> : null}
          </>
        ) : null}
      </View>

      <View style={[styles.section, styles.transcriptSection]}>
        <View style={styles.toggleRow}>
          <Text style={styles.sectionHeader}>Connection: {connectionStatus}</Text>
          <View style={styles.links}>
            <TouchableOpacity
              onPress={() =>
                shareLogs().catch((e) => console.warn(`Couldn't share the logs: ${e}`))
              }>
              <Text style={styles.link}>Share logs</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearTranscript}>
              <Text style={styles.link}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView ref={scrollRef}>
          {transcript.length === 0 ? (
            <Text style={styles.hint}>
              {savedSessionId
                ? 'Start continues your last conversation.'
                : resumed
                  ? 'Continuing your last conversation.'
                  : 'Talk over it, ask it to change the background color, ask the time, or ask about the weather.'}
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

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.talkButton, isRunning && styles.talkButtonActive]}
          onPress={isRunning ? stop : startTalking}>
          <Text style={styles.buttonText}>
            {isRunning ? 'Stop talking' : 'Start talking'}
          </Text>
        </TouchableOpacity>
        {savedSessionId || sessionId ? (
          <TouchableOpacity onPress={startNewConversation}>
            <Text style={[styles.link, styles.centered]}>New conversation</Text>
          </TouchableOpacity>
        ) : null}
      </View>
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
  controls: { gap: 12 },
  centered: { textAlign: 'center' },
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
  links: { flexDirection: 'row', gap: 16 },
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
  segments: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 2,
  },
  segment: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 13, color: colors.text },
});
