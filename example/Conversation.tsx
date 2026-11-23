/**
 * The conversation both screens share: the live transcript, Start and Stop, and continuing the last
 * conversation after the app was killed.
 *
 * @format
 */

import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOpenAILiveToolkit } from '@synervoz/openai-live-toolkit';
import { colors } from './colors';
import { styles as ui } from './ui';

// The last conversation, which Start continues after the app was killed, unless it's older than
// MAX_RESUME_AGE_MS.
const SAVED_CONVERSATION_KEY = 'savedConversation';
const MAX_RESUME_AGE_MS = 24 * 60 * 60 * 1000;

type SavedConversation = { sessionId: string; savedAt: number; settings: string };

/** `hint` shows while the transcript is empty. */
export function Conversation({ hint }: { hint: string }): React.JSX.Element {
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
    shareLogs,
  } = useOpenAILiveToolkit();

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

  return (
    <>
      {error ? <Text style={styles.error}>{error.message}</Text> : null}

      <View style={[ui.section, styles.transcriptSection]}>
        <View style={ui.row}>
          <Text style={ui.sectionHeader}>Connection: {connectionStatus}</Text>
          <View style={ui.links}>
            <TouchableOpacity
              onPress={() =>
                shareLogs().catch((e) => console.warn(`Couldn't share the logs: ${e}`))
              }>
              <Text style={ui.link}>Share logs</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearTranscript}>
              <Text style={ui.link}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView ref={scrollRef}>
          {transcript.length === 0 ? (
            <Text style={ui.hint}>
              {savedSessionId
                ? 'Start continues your last conversation.'
                : resumed
                  ? 'Continuing your last conversation.'
                  : hint}
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
          <Text style={styles.buttonText}>{isRunning ? 'Stop talking' : 'Start talking'}</Text>
        </TouchableOpacity>
        {savedSessionId || sessionId ? (
          <TouchableOpacity onPress={startNewConversation}>
            <Text style={[ui.link, styles.centered]}>New conversation</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 13 },
  transcriptSection: { flex: 1 },
  transcript: { fontSize: 14, color: colors.body, marginBottom: 8 },
  speaker: { fontWeight: '600', color: colors.text },
  controls: { gap: 12 },
  centered: { textAlign: 'center' },
  talkButton: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  talkButtonActive: { backgroundColor: colors.danger },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
