import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { api } from '../lib/api';

// Module-scope so the live preview function (used in render) can reuse the
// exact same regex as the on-send extractor without rebuilding state.
function extractHashtagsLive(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of input.matchAll(/#([a-z0-9_-]{1,40})/gi)) {
    const t = m[1]!.toLowerCase();
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

export default function CaptureScreen() {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastCaptureAt, setLastCaptureAt] = useState<number | null>(null);

  // Share-sheet intake — when the OS launches the app from a "Share to metu"
  // intent, expo-linking exposes the URL via getInitialURL / addEventListener.
  // We accept these query params (in priority order):
  //   ?text=...  → seeded into the text field
  //   ?url=...   → captured immediately as kind:'link', then seeded too
  //   ?title=... → prepended to text
  // The user can always edit before tapping Capture.
  useEffect(() => {
    function handle(url: string | null) {
      if (!url) return;
      const parsed = Linking.parse(url);
      const q = parsed.queryParams ?? {};
      const t = typeof q.text === 'string' ? q.text : '';
      const u = typeof q.url === 'string' ? q.url : '';
      const title = typeof q.title === 'string' ? q.title : '';
      const image = typeof q.image === 'string' ? q.image : '';
      const seed = [title, t, u].filter(Boolean).join('\n').trim();
      if (seed) setText((prev) => (prev ? `${prev}\n\n${seed}` : seed));
      // Fire-and-forget capture for shared URLs so the link lands in
      // metu even if the user immediately backgrounds the app.
      if (u) {
        api('/api/sdk/v1/capture', {
          kind: 'link',
          content: u,
          source: 'mobile.share',
          metadata: { title: title || undefined, text: t || undefined },
        }).catch(() => {
          /* user can still hit Capture manually */
        });
      }
      // Image share — accept either an explicit ?image=https://... param
      // or a ?url=... whose path ends in a recognisable image extension.
      // We capture as kind:'image' with sourceUrl in metadata so the
      // server can dereference + thumbnail asynchronously.
      const IMG_RE = /\.(png|jpe?g|gif|webp|heic|heif)(\?|$)/i;
      const sharedImage = image || (u && IMG_RE.test(u) ? u : '');
      if (sharedImage) {
        api('/api/sdk/v1/capture', {
          kind: 'image',
          source: 'mobile.share',
          metadata: { sourceUrl: sharedImage, title: title || undefined },
        }).catch(() => {
          /* user can still re-attach manually */
        });
      }
    }
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);

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
      setLastCaptureAt(Date.now());
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
      const tags = extractHashtags(text);
      await api('/api/captures', {
        kind: 'text',
        content: text,
        source: 'mobile',
        ...(tags.length ? { metadata: { tags } } : {}),
      });
      setText('');
      setLastCaptureAt(Date.now());
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // Pull #tags out of free-form text. Lowercased, deduped, capped at 10.
  function extractHashtags(input: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of input.matchAll(/#([a-z0-9_-]{1,40})/gi)) {
      const t = m[1]!.toLowerCase();
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 10) break;
    }
    return out;
  }

  async function attachPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Photo permission denied');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: false,
      exif: false,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0]!;
    setBusy(true);
    try {
      const sign = await api<{ uploadUrl: string; storageKey: string }>('/api/upload/sign', {
        contentType: asset.mimeType ?? 'image/jpeg',
      });
      const blob = await (await fetch(asset.uri)).blob();
      await fetch(sign.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': asset.mimeType ?? 'image/jpeg' },
        body: blob,
      });
      await api('/api/captures', {
        kind: 'image',
        storageKey: sign.storageKey,
        source: 'mobile',
        ...(text.trim() ? { content: text.trim() } : {}),
        metadata: {
          width: asset.width,
          height: asset.height,
          ...(extractHashtagsLive(text).length > 0 ? { tags: extractHashtagsLive(text) } : {}),
        },
      });
      setText('');
      Alert.alert('Captured', 'Photo uploaded.');
      setLastCaptureAt(Date.now());
    } catch (e: any) {
      Alert.alert('Error', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const liveTags = extractHashtagsLive(text);

  return (
    <View style={s.root}>
      <Text style={s.h}>Brain dump</Text>
      <TextInput
        style={s.input}
        placeholder="What's on your mind?  #tag"
        placeholderTextColor="#6b6884"
        value={text}
        onChangeText={setText}
        multiline
      />
      {liveTags.length > 0 ? (
        <View style={s.tagRow}>
          {liveTags.map((t) => (
            <Text key={t} style={s.tag}>
              #{t}
            </Text>
          ))}
        </View>
      ) : null}
      <Pressable style={s.btn} onPress={send} disabled={busy}>
        <Text style={s.btnText}>{busy ? '...' : 'Capture'}</Text>
      </Pressable>

      {text.length > 0 ? (
        <Pressable style={[s.btn, s.btnSecondary]} onPress={() => setText('')} disabled={busy}>
          <Text style={s.btnText}>Clear</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={[s.btn, recording ? s.btnRec : s.btnSecondary]}
        onPress={recording ? stopRec : startRec}
        disabled={busy}
      >
        <Text style={s.btnText}>{recording ? 'Stop & upload' : 'Record voice'}</Text>
      </Pressable>

      <Pressable style={[s.btn, s.btnSecondary]} onPress={attachPhoto} disabled={busy}>
        <Text style={s.btnText}>Attach photo</Text>
      </Pressable>

      <Pressable
        onPress={() =>
          Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL ?? 'https://app.metu.ro'}/timeline`)
        }
        style={s.linkRow}
      >
        <Text style={s.linkText}>Open metu on web →</Text>
      </Pressable>
      {lastCaptureAt && (
        <Text style={s.lastCapture}>Last captured {formatRelativeMobile(lastCaptureAt)}</Text>
      )}
    </View>
  );
}

function formatRelativeMobile(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
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
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    color: '#c4b5fd',
    backgroundColor: '#1e1b3a',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
  },
  linkRow: { alignItems: 'center', paddingTop: 8 },
  linkText: { color: '#a78bfa', fontSize: 13, fontWeight: '600' },
  lastCapture: { color: '#6b6884', fontSize: 11, textAlign: 'center', paddingTop: 4 },
});
