/**
 * HomeDashboard (Jarvis v9) — the new Home: your day at a glance.
 *
 *   • Today analytics — active time + top apps (local timeline) and
 *     agent spend (server brief).
 *   • Recommendations — the deliberate planner's freshest insight plus
 *     readable suggestions, with action buttons that deep-link into the
 *     assistant chat.
 *   • Recent conversations — last 3 chat sessions; click reopens chat.
 *   • Streak & mood — the relationship at a glance.
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { isTauri } from '../../state/runtime';
import type { AuthState } from '../../state/auth';
import { ensureFreshAuth } from '../../state/auth';
import { getMood } from '../../assistant/mood';
import { loadSessions } from '../../assistant/chatSessions';
import { runSkill, splitChips } from '../../assistant/skills';
import { useT } from '../../state/locale';

interface TimelineEntry {
  app: string;
  title: string;
  startedTs: number;
  endedTs: number | null;
}

interface TodayStats {
  activeMinutes: number;
  topApps: Array<{ app: string; minutes: number }>;
}

async function computeToday(): Promise<TodayStats> {
  if (!isTauri()) return { activeMinutes: 0, topApps: [] };
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const entries = await invoke<TimelineEntry[]>('sense_timeline', {
    sinceTs: dayStart.getTime(),
    limit: 400,
  }).catch(() => [] as TimelineEntry[]);
  const byApp = new Map<string, number>();
  let total = 0;
  for (const e of entries) {
    const mins = Math.max(0, ((e.endedTs ?? Date.now()) - e.startedTs) / 60_000);
    total += mins;
    byApp.set(e.app, (byApp.get(e.app) ?? 0) + mins);
  }
  const topApps = [...byApp.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([app, minutes]) => ({ app, minutes: Math.round(minutes) }));
  return { activeMinutes: Math.round(total), topApps };
}

async function fetchSpend(auth: AuthState): Promise<string | null> {
  try {
    const fresh = (await ensureFreshAuth(auth)) ?? auth;
    const res = await fetch(`${fresh.apiBase.replace(/\/$/, '')}/api/sdk/v1/audit/summary`, {
      headers: { authorization: `Bearer ${fresh.accessToken}` },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { todayCostUsd?: number; dailyCapUsd?: number | null };
    if (typeof j.todayCostUsd !== 'number') return null;
    return j.dailyCapUsd
      ? `$${j.todayCostUsd.toFixed(2)} / $${j.dailyCapUsd.toFixed(2)}`
      : `$${j.todayCostUsd.toFixed(2)}`;
  } catch {
    return null;
  }
}

function fmtMins(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/** Open the assistant chat (optionally prefilled). */
function openAssistantChat(prefill?: string): void {
  void emit('metu://assistant-open-chat', { prefill }).catch(() => {});
}

export function HomeDashboard({ auth }: { auth: AuthState }) {
  const t = useT();
  const [stats, setStats] = useState<TodayStats>({ activeMinutes: 0, topApps: [] });
  const [spend, setSpend] = useState<string | null>(null);
  const [insight, setInsight] = useState<{ text: string; actions: string[] } | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const mood = getMood();
  const sessions = loadSessions()
    .filter((s) => s.messages.length > 0)
    .slice(0, 3);

  useEffect(() => {
    void computeToday().then(setStats);
    void fetchSpend(auth).then(setSpend);
    const timer = setInterval(() => void computeToday().then(setStats), 120_000);
    return () => clearInterval(timer);
  }, [auth]);

  const refreshInsight = () => {
    if (insightLoading) return;
    setInsightLoading(true);
    runSkill(auth, 'deliberate', 'metu', () => {})
      .then((full) => {
        const { text, chips } = splitChips(full);
        const clean = text.replace(/^INSIGHT:\s*/i, '').trim();
        setInsight(
          !clean || /^PASS\b/i.test(clean)
            ? { text: t('home.noSuggestions'), actions: [] }
            : { text: clean, actions: chips.slice(0, 3) },
        );
      })
      .catch(() => setInsight({ text: t('home.noSuggestions'), actions: [] }))
      .finally(() => setInsightLoading(false));
  };

  // Auto-fetch the insight once on mount.
  useEffect(() => {
    refreshInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="home-dash">
      {/* Today analytics */}
      <div className="glass-card home-dash__stats">
        <p className="settings-block__label">{t('home.today')}</p>
        <div className="home-dash__stat-row">
          <div className="home-dash__stat">
            <span className="home-dash__stat-value">{fmtMins(stats.activeMinutes)}</span>
            <span className="home-dash__stat-label">{t('home.activeTime')}</span>
          </div>
          {spend && (
            <div className="home-dash__stat">
              <span className="home-dash__stat-value">{spend}</span>
              <span className="home-dash__stat-label">{t('home.spend')}</span>
            </div>
          )}
          <div className="home-dash__stat">
            <span className="home-dash__stat-value">
              {mood.streakDays} <span className="home-dash__stat-unit">{t('home.days')}</span>
            </span>
            <span className="home-dash__stat-label">{t('home.streak')}</span>
          </div>
        </div>
        {stats.topApps.length > 0 && (
          <div className="home-dash__apps">
            {stats.topApps.map((a) => (
              <div key={a.app} className="home-dash__app">
                <span className="home-dash__app-name">{a.app}</span>
                <div className="home-dash__app-track">
                  <div
                    className="home-dash__app-fill"
                    style={{
                      width: `${Math.min(100, (a.minutes / Math.max(1, stats.topApps[0]?.minutes ?? 1)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="home-dash__app-mins">{fmtMins(a.minutes)}</span>
              </div>
            ))}
          </div>
        )}
        {/* Mood energy bar */}
        <div className="home-dash__mood">
          <span className="home-dash__stat-label">{t('home.energy')}</span>
          <div className="home-dash__app-track">
            <div
              className="home-dash__app-fill home-dash__app-fill--mood"
              style={{ width: `${mood.energy * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="glass-card home-dash__suggest">
        <div className="home-dash__suggest-head">
          <p className="settings-block__label">{t('home.suggestions')}</p>
          <button type="button" className="chip" onClick={refreshInsight} disabled={insightLoading}>
            {insightLoading ? '…' : t('home.refresh')}
          </button>
        </div>
        <p className="home-dash__insight">{insight?.text ?? '…'}</p>
        {insight && insight.actions.length > 0 && (
          <div className="home-dash__actions">
            {insight.actions.map((a) => (
              <button
                key={a}
                type="button"
                className="chip chip--on"
                onClick={() => openAssistantChat(a)}
              >
                ⚡ {a}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recent conversations */}
      <div className="glass-card home-dash__sessions">
        <p className="settings-block__label">{t('home.conversations')}</p>
        {sessions.length === 0 && <p className="muted">{t('home.noConversations')}</p>}
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            className="home-dash__session"
            onClick={() => openAssistantChat()}
          >
            <span className="home-dash__session-title">{s.title}</span>
            <span className="home-dash__session-time">
              {new Date(s.updatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
