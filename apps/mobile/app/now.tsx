import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { api } from '../lib/api';

interface Focus {
  now?: { title: string; why: string };
  next?: { title: string }[];
  ignore?: { title: string }[];
  rationale?: string;
}

export default function NowScreen() {
  const [focus, setFocus] = useState<Focus | null>(null);
  useEffect(() => {
    api<Focus>('/api/focus/current')
      .then(setFocus)
      .catch(() => {});
  }, []);
  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={s.h}>What matters now</Text>
      {focus?.now ? (
        <View style={[s.card, s.brand]}>
          <Text style={s.label}>NOW</Text>
          <Text style={s.title}>{focus.now.title}</Text>
          <Text style={s.body}>{focus.now.why}</Text>
        </View>
      ) : (
        <Text style={s.muted}>No focus set yet. Capture something.</Text>
      )}
      {focus?.next?.length ? (
        <View style={s.card}>
          <Text style={s.label}>NEXT</Text>
          {focus.next.map((n, i) => (
            <Text key={i} style={s.body}>
              • {n.title}
            </Text>
          ))}
        </View>
      ) : null}
      {focus?.ignore?.length ? (
        <View style={s.card}>
          <Text style={s.label}>IGNORE THIS WEEK</Text>
          {focus.ignore.map((n, i) => (
            <Text key={i} style={s.muted}>
              • {n.title}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0a14' },
  h: { color: '#f5f3ff', fontSize: 24, fontWeight: '700' },
  card: { backgroundColor: '#181527', padding: 16, borderRadius: 14, gap: 6 },
  brand: { backgroundColor: '#3a235e' },
  label: { color: '#a78bfa', fontSize: 11, letterSpacing: 1.5, fontWeight: '700' },
  title: { color: '#f5f3ff', fontSize: 18, fontWeight: '700' },
  body: { color: '#d6d3e1', fontSize: 14 },
  muted: { color: '#6b6884' },
});
