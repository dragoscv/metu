/**
 * Resume — mobile mirror of /resume on the web.
 *
 * Calls /api/sdk/v1/resume (recall:read scope) and renders the latest
 * "where I left off" briefing per project + smallest next step. No window
 * picker yet; uses the server-side auto-detection.
 */
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { api } from '../lib/api';

interface ResumeBriefing {
  id: string;
  projectId: string;
  projectName: string;
  momentumScore: number | null;
  generatedAt: string;
  nextStep: string;
}
interface ResumeResponse {
  ok: boolean;
  since: '3d' | '3w' | '3m';
  windowDays: number;
  timelineEventCount: number;
  briefings: ResumeBriefing[];
}

const WINDOW_LABEL: Record<ResumeResponse['since'], string> = {
  '3d': 'last 3 days',
  '3w': 'last 3 weeks',
  '3m': 'last 3 months',
};

export default function ResumeScreen() {
  const [data, setData] = useState<ResumeResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setRefreshing(true);
    try {
      const res = await api<ResumeResponse>('/api/sdk/v1/resume');
      setData(res);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#a78bfa" />
      }
    >
      <Text style={s.h}>Resume</Text>
      {data && (
        <Text style={s.sub}>
          {WINDOW_LABEL[data.since]} · {data.timelineEventCount} events
        </Text>
      )}
      {error && <Text style={s.err}>{error}</Text>}
      {data?.briefings.length === 0 && (
        <Text style={s.empty}>No briefings yet — open a project on web to generate one.</Text>
      )}
      {data?.briefings.map((b) => (
        <View key={b.id} style={s.card}>
          <View style={s.row}>
            <Text style={s.title}>{b.projectName}</Text>
            {b.momentumScore != null && (
              <Text style={s.score}>{Math.round(b.momentumScore * 100)}</Text>
            )}
          </View>
          <Text style={s.next}>{b.nextStep}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0a14' },
  h: { color: '#f5f3ff', fontSize: 24, fontWeight: '700' },
  sub: { color: '#9b96b8', fontSize: 13 },
  err: { color: '#fda4af', fontSize: 13 },
  empty: { color: '#9b96b8', fontSize: 14, fontStyle: 'italic' },
  card: { backgroundColor: '#181527', padding: 16, borderRadius: 14, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#f5f3ff', fontSize: 16, fontWeight: '600' },
  score: { color: '#a78bfa', fontSize: 12, fontVariant: ['tabular-nums'] },
  next: { color: '#d6d2eb', fontSize: 14, lineHeight: 20 },
});
