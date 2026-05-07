/**
 * UI section for connecting external MCP-compatible second brains
 * (notai, mmo, custom). Listed alongside built-in integrations.
 */
'use client';
import { useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge, Button, Card, Input } from '@metu/ui';
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

function statusVariant(s: string): 'success' | 'danger' | 'neutral' {
  if (s === 'active') return 'success';
  if (s === 'error') return 'danger';
  return 'neutral';
}

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
        <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ Connect'}
        </Button>
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
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{item.label}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--color-fg-muted)]">{item.url}</p>
        </div>
        <Badge variant={statusVariant(item.status)} size="sm">
          {item.status}
        </Badge>
      </div>
      <p className="mt-3 text-xs text-[var(--color-fg-muted)]">
        Prefix{' '}
        <code className="rounded bg-[var(--color-bg-elevated)] px-1 font-mono">
          {item.toolPrefix}
        </code>{' '}
        · {item.toolCount} tools
      </p>
      {item.lastError && (
        <p className="mt-2 truncate rounded border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-2 py-1 text-xs text-[var(--color-danger)]">
          {item.lastError}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => start(async () => void (await refreshExternalMcpAction(item.id)))}
        >
          Refresh tools
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Remove ${item.label}?`)) return;
            start(async () => void (await removeExternalMcpAction(item.id)));
          }}
        >
          Remove
        </Button>
      </div>
    </Card>
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
      if (r.ok) onDone();
      else setError(r.error);
    });
  }

  return (
    <Card variant="outline">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button key={p.label} variant="subtle" size="sm" onClick={() => applyPreset(p)}>
            {p.label}
          </Button>
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
        <p className="mt-3 rounded border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-2 py-1 text-xs text-[var(--color-danger)]">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={pending || !label || !url || !toolPrefix} onClick={submit}>
          {pending ? 'Testing…' : 'Connect'}
        </Button>
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
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
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className="mt-1"
      />
    </label>
  );
}
