import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { Audio } from 'expo-av';
import { api } from '../lib/api';

export default function CaptureScreen() {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [busy, setBusy] = useState(false);

  async function startRec() {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) return Alert.alert('Mic permission denied');
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
    );
    setRecording(recording);
  }

  async function stopRec() {
    if (!recording) return;
    setBusy(true);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI()!;
    setRecording(null);
    try {
      const sign = await api<{ uploadUrl: string; storageKey: string }>('/api/upload/sign', {
        contentType: 'audio/m4a',
      });
      const blob = await (await fetch(uri)).blob();
      await fetch(sign.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'audio/m4a' },
        body: blob,
      });
      await api('/api/captures', {
        kind: 'voice',
        storageKey: sign.storageKey,
        source: 'mobile',
      });
      Alert.alert('Captured', 'Voice note uploaded.');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api('/api/captures', { kind: 'text', content: text, source: 'mobile' });
      setText('');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.root}>
      <Text style={s.h}>Brain dump</Text>
      <TextInput
        style={s.input}
        placeholder="What's on your mind?"
        placeholderTextColor="#6b6884"
        value={text}
        onChangeText={setText}
        multiline
      />
      <Pressable style={s.btn} onPress={send} disabled={busy}>
        <Text style={s.btnText}>{busy ? '...' : 'Capture'}</Text>
      </Pressable>

      <Pressable
        style={[s.btn, recording ? s.btnRec : s.btnSecondary]}
        onPress={recording ? stopRec : startRec}
        disabled={busy}
      >
        <Text style={s.btnText}>{recording ? 'Stop & upload' : 'Record voice'}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, padding: 20, backgroundColor: '#0c0a14', gap: 12 },
  h: { color: '#f5f3ff', fontSize: 24, fontWeight: '700' },
  input: {
    minHeight: 140,
    backgroundColor: '#181527',
    color: '#f5f3ff',
    borderRadius: 14,
    padding: 14,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  btn: {
    backgroundColor: '#7c3aed',
    padding: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: '#312e4a' },
  btnRec: { backgroundColor: '#dc2626' },
  btnText: { color: 'white', fontWeight: '700', fontSize: 16 },
});
