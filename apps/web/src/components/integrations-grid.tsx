'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button, Input } from '@metu/ui';
import {
  ArrowRight,
  Check,
  X,
  ExternalLink,
  Loader2,
  KeyRound,
  Smartphone,
  Globe,
  Plus,
  Star,
} from 'lucide-react';
import type { IntegrationKind } from '@metu/types';
import {
  connectIntegrationAction,
  disconnectIntegrationAction,
  setDefaultIntegrationAction,
} from '@/app/actions/integrations';
import {
  startIntegrationDeviceFlowAction,
  pollIntegrationDeviceFlowAction,
} from '@/app/actions/integration-device-flow';
import { INTEGRATIONS_CATALOG, type IntegrationCatalogEntry } from '@/lib/integrations/catalog';
import type { ConnectMethod } from '@/lib/integrations/connect-methods';

export interface ConnectedIntegration {
  id: string;
  kind: IntegrationKind;
  externalId: string;
  label: string;
  status: 'active' | 'paused' | 'error' | 'revoked';
  isDefault: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

interface Props {
  connected: ConnectedIntegration[];
  /** Server-resolved set of methods available per kind (env-gated). */
  capabilities: Partial<Record<IntegrationKind, ConnectMethod[]>>;
}

export function IntegrationsGrid({ connected, capabilities }: Props) {
  // Group all connections by kind so each provider card can show multiple accounts.
  const byKind = new Map<IntegrationKind, ConnectedIntegration[]>();
  for (const c of connected) {
    const list = byKind.get(c.kind) ?? [];
    list.push(c);
    byKind.set(c.kind, list);
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {INTEGRATIONS_CATALOG.map((entry) => (
        <IntegrationCard
          key={entry.kind}
          entry={entry}
          accounts={byKind.get(entry.kind) ?? []}
          methods={capabilities[entry.kind] ?? ['token']}
        />
      ))}
    </div>
  );
}

function IntegrationCard({
  entry,
  accounts,
  methods,
}: {
  entry: IntegrationCatalogEntry;
  accounts: ConnectedIntegration[];
  methods: ConnectMethod[];
}) {
  const [open, setOpen] = useState(false);
  const Icon = entry.icon;
  const hasAccounts = accounts.length > 0;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--color-bg-elevated)]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-medium">{entry.name}</h3>
            {hasAccounts ? (
              <span className="rounded-full bg-[var(--color-success-soft,rgba(34,197,94,0.15))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-success)]">
                {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-fg-muted)]">
            {entry.description}
          </p>
        </div>
      </div>

      {hasAccounts ? (
        <ul className="mt-4 space-y-2">
          {accounts.map((a) => (
            <AccountRow key={a.id} integration={a} canPromote={accounts.length > 1} />
          ))}
        </ul>
      ) : null}

      {hasAccounts && entry.kind === 'github' && (
        <Link
          href="/integrations/github"
          className="mt-3 inline-flex w-full items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-bg-card)]"
        >
          <span>Browse repositories</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}

      <Button
        type="button"
        variant={hasAccounts ? 'outline' : 'default'}
        className="mt-4 w-full"
        onClick={() => setOpen(true)}
      >
        {hasAccounts ? (
          <>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Add another account
          </>
        ) : (
          'Connect'
        )}
      </Button>

      {open && <ConnectModal entry={entry} methods={methods} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Renders a localized timestamp on the client only to avoid SSR/CSR locale
// mismatches.
function ClientTime({ iso }: { iso: string | Date }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(new Date(iso).toLocaleString());
  }, [iso]);
  return <>{text ?? ''}</>;
}

function AccountRow({
  integration,
  canPromote,
}: {
  integration: ConnectedIntegration;
  canPromote: boolean;
}) {
  const [pending, start] = useTransition();

  function disconnect() {
    if (!window.confirm(`Disconnect ${integration.label}?`)) return;
    start(async () => {
      const r = await disconnectIntegrationAction({ id: integration.id });
      if (!r.ok) toast.error(r.error);
      else toast.success('Disconnected');
    });
  }

  function makeDefault() {
    start(async () => {
      const r = await setDefaultIntegrationAction({ id: integration.id });
      if (!r.ok) toast.error(r.error);
      else toast.success(`${integration.label} is now the default`);
    });
  }

  return (
    <li className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-medium text-[var(--color-fg)]">
          {integration.label}
        </p>
        {integration.isDefault ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-brand-soft,rgba(124,58,237,0.15))] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--color-brand)]">
            <Star className="h-2.5 w-2.5 fill-current" /> Default
          </span>
        ) : null}
      </div>
      <p className="truncate text-[var(--color-fg-subtle)]">{integration.externalId}</p>
      {integration.lastError ? (
        <p className="mt-1 truncate text-[var(--color-warning,#f59e0b)]">
          ⚠ {integration.lastError}
        </p>
      ) : integration.lastSyncAt ? (
        <p className="mt-1 text-[var(--color-fg-subtle)]">
          Last sync <ClientTime iso={integration.lastSyncAt} />
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        {canPromote && !integration.isDefault ? (
          <button
            type="button"
            onClick={makeDefault}
            disabled={pending}
            className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline disabled:opacity-50"
          >
            Make default
          </button>
        ) : null}
        <button
          type="button"
          onClick={disconnect}
          disabled={pending}
          className="ml-auto text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-warning,#f59e0b)] hover:underline disabled:opacity-50"
        >
          {pending ? 'Working…' : 'Disconnect'}
        </button>
      </div>
    </li>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────

type ModalView = 'choose' | 'web-oauth' | 'device-flow' | 'token';

function ConnectModal({
  entry,
  methods,
  onClose,
}: {
  entry: IntegrationCatalogEntry;
  methods: ConnectMethod[];
  onClose: () => void;
}) {
  // If only one method is available, jump straight to it.
  const initial: ModalView = methods.length === 1 ? methods[0]! : 'choose';
  const [view, setView] = useState<ModalView>(initial);
  const Icon = entry.icon;

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--color-bg-elevated)]">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Connect {entry.name}</h2>
            <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{entry.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5">
          {view === 'choose' ? (
            <ChooseMethod methods={methods} entry={entry} onPick={(m) => setView(m)} />
          ) : (
            <>
              {methods.length > 1 && (
                <button
                  type="button"
                  onClick={() => setView('choose')}
                  className="mb-3 text-[11px] text-[var(--color-fg-subtle)] hover:underline"
                >
                  ← Choose a different method
                </button>
              )}
              {view === 'web-oauth' ? (
                <WebOauthBlock entry={entry} />
              ) : view === 'device-flow' ? (
                <DeviceFlow entry={entry} onDone={onClose} />
              ) : (
                <ConnectForm entry={entry} onDone={onClose} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChooseMethod({
  methods,
  entry,
  onPick,
}: {
  methods: ConnectMethod[];
  entry: IntegrationCatalogEntry;
  onPick: (m: ModalView) => void;
}) {
  const items: {
    method: ConnectMethod;
    title: string;
    desc: string;
    Icon: typeof Globe;
    recommended?: boolean;
  }[] = [];
  if (methods.includes('web-oauth'))
    items.push({
      method: 'web-oauth',
      title: `Sign in with ${entry.name}`,
      desc: 'Open the provider in a new tab and authorize. Easiest option.',
      Icon: Globe,
      recommended: true,
    });
  if (methods.includes('device-flow'))
    items.push({
      method: 'device-flow',
      title: 'Use a device code',
      desc: 'Get a short code, open the verification page, and approve.',
      Icon: Smartphone,
      recommended: !methods.includes('web-oauth'),
    });
  if (methods.includes('token'))
    items.push({
      method: 'token',
      title: 'Paste a token',
      desc: 'Manually paste a personal access token or API key.',
      Icon: KeyRound,
    });

  return (
    <ul className="space-y-2">
      {items.map(({ method, title, desc, Icon, recommended }) => (
        <li key={method}>
          <button
            type="button"
            onClick={() => onPick(method)}
            className="flex w-full items-start gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-left transition-colors hover:border-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)]"
          >
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--color-bg-card)]">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{title}</p>
                {recommended && (
                  <span className="rounded-full bg-[var(--color-success-soft,rgba(34,197,94,0.15))] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--color-success)]">
                    Recommended
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{desc}</p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function WebOauthBlock({ entry }: { entry: IntegrationCatalogEntry }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-[var(--color-fg-muted)]">
        You&apos;ll be redirected to {entry.name} to authorize the connection, then sent back here
        automatically.
      </p>
      {entry.scopes && entry.scopes.length > 0 ? (
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Requested scopes: {entry.scopes.join(' · ')}
        </p>
      ) : null}
      <a href={`/api/integrations/oauth/${entry.kind}/start`}>
        <Button type="button" className="w-full">
          <ExternalLink className="mr-2 h-3.5 w-3.5" />
          Continue to {entry.name}
        </Button>
      </a>
    </div>
  );
}

function ConnectForm({ entry, onDone }: { entry: IntegrationCatalogEntry; onDone: () => void }) {
  const [token, setToken] = useState('');
  const [label, setLabel] = useState('');
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    start(async () => {
      const r = await connectIntegrationAction({
        kind: entry.kind,
        token: token.trim(),
        label: label.trim() || undefined,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Connected as ${r.data.label}`);
      setToken('');
      setLabel('');
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      {entry.tokenHint ? (
        <p className="text-xs text-[var(--color-fg-muted)]">{entry.tokenHint}</p>
      ) : null}
      {entry.scopes && entry.scopes.length > 0 ? (
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Scopes: {entry.scopes.join(' · ')}
        </p>
      ) : null}
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        disabled={pending}
        required
      />
      <Input
        type="text"
        placeholder="Label (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        disabled={pending}
        maxLength={120}
      />
      <Button type="submit" className="w-full" disabled={pending || !token.trim()}>
        {pending ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Verifying…
          </>
        ) : (
          <>
            <Check className="mr-2 h-3.5 w-3.5" />
            Connect
          </>
        )}
      </Button>
      {entry.tokenUrl ? (
        <a
          href={entry.tokenUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)] hover:underline"
        >
          Open token settings <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </form>
  );
}

function DeviceFlow({ entry, onDone }: { entry: IntegrationCatalogEntry; onDone: () => void }) {
  const [flow, setFlow] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
  } | null>(null);
  const [busy, setBusy] = useState(true);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await startIntegrationDeviceFlowAction(entry.kind);
      if (cancelled) return;
      if (!r.ok) {
        setBusy(false);
        toast.error(r.error);
        onDone();
        return;
      }
      setFlow({
        userCode: r.data.userCode,
        verificationUri: r.data.verificationUri,
        deviceCode: r.data.deviceCode,
        interval: r.data.interval,
      });
      void poll(r.data.deviceCode, r.data.interval);
    })();
    return () => {
      cancelled = true;
      stoppedRef.current = true;
    };
  }, []);

  async function poll(deviceCode: string, intervalSec: number) {
    let interval = intervalSec;
    stoppedRef.current = false;
    while (!stoppedRef.current) {
      await new Promise((r) => setTimeout(r, interval * 1000));
      if (stoppedRef.current) return;
      const r = await pollIntegrationDeviceFlowAction(entry.kind, deviceCode);
      if (!r.ok) {
        toast.error(r.error);
        setBusy(false);
        return;
      }
      const s = r.data.status;
      if (s === 'ok') {
        toast.success(`Connected as ${r.data.label ?? entry.name}`);
        setBusy(false);
        window.location.reload();
        return;
      }
      if (s === 'denied') {
        toast.error('Authorization denied.');
        setBusy(false);
        onDone();
        return;
      }
      if (s === 'expired') {
        toast.error('Code expired. Try again.');
        setBusy(false);
        onDone();
        return;
      }
      if (s === 'slow_down') interval += 5;
    }
  }

  function copyCode() {
    if (!flow) return;
    void navigator.clipboard
      .writeText(flow.userCode)
      .then(() => toast.success('Code copied'))
      .catch(() => toast.error('Copy failed'));
  }

  if (!flow) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-xs text-[var(--color-fg-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Starting…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Open{' '}
        <a
          href={flow.verificationUri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[var(--color-fg)] underline"
        >
          {new URL(flow.verificationUri).host}
          <ExternalLink className="h-3 w-3" />
        </a>{' '}
        and enter:
      </p>
      <button
        type="button"
        onClick={copyCode}
        title="Click to copy"
        className="block w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3 text-center font-mono text-xl tracking-[0.3em] hover:bg-[var(--color-bg-card)]"
      >
        {flow.userCode}
      </button>
      <div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Waiting for authorization…{busy ? '' : ' done'}
      </div>
    </div>
  );
}
