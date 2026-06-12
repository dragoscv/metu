/**
 * Dynamic content blocks (Jarvis v8) — the card system for bubble + chat.
 *
 * The model emits fenced blocks with a `metu:` info string; RichMessage
 * routes them here instead of the code card:
 *
 *   ```metu:status        ```metu:tasks            ```metu:progress
 *   ok Build green        [ ] Fix taskbar layout   Deploying 0.72
 *   warn 2 tests skipped  [x] Ship chat sessions   ```
 *   ```                   ```
 *
 *   ```metu:kv            ```metu:actions          ```metu:quote
 *   Branch: main          Open the PR              Anything quoted
 *   Spend: $0.34/$2       run git status           renders as a callout
 *   ```                   ```                      ```
 *
 * Each block is a self-contained animated card. Actions route through the
 * same window event the quick-reply chips use, so every lane (skills,
 * terminal, vision, chat) is reachable from inside ANY reply.
 */
import { memo, type ReactElement } from 'react';

/** Fire an action string through the assistant's quickReply router. */
function fireAction(action: string): void {
  window.dispatchEvent(new CustomEvent('metu:bubble-action', { detail: action }));
}

// ── status: lines of "<level> <text>" → LED rows ──────────────────────────
const LEVEL_META: Record<string, { dot: string; cls: string }> = {
  ok: { dot: '●', cls: 'ok' },
  warn: { dot: '●', cls: 'warn' },
  error: { dot: '●', cls: 'error' },
  info: { dot: '●', cls: 'info' },
};

function StatusBlock({ body }: { body: string }) {
  const rows = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(ok|warn|error|info)\s+(.+)$/i.exec(l);
      return m ? { level: m[1]!.toLowerCase(), text: m[2]! } : { level: 'info', text: l };
    });
  return (
    <div className="blk blk--status">
      {rows.map((r, i) => (
        <div
          key={i}
          className={`blk__status-row blk__status-row--${LEVEL_META[r.level]?.cls ?? 'info'}`}
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <span className="blk__status-dot">{LEVEL_META[r.level]?.dot ?? '●'}</span>
          {r.text}
        </div>
      ))}
    </div>
  );
}

// ── tasks: GFM-style checkboxes → tappable checklist card ─────────────────
function TasksBlock({ body }: { body: string }) {
  const rows = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^\[([ xX])\]\s+(.+)$/.exec(l);
      return m ? { done: m[1] !== ' ', text: m[2]! } : null;
    })
    .filter((r): r is { done: boolean; text: string } => !!r);
  if (!rows.length) return null;
  const doneCount = rows.filter((r) => r.done).length;
  return (
    <div className="blk blk--tasks">
      <div className="blk__tasks-head">
        <span>Tasks</span>
        <span className="blk__tasks-count">
          {doneCount}/{rows.length}
        </span>
      </div>
      {rows.map((r, i) => (
        <div
          key={i}
          className={`blk__task ${r.done ? 'blk__task--done' : ''}`}
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <span className="blk__task-box">{r.done ? '✓' : ''}</span>
          <span className="blk__task-text">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

// ── progress: "<label> <0..1>" → animated bar ─────────────────────────────
function ProgressBlock({ body }: { body: string }) {
  const m = /^(.*?)\s+([01](?:\.\d+)?)\s*$/.exec(body.trim());
  const label = m?.[1]?.trim() || 'Progress';
  const v = Math.max(0, Math.min(1, Number(m?.[2] ?? 0)));
  return (
    <div className="blk blk--progress">
      <div className="blk__progress-head">
        <span>{label}</span>
        <span className="blk__progress-pct">{Math.round(v * 100)}%</span>
      </div>
      <div className="blk__progress-track">
        <div className="blk__progress-fill" style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  );
}

// ── kv: "Key: Value" rows → definition card ───────────────────────────────
function KvBlock({ body }: { body: string }) {
  const rows = body
    .split('\n')
    .map((l) => /^([^:]{1,40}):\s*(.+)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m);
  if (!rows.length) return null;
  return (
    <div className="blk blk--kv">
      {rows.map((m, i) => (
        <div key={i} className="blk__kv-row" style={{ animationDelay: `${i * 40}ms` }}>
          <span className="blk__kv-key">{m[1]}</span>
          <span className="blk__kv-val">{m[2]}</span>
        </div>
      ))}
    </div>
  );
}

// ── actions: each line = a tappable action button ─────────────────────────
function ActionsBlock({ body }: { body: string }) {
  const rows = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!rows.length) return null;
  return (
    <div className="blk blk--actions">
      {rows.map((a, i) => (
        <button
          key={i}
          type="button"
          className="blk__action"
          style={{ animationDelay: `${i * 40}ms` }}
          onClick={() => fireAction(a)}
        >
          <span className="blk__action-icon">⚡</span>
          {a}
        </button>
      ))}
    </div>
  );
}

// ── quote: callout card ────────────────────────────────────────────────────
function QuoteBlock({ body }: { body: string }) {
  return <div className="blk blk--quote">{body.trim()}</div>;
}

// ── registry + dispatcher ──────────────────────────────────────────────────
const BLOCKS: Record<string, (p: { body: string }) => ReactElement | null> = {
  status: StatusBlock,
  tasks: TasksBlock,
  progress: ProgressBlock,
  kv: KvBlock,
  actions: ActionsBlock,
  quote: QuoteBlock,
};

export const MetuBlock = memo(function MetuBlock({ type, body }: { type: string; body: string }) {
  const Cmp = BLOCKS[type];
  return Cmp ? <Cmp body={body} /> : null;
});

export function isMetuBlock(lang: string): boolean {
  return lang.startsWith('metu:') && lang.slice(5) in BLOCKS;
}
