/**
 * Notification center — most-recent server-pushed notifications for the
 * signed-in user. Pulls from `/api/sdk/v1/notifications` (bearer-auth,
 * `notify:read` scope). Tap → mark read + open `actionUrl` if present.
 *
 * Pull-to-refresh; no realtime subscription yet (M3 stays HTTP-polling).
 * Realtime via WS hub is a future M5.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api } from '../lib/api';

type Urgency = 'low' | 'normal' | 'high' | 'critical';

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  urgency: Urgency;
  source: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

const URGENCY_TINT: Record<Urgency, string> = {
  low: '#6b6884',
  normal: '#a78bfa',
  high: '#f59e0b',
  critical: '#ef4444',
};

function relative(iso: string): string {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86_400) return `${Math.round(d / 3600)}h`;
  return `${Math.round(d / 86_400)}d`;
}

export default function NotificationsScreen() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; notifications: NotificationRow[] }>(
        '/api/sdk/v1/notifications?limit=50',
      );
      setItems(res.notifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onTap = useCallback(async (n: NotificationRow) => {
    // Optimistic mark-read.
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
    );
    try {
      await api(`/api/sdk/v1/notifications/${n.id}/read`, {});
    } catch {
      // Best-effort; if the server rejects we'll re-sync on next load.
    }
    if (n.actionUrl) {
      await Linking.openURL(n.actionUrl);
    }
  }, []);

  return (
    <View style={s.root}>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} tintColor="#a78bfa" />
        }
        ListEmptyComponent={
          refreshing ? null : (
            <Text style={s.empty}>No notifications yet. They&apos;ll show up here.</Text>
          )
        }
        renderItem={({ item }) => {
          const unread = !item.readAt;
          return (
            <Pressable style={[s.row, unread ? s.rowUnread : null]} onPress={() => onTap(item)}>
              <View style={[s.dot, { backgroundColor: URGENCY_TINT[item.urgency] }]} />
              <View style={s.body}>
                <View style={s.head}>
                  <Text style={[s.title, unread ? s.titleUnread : null]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={s.meta}>{relative(item.createdAt)}</Text>
                </View>
                {item.body ? (
                  <Text style={s.bodyText} numberOfLines={2}>
                    {item.body}
                  </Text>
                ) : null}
                <Text style={s.source}>
                  {item.source}
                  {item.actionUrl ? ' · tap to open' : ''}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0c0a14' },
  error: { color: '#ef4444', padding: 12, fontSize: 12 },
  empty: { color: '#6b6884', padding: 24, textAlign: 'center', fontSize: 14 },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#181527',
  },
  rowUnread: { backgroundColor: '#13101e' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  body: { flex: 1, gap: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { color: '#cfc7e6', fontSize: 15, flex: 1, marginRight: 8 },
  titleUnread: { color: '#f5f3ff', fontWeight: '700' },
  meta: { color: '#6b6884', fontSize: 11 },
  bodyText: { color: '#a39cb8', fontSize: 13 },
  source: { color: '#6b6884', fontSize: 11, letterSpacing: 0.5 },
});
