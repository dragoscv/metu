/**
 * AwarenessStrip — surfaces other devices' recent activity in companion
 * (e.g. "VS Code: editor.heartbeat", "Mobile: voice.recording") so the
 * user knows what their other surfaces are doing right now.
 */
import { useAwareness } from '../state/awareness';

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function shortKind(kind: string): string {
  // 'device.vscode.git.state' → 'vscode · git.state'
  const stripped = kind.startsWith('device.') ? kind.slice('device.'.length) : kind;
  const idx = stripped.indexOf('.');
  if (idx < 0) return stripped;
  return `${stripped.slice(0, idx)} · ${stripped.slice(idx + 1)}`;
}

export function AwarenessStrip() {
  const entries = useAwareness();
  if (entries.length === 0) return null;
  const recentWindowMs = 30 * 60 * 1000;
  const recent = entries.filter((e) => Date.now() - e.occurredAt < recentWindowMs);
  const visible = recent.length > 0 ? recent : entries;
  const distinctDevices = new Set(visible.map((e) => e.sourceDeviceId)).size;
  const newest = visible[0]?.occurredAt;
  return (
    <div className="card">
      <p
        className="muted"
        style={{ margin: 0, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}
      >
        <span>
          Other devices · {distinctDevices} active
          {recent.length === 0 ? ' (stale)' : ''}
        </span>
        {newest ? <span style={{ opacity: 0.6 }}>last {relTime(newest)} ago</span> : null}
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
        {visible.slice(0, 6).map((e) => (
          <li
            key={`${e.kind}-${e.sourceDeviceId}-${e.occurredAt}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              padding: '3px 0',
              fontSize: 11,
              color: 'var(--fg-muted, inherit)',
            }}
          >
            <span
              style={{
                minWidth: 0,
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono, monospace)', opacity: 0.7 }}>
                {shortKind(e.kind)}
              </span>
              {e.title ? <span style={{ marginLeft: 6 }}>· {e.title}</span> : null}
            </span>
            <span style={{ opacity: 0.6 }}>{relTime(e.occurredAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
