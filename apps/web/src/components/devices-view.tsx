'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Bell,
  Camera,
  Chrome,
  Code2,
  Globe,
  Lock,
  Monitor,
  PowerOff,
  Radio,
  Smartphone,
  Terminal,
  Volume2,
  Wand2,
  Workflow,
} from 'lucide-react';
import { Card, CardTitle, StatusDot, cn } from '@metu/ui';
import { toast } from 'sonner';
import {
  renameDeviceAction,
  sendDeviceCommandAction,
  unpairDeviceAction,
} from '@/app/actions/devices';

export interface DeviceRow {
  id: string;
  name: string;
  kind: string;
  platform: string;
  version: string | null;
  presence: 'online' | 'idle' | 'offline';
  capabilities: string[];
  activity: Record<string, unknown>;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface DeviceEventRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

const PRESENCE: Record<
  DeviceRow['presence'],
  { state: 'success' | 'warning' | 'offline'; label: string }
> = {
  online: { state: 'success', label: 'Online' },
  idle: { state: 'warning', label: 'Idle' },
  offline: { state: 'offline', label: 'Offline' },
};

const COMMANDS: {
  id: 'wake' | 'lock' | 'capture' | 'speak' | 'open_url' | 'ping';
  label: string;
  Icon: typeof Bell;
}[] = [
  { id: 'ping', label: 'Ping', Icon: Radio },
  { id: 'wake', label: 'Wake', Icon: Bell },
  { id: 'capture', label: 'Capture', Icon: Camera },
  { id: 'speak', label: 'Speak', Icon: Volume2 },
  { id: 'lock', label: 'Lock', Icon: Lock },
];

// Friendly labels + icons for every device kind in `device_kind` enum.
// Falls back to raw kind text for anything unknown.
const KIND_META: Record<string, { label: string; Icon: typeof Bell }> = {
  companion_desktop: { label: 'Companion · desktop', Icon: Monitor },
  vscode_ext: { label: 'VS Code extension', Icon: Code2 },
  browser_ext: { label: 'Browser extension', Icon: Chrome },
  mobile: { label: 'Mobile', Icon: Smartphone },
  web: { label: 'Web session', Icon: Globe },
  mcp_client: { label: 'MCP client', Icon: Workflow },
  external_app: { label: 'External app', Icon: Workflow },
  cli: { label: 'CLI', Icon: Terminal },
};

// Which commands each kind can meaningfully execute. Anything not listed
// hides the entire "Send command" card to avoid promising actions the
// device wouldn't honor.
const KIND_COMMANDS: Record<string, ReadonlyArray<(typeof COMMANDS)[number]['id']>> = {
  companion_desktop: ['ping', 'wake', 'capture', 'speak', 'lock'],
  mobile: ['ping', 'wake', 'capture', 'speak', 'lock'],
  vscode_ext: ['ping'],
  browser_ext: ['ping'],
  web: ['ping'],
  mcp_client: ['ping'],
  external_app: ['ping'],
  cli: ['ping'],
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { label: kind, Icon: Wand2 };
}

function commandsForKind(kind: string) {
  const allowed = new Set(KIND_COMMANDS[kind] ?? ['ping']);
  return COMMANDS.filter((c) => allowed.has(c.id));
}

export function DevicesView({
  devices,
  selectedId,
  events,
}: {
  devices: DeviceRow[];
  selectedId: string | null;
  events: DeviceEventRow[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  if (devices.length === 0) {
    return (
      <Card>
        <div className="py-8 text-center text-sm text-[var(--color-fg-muted)]">
          No devices yet. Install the companion app or pair this browser to start.{' '}
          <Link href="/devices/verify" className="text-[var(--color-brand)] hover:underline">
            Pair a device
          </Link>
          .
        </div>
      </Card>
    );
  }

  const selected = devices.find((d) => d.id === selectedId) ?? devices[0]!;

  function selectDevice(id: string) {
    const next = new URLSearchParams(sp);
    next.set('id', id);
    router.push(`/devices?${next.toString()}`);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-2">
        {devices.map((d) => {
          const p = PRESENCE[d.presence];
          const meta = kindMeta(d.kind);
          const isSel = d.id === selected.id;
          return (
            <motion.button
              key={d.id}
              type="button"
              onClick={() => selectDevice(d.id)}
              whileTap={{ scale: 0.98 }}
              className={cn(
                'group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                isSel
                  ? 'border-[var(--color-brand)] bg-[var(--color-bg-card)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-card)]',
              )}
            >
              <StatusDot state={p.state} size="sm" pulse={p.state === 'success'} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.name}</div>
                <div className="flex items-center gap-1.5 truncate text-[11px] text-[var(--color-fg-subtle)]">
                  <meta.Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {meta.label} · {d.platform}
                    {d.version ? ` · v${d.version}` : ''}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">
                  {d.lastSeenAt ? `seen ${new Date(d.lastSeenAt).toLocaleString()}` : 'never seen'}
                </div>
              </div>
            </motion.button>
          );
        })}
        <Link
          href="/devices/verify"
          className="block rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 text-center text-xs text-[var(--color-fg-muted)] hover:border-[var(--color-brand)] hover:text-[var(--color-fg)]"
        >
          + Pair a new device
        </Link>
      </div>

      <DeviceDetail device={selected} events={events} />
    </div>
  );
}

function DeviceDetail({ device, events }: { device: DeviceRow; events: DeviceEventRow[] }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(device.name);

  function send(command: (typeof COMMANDS)[number]['id']) {
    startTransition(async () => {
      const r = await sendDeviceCommandAction({ deviceId: device.id, command });
      if (r.ok) toast.success(`${command} → delivered to ${r.delivered} client(s)`);
      else toast.error(r.error);
    });
  }

  function rename() {
    startTransition(async () => {
      const r = await renameDeviceAction({ deviceId: device.id, name });
      if (r.ok) {
        toast.success('Renamed');
        setEditing(false);
      } else {
        toast.error(r.error ?? 'Failed');
      }
    });
  }

  function unpair() {
    if (!confirm(`Unpair "${device.name}"? This revokes its session.`)) return;
    startTransition(async () => {
      const r = await unpairDeviceAction({ deviceId: device.id });
      if (r.ok) toast.success('Unpaired');
    });
  }

  const p = PRESENCE[device.presence];
  const meta = kindMeta(device.kind);
  const availableCommands = commandsForKind(device.kind);
  const activity = device.activity as { window?: string; file?: string; idleSec?: number };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <StatusDot state={p.state} size="md" pulse={p.state === 'success'} className="mt-2" />
            {editing ? (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={rename}
                onKeyDown={(e) => e.key === 'Enter' && rename()}
                autoFocus
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-lg font-semibold"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-left text-2xl font-semibold tracking-tight hover:underline"
              >
                {device.name}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-fg-muted)]">{p.label}</span>
            <button
              type="button"
              onClick={unpair}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-50"
            >
              <PowerOff className="h-3 w-3" /> Unpair
            </button>
          </div>
        </div>
        <div className="mt-2 grid gap-2 text-xs text-[var(--color-fg-muted)] sm:grid-cols-2">
          <Row label="Kind" value={meta.label} />
          <Row label="Platform" value={device.platform} />
          <Row label="Version" value={device.version ?? '—'} />
          <Row
            label="Last seen"
            value={device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : 'never'}
          />
          <Row label="Paired" value={new Date(device.createdAt).toLocaleString()} />
          <Row
            label="Activity"
            value={
              activity.window
                ? `${activity.window}${activity.file ? ` · ${activity.file}` : ''}`
                : '—'
            }
          />
        </div>
        {device.capabilities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {device.capabilities.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-fg-muted)]"
              >
                <Wand2 className="h-2.5 w-2.5" /> {c}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Send command</CardTitle>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          Hub-routed envelopes. The device must be online or idle to act on them.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {availableCommands.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => send(c.id)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-xs hover:bg-[var(--color-bg-card)] disabled:opacity-50"
            >
              <c.Icon className="h-3.5 w-3.5" /> {c.label}
            </button>
          ))}
          {availableCommands.length <= 1 ? (
            <span className="self-center text-[11px] text-[var(--color-fg-subtle)]">
              {meta.label} only honors ping. Use editor / browser tools instead.
            </span>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Recent events</CardTitle>
          <Activity className="h-4 w-4 text-[var(--color-fg-subtle)]" />
        </div>
        <ul className="mt-3 space-y-1 text-xs">
          {events.length === 0 && (
            <li className="text-[var(--color-fg-subtle)]">No events recorded.</li>
          )}
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-baseline justify-between gap-3 border-b border-[var(--color-border)] py-1.5 last:border-0"
            >
              <span className="font-mono text-[var(--color-fg)]">{e.kind}</span>
              <span className="font-mono text-[10px] text-[var(--color-fg-subtle)]">
                {new Date(e.occurredAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--color-fg-subtle)]">{label}</span>
      <span className="truncate text-[var(--color-fg)]">{value}</span>
    </div>
  );
}
