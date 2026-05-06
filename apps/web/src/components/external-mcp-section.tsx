/**
 * UI section for connecting external MCP-compatible second brains
 * (notai, mmo, custom). Listed alongside built-in integrations.
 */
'use client';
import { useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  connectExternalMcpAction,
  refreshExternalMcpAction,
  removeExternalMcpAction,
} from '@/app/actions/external-mcp';

export interface ExternalMcpView {
  id: string;
  label: string;
  url: string;
  toolPrefix: string;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  toolCount: number;
}

const PRESETS: Array<{ label: string; url: string; toolPrefix: string }> = [
  { label: 'notai', url: 'https://notai.app/mcp', toolPrefix: 'notai' },
  { label: 'mmo', url: 'https://mmo.app/mcp', toolPrefix: 'mmo' },
];

export function ExternalMcpSection({ items }: { items: ExternalMcpView[] }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <section className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">External second brains</h2>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            Plug another MCP-speaking system (notai, mmo, custom) into the Conductor. Tokens are
            sealed with the workspace key.
          </p>
        </div>
        <button
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Cancel' : '+ Connect'}
        </button>
      </header>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <ConnectForm onDone={() => setShowForm(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.length === 0 && !showForm && (
          <p className="col-span-full text-sm text-[var(--color-fg-muted)]">
            No external brains connected yet.
          </p>
        )}
        {items.map((it) => (
          <ServerCard key={it.id} item={it} />
        ))}
      </div>
    </section>
  );
}

function ServerCard({ item }: { item: ExternalMcpView }) {
  const [pending, start] = useTransition();
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{item.label}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--color-fg-muted)]">{item.url}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            item.status === 'active'
              ? 'bg-emerald-500/10 text-emerald-300'
              : item.status === 'error'
                ? 'bg-rose-500/10 text-rose-300'
                : 'bg-white/5 text-white/60'
          }`}
        >
          {item.status}
        </span>
      </div>
      <p className="mt-3 text-xs text-[var(--color-fg-muted)]">
        Prefix <code className="rounded bg-white/5 px-1">{item.toolPrefix}</code> · {item.toolCount}{' '}
        tools
      </p>
      {item.lastError && (
        <p className="mt-2 truncate rounded bg-rose-500/10 px-2 py-1 text-xs text-rose-300">
          {item.lastError}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          disabled={pending}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-50"
          onClick={() => {
            start(async () => {
              await refreshExternalMcpAction(item.id);
            });
          }}
        >
          Refresh tools
        </button>
        <button
          disabled={pending}
          className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
          onClick={() => {
            if (!confirm(`Remove ${item.label}?`)) return;
            start(async () => {
              await removeExternalMcpAction(item.id);
            });
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [toolPrefix, setToolPrefix] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function applyPreset(p: (typeof PRESETS)[number]) {
    setLabel(p.label);
    setUrl(p.url);
    setToolPrefix(p.toolPrefix);
  }

  function submit() {
    setError(null);
    start(async () => {
      const r = await connectExternalMcpAction({
        label: label.trim(),
        url: url.trim(),
        token: token.trim() || undefined,
        toolPrefix: toolPrefix.trim(),
      });
      if (r.ok) {
        onDone();
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Label" value={label} onChange={setLabel} placeholder="notai" />
        <Field
          label="Tool prefix"
          value={toolPrefix}
          onChange={setToolPrefix}
          placeholder="notai"
        />
        <Field
          label="MCP URL"
          value={url}
          onChange={setUrl}
          placeholder="https://notai.app/mcp"
          className="md:col-span-2"
        />
        <Field
          label="Bearer token (optional)"
          value={token}
          onChange={setToken}
          placeholder="xxxxxxxxxx"
          type="password"
          className="md:col-span-2"
        />
      </div>
      {error && (
        <p className="mt-3 rounded bg-rose-500/10 px-2 py-1 text-xs text-rose-300">{error}</p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          disabled={pending || !label || !url || !toolPrefix}
          onClick={submit}
          className="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
        >
          {pending ? 'Testing…' : 'Connect'}
        </button>
        <button
          onClick={onDone}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block text-xs ${className}`}>
      <span className="text-[var(--color-fg-muted)]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white placeholder:text-white/30"
      />
    </label>
  );
}
