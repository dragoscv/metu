/**
 * In-app diagnostics panel (toggle with Ctrl+Shift+D).
 *
 * Streams the front-end debug ring live, and offers a "Copy diagnostics"
 * button that bundles the Rust snapshot (app/tauri/os versions + file-log tail)
 * with the JS ring so a user can paste a full report into a bug thread.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { buildDiagnostics, subscribe, type DebugLine, type LogLevel } from '../state/debug';

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: '#7c8598',
  info: '#7dd3fc',
  warn: '#fcd34d',
  error: '#fca5a5',
};

export function DebugPanel({
  context,
  onClose,
}: {
  context: Record<string, unknown>;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<DebugLine[]>([]);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribe(setLines), []);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const arr = f ? lines.filter((l) => `${l.scope} ${l.msg}`.toLowerCase().includes(f)) : lines;
    return arr.slice(-300).reverse();
  }, [lines, filter]);

  const copy = async () => {
    const blob = await buildDiagnostics(context);
    try {
      await navigator.clipboard.writeText(blob);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <motion.div
      className="sheet-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="sheet sheet--wide"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet__head">
          <h2 className="sheet__title">Diagnostics</h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy diagnostics'}
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <input
          className="field"
          placeholder="Filter logs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="logwall">
          {shown.length === 0 ? (
            <p className="muted">No log lines yet.</p>
          ) : (
            shown.map((l, i) => (
              <div className="logline" key={`${l.at}-${i}`}>
                <span className="logline__time">{new Date(l.at).toLocaleTimeString()}</span>
                <span className="logline__level" style={{ color: LEVEL_COLOR[l.level] }}>
                  {l.level}
                </span>
                <span className="logline__scope">{l.scope}</span>
                <span className="logline__msg">{l.msg}</span>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
