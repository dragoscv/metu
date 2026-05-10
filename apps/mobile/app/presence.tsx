/**
 * Mobile Presence screen — push-to-talk against a chosen persona over
 * the bearer SDK (slice 9). Wake-word listening (slice 9b) is wired as a
 * UI-only toggle until `onnxruntime-react-native` is integrated.
 *
 * Talk loop (single button):
 *   tap-and-hold → record → release → transcribe → stream LLM response
 *   into transcript view → fetch TTS → play with expo-av.
 */
import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Switch } from 'react-native';
import { Audio } from 'expo-av';
import { fetchTtsBlob, companionTurn, uploadAudio, type ChatTurn } from '../lib/presence';
import { useWakeWord } from '../lib/wake-word';
import { pickMobilePersonas, usePersonas } from '../lib/use-personas';

// Companion-Agent slice 6 — mirrors the desktop filter: any persona
// whose voice provider is not 'none'. The pipeline broker handles
// `openai-realtime` by transparently downgrading to STT→text→TTS, so
// realtime personas (Metu, Atlas, Iris) work on mobile too. The
// catalogue is fetched at runtime via usePersonas() so workspace-
// defined personas show up too — falls back to BUILT_IN_PERSONAS.

const LANG_FLAG: Record<string, string> = {
  en: '🇬🇧',
  ro: '🇷🇴',
  fr: '🇫🇷',
  de: '🇩🇪',
  es: '🇪🇸',
};

function flag(lang: string): string {
  return LANG_FLAG[lang.slice(0, 2).toLowerCase()] ?? '';
}

type Status = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';

export default function PresenceScreen() {
  const { personas: allPersonas, billingTier, voiceCap, quietActive } = usePersonas();
  const voicePersonas = pickMobilePersonas(allPersonas);
  const [persona, setPersona] = useState(voicePersonas[0]?.slug ?? 'iris');
  const [status, setStatus] = useState<Status>('idle');
  const [partial, setPartial] = useState('');
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wakeWord, setWakeWord] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Wake-word listener (slice 9b). When the model fires, we flip into
  // listening as if the user had pressed the talk button — the existing
  // talk loop is already record → transcribe → stream → speak.
  const wake = useWakeWord(() => {
    void startRecording();
  });

  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync();
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  async function startRecording() {
    setError(null);
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      setError('Mic permission denied');
      return;
    }
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
    );
    recordingRef.current = recording;
    setStatus('listening');
  }

  async function finishTurn() {
    const rec = recordingRef.current;
    if (!rec) return;
    try {
      setStatus('transcribing');
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recordingRef.current = null;
      if (!uri) throw new Error('no_recording_uri');

      const personaObj = voicePersonas.find((p) => p.slug === persona);
      const language = personaObj?.language ?? 'en';
      const { text: transcript } = await uploadAudio(uri, 'audio/m4a', language);
      if (!transcript) {
        setStatus('idle');
        return;
      }
      const turn: ChatTurn = { role: 'user', content: transcript };
      const liveHistory = [...history, turn];
      setHistory(liveHistory);

      setStatus('thinking');
      setPartial('');
      const turnRes = await companionTurn(persona, transcript, history, {
        surface: 'mobile',
      });
      const reply = turnRes.kind === 'local' ? turnRes.text : turnRes.ack;
      if (turnRes.kind === 'escalated') {
        // Conductor will follow up via push later; surface a small badge.
        setError(`escalated to Conductor (${turnRes.triage.reason})`);
      }
      setPartial(reply);
      setHistory([...liveHistory, { role: 'assistant', content: reply }]);

      // TTS playback. Persona may be configured for an unsupported provider
      // (e.g. openai-realtime) — surface that as a soft error and keep the
      // transcript visible.
      setStatus('speaking');
      try {
        const blob = await fetchTtsBlob(persona, reply, language);
        await playBlob(blob);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      setStatus('idle');
      setPartial('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  async function playBlob(blob: Blob) {
    // Convert to a data URI — expo-av's createAsync accepts that on RN.
    const dataUri = await blobToDataUri(blob);
    await soundRef.current?.unloadAsync();
    const { sound } = await Audio.Sound.createAsync({ uri: dataUri }, { shouldPlay: true });
    soundRef.current = sound;
    await new Promise<void>((resolve) => {
      sound.setOnPlaybackStatusUpdate((s) => {
        if (s.isLoaded && s.didJustFinish) resolve();
      });
    });
  }

  return (
    <View style={s.root}>
      <View style={s.head}>
        <Text style={s.h}>Presence</Text>
        <View style={[s.dot, s[`dot_${status}`]]} />
      </View>

      <View style={s.tierRow}>
        <View style={s.tierBadge}>
          <Text style={s.tierBadgeText}>{billingTier.toUpperCase()}</Text>
        </View>
        {quietActive ? (
          <View style={[s.tierBadge, { backgroundColor: '#1e293b' }]}>
            <Text style={[s.tierBadgeText, { color: '#93c5fd' }]}>QUIET HOURS</Text>
          </View>
        ) : null}
        {voiceCap ? (
          voiceCap.unlimited ? (
            <Text style={s.muted}>Voice: unlimited</Text>
          ) : voiceCap.capUsd > 0 ? (
            <View style={{ flex: 1 }}>
              <Text style={s.muted}>
                Voice {voiceCap.spentUsd.toFixed(2)} / {voiceCap.capUsd.toFixed(2)} USD
                {voiceCap.hard ? ' · CAP REACHED' : voiceCap.soft ? ' · 80%' : ''}
              </Text>
              <View style={s.meterTrack}>
                <View
                  style={[
                    s.meterFill,
                    {
                      width: `${Math.min(
                        100,
                        Math.round((voiceCap.spentUsd / voiceCap.capUsd) * 100),
                      )}%`,
                      backgroundColor: voiceCap.hard
                        ? '#ef4444'
                        : voiceCap.soft
                          ? '#f59e0b'
                          : '#22c55e',
                    },
                  ]}
                />
              </View>
            </View>
          ) : (
            <Text style={s.muted}>No voice cap configured</Text>
          )
        ) : null}
      </View>
      <View style={s.row}>
        <Text style={s.label}>PERSONA</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
          {voicePersonas.map((p) => (
            <Pressable
              key={p.slug}
              onPress={() => setPersona(p.slug)}
              style={[s.chip, persona === p.slug && s.chipActive]}
            >
              <Text style={[s.chipText, persona === p.slug && s.chipTextActive]}>
                {flag(p.language)} {p.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView style={s.transcriptWrap} contentContainerStyle={{ padding: 14, gap: 10 }}>
        {history.map((t, i) => (
          <View key={i} style={t.role === 'user' ? s.bubbleUser : s.bubbleBot}>
            <Text style={s.bubbleText}>{t.content}</Text>
          </View>
        ))}
        {partial ? (
          <View style={s.bubbleBot}>
            <Text style={s.bubbleText}>{partial}</Text>
          </View>
        ) : null}
      </ScrollView>

      <Pressable
        onPressIn={() => {
          if (status === 'idle' || status === 'error') {
            void startRecording();
          }
        }}
        onPressOut={() => {
          if (status === 'listening') void finishTurn();
        }}
        style={[s.talk, status === 'listening' && s.talkRec]}
      >
        <Text style={s.talkText}>
          {status === 'listening' ? 'Release' : status === 'idle' ? 'Hold to talk' : status}
        </Text>
      </Pressable>

      <View style={s.wake}>
        <View style={{ flex: 1 }}>
          <Text style={s.wakeTitle}>Always-on wake word</Text>
          <Text style={s.muted}>
            {wake.available
              ? wake.listening
                ? 'Listening for the wake phrase…'
                : 'On-device openWakeWord (ONNX) ready'
              : 'On-device openWakeWord (ONNX) · install onnxruntime-react-native + set EXPO_PUBLIC_WAKEWORD_MODEL_URL'}
          </Text>
        </View>
        <Switch
          value={wakeWord && wake.available}
          disabled={!wake.available}
          onValueChange={(v) => {
            setWakeWord(v);
            if (v) {
              void wake.start();
            } else {
              wake.stop();
            }
          }}
        />
      </View>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

async function blobToDataUri(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0a14', padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  h: { color: '#f5f3ff', fontSize: 24, fontWeight: '700', flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#4b5563' },
  dot_idle: { backgroundColor: '#4b5563' },
  dot_listening: { backgroundColor: '#60a5fa' },
  dot_transcribing: { backgroundColor: '#facc15' },
  dot_thinking: { backgroundColor: '#a78bfa' },
  dot_speaking: { backgroundColor: '#c084fc' },
  dot_error: { backgroundColor: '#f87171' },
  row: { gap: 8 },
  label: { color: '#a78bfa', fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#3a235e',
  },
  tierBadgeText: { color: '#e9d5ff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  meterTrack: {
    height: 4,
    backgroundColor: '#181527',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4,
  },
  meterFill: { height: 4, borderRadius: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#181527',
    marginRight: 6,
  },
  chipActive: { backgroundColor: '#7c3aed' },
  chipText: { color: '#d6d3e1', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: 'white' },
  transcriptWrap: { flex: 1, backgroundColor: '#13101e', borderRadius: 14 },
  bubbleUser: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: '#3a235e',
    padding: 10,
    borderRadius: 12,
  },
  bubbleBot: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: '#1f1b2e',
    padding: 10,
    borderRadius: 12,
  },
  bubbleText: { color: '#f5f3ff', fontSize: 14, lineHeight: 20 },
  talk: {
    backgroundColor: '#7c3aed',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  talkRec: { backgroundColor: '#dc2626' },
  talkText: { color: 'white', fontSize: 16, fontWeight: '700' },
  wake: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#181527',
    padding: 12,
    borderRadius: 12,
  },
  wakeTitle: { color: '#f5f3ff', fontSize: 14, fontWeight: '600' },
  muted: { color: '#6b6884', fontSize: 11 },
  errorBox: {
    backgroundColor: 'rgba(244,63,94,0.12)',
    borderColor: 'rgba(244,63,94,0.4)',
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
  },
  errorText: { color: '#fca5a5', fontSize: 13 },
});
