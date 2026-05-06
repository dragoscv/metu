import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { api } from '../lib/api';

interface Project {
  id: string;
  name: string;
  momentumScore: number;
}

export default function ProjectsScreen() {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    api<Project[]>('/api/projects')
      .then(setProjects)
      .catch(() => {});
  }, []);
  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={s.h}>Projects</Text>
      {projects.map((p) => (
        <View key={p.id} style={s.card}>
          <Text style={s.title}>{p.name}</Text>
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${Math.round((p.momentumScore ?? 0) * 100)}%` }]} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0a14' },
  h: { color: '#f5f3ff', fontSize: 24, fontWeight: '700' },
  card: { backgroundColor: '#181527', padding: 16, borderRadius: 14, gap: 8 },
  title: { color: '#f5f3ff', fontSize: 16, fontWeight: '600' },
  barTrack: { height: 6, backgroundColor: '#312e4a', borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: '#a78bfa' },
});
