/**
 * OpenAILiveToolkit example — a full-duplex GPT-Live voice assistant.
 *
 * All orchestration lives in the library. This app wraps itself in
 * <OpenAILiveToolkitProvider> with credentials, and the screens drive it with
 * useOpenAILiveToolkit(). Basics has the core: tools and the microphone. Radio is an example of
 * media. Both share one conversation.
 *
 * @format
 */

import React, { useState } from 'react';
import { StatusBar, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { OpenAILiveToolkitProvider } from '@synervoz/openai-live-toolkit';
import {
  SWITCHBOARD_API_URL,
  SWITCHBOARD_APP_ID,
  SWITCHBOARD_APP_SECRET,
} from '@env';
import { BasicsScreen } from './BasicsScreen';
import { colors } from './colors';
import { Conversation } from './Conversation';
import { RadioScreen } from './RadioScreen';
import { Segments } from './ui';

const INSTRUCTIONS =
  'You are a terse, friendly voice assistant. Keep answers to one sentence.';
// Pause the model after this much silence, at a lower rate; speaking resumes it in about half a
// second. Above the slowest tool, web search.
const STANDBY_TIMEOUT_MS = 15_000;
// Close the session after this much silence; speaking reopens it.
const IDLE_TIMEOUT_MS = 60_000;

const SCREENS = [
  { value: 'basics', label: 'Basics' },
  { value: 'radio', label: 'Radio' },
] as const;

type ScreenName = (typeof SCREENS)[number]['value'];

const HINTS: Record<ScreenName, string> = {
  basics:
    'Talk over it, ask it the time, ask it to change the background color, or ask about the weather.',
  radio: "Ask it to play some rock, what's playing, to turn it down, or to play something else.",
};

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      {/* Empty .env values fall back to the shared app on production. */}
      <OpenAILiveToolkitProvider
        appId={SWITCHBOARD_APP_ID || undefined}
        appSecret={SWITCHBOARD_APP_SECRET || undefined}
        apiUrl={SWITCHBOARD_API_URL}
        instructions={INSTRUCTIONS}
        standbyTimeoutMs={STANDBY_TIMEOUT_MS}
        idleTimeoutMs={IDLE_TIMEOUT_MS}
        continueConversation
        webSearch
        // Keep music from other apps playing.
        mixWithOthers
        // For Radio: media, on the lock screen and in Control Center on iOS.
        media={{ nowPlayingControls: true }}
        // Say so when the connection is lost, and when it's back, with the radio lowered meanwhile.
        offlineNotice
        // A testing app: keep the conversation in the log, with the last minute of audio, for
        // Share logs.
        logFile
        logConversation
        diagnosticAudioSeconds={60}>
        <Main />
      </OpenAILiveToolkitProvider>
    </SafeAreaProvider>
  );
}

function Main(): React.JSX.Element {
  const [screen, setScreen] = useState<ScreenName>('basics');
  // Basics' set_background_color tool changes it.
  const [backgroundColor, setBackgroundColor] = useState(colors.bg);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor }]}>
      <StatusBar barStyle="light-content" backgroundColor={backgroundColor} />
      <Text style={styles.title}>Switchboard Duplex Voice</Text>
      <Segments fill options={SCREENS} value={screen} onChange={setScreen} />
      {screen === 'basics' ? (
        <BasicsScreen onBackgroundColor={setBackgroundColor} />
      ) : (
        <RadioScreen />
      )}
      <Conversation hint={HINTS[screen]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24, backgroundColor: colors.bg },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
});
