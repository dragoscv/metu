'use client';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input } from '@metu/ui';
import {
  Plus,
  Trash2,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronRight,
  Wand2,
  Copy,
  Check,
} from 'lucide-react';
import {
  createOauthAppAction,
  deleteOauthAppAction,
  deleteOauthConnectionAction,
  discoverOauthAppAction,
} from '@/app/actions/oauth-apps';

export interface OauthAppView {
  id: string;
  name: string;
  slug: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string | null;
  scopes: string;
  callbackUrl: string;
  discovered: {
    issuer?: string;
    scopesSupported?: string[];
    grantTypesSupported?: string[];
    codeChallengeMethodsSupported?: string[];
  };
}

export interface OauthConnectionView {
  id: string;
  appId: string;
  externalId: string;
  label: string;
  status: string;
  grantedScopes: string;
  identity: Record<string, unknown>;
  createdAt: string;
}

interface Props {
  apps: OauthAppView[];
  connections: OauthConnectionView[];
}

export function CustomOauthSection({ apps, connections }: Props) {
  const [showForm, setShowForm] = useState(false);
  const byApp = new Map<string, OauthConnectionView[]>();
  for (const c of connections) {
    const arr = byApp.get(c.appId) ?? [];
    arr.push(c);
    byApp.set(c.appId, arr);
  }

  // Surface oauth_error / oauth_connected from the URL
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const err = url.searchParams.get('oauth_error');
    const ok = url.searchParams.get('oauth_connected');
    if (err) {
      toast.error(`OAuth failed: ${err}`);
      url.searchParams.delete('oauth_error');
      window.history.replaceState({}, '', url.toString());
    } else if (ok) {
      toast.success(`Connected: ${ok}`);
      url.searchParams.delete('oauth_connected');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  return (
    <section className="space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Custom OAuth providers</h2>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            Bring any OAuth 2 / OIDC app you own. Paste a discovery URL and we autofill endpoints +
            detect supported scopes and grant types.
          </p>
        </div>
        <Button variant={showForm ? 'outline' : 'default'} onClick={() => setShowForm((s) => !s)}>
          <Plus className="mr-2 h-4 w-4" />
          {showForm ? 'Cancel' : 'Add provider'}
        </Button>
      </header>

      {showForm && <AddProviderForm onDone={() => setShowForm(false)} />}

      {apps.length === 0 && !showForm ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] p-6 text-sm text-[var(--color-fg-muted)]">
          No custom OAuth providers yet. Click <strong>Add provider</strong> to wire one up.
        </div>
      ) : (
        <div className="space-y-3">
          {apps.map((app) => (
            <AppRow key={app.id} app={app} connections={byApp.get(app.id) ?? []} />
          ))}
        </div>
      )}
    </section>
  );
}

function AppRow({ app, connections }: { app: OauthAppView; connections: OauthConnectionView[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function onDelete() {
    if (!confirm(`Remove OAuth provider "${app.name}"? All connections will be revoked locally.`))
      return;
    startTransition(async () => {
      const r = await deleteOauthAppAction(app.id);
      if (r.ok) toast.success('Provider removed');
      else toast.error(r.error ?? 'Failed');
    });
  }

  function copyCallback() {
    void navigator.clipboard.writeText(app.callbackUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  const caps: string[] = [];
  if (app.discovered.codeChallengeMethodsSupported?.includes('S256')) caps.push('PKCE');
  if (app.discovered.grantTypesSupported?.includes('refresh_token')) caps.push('refresh tokens');
  if (app.userinfoUrl) caps.push('userinfo');
  if (app.discovered.issuer) caps.push('OIDC');

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)]">
      <div className="flex items-center gap-3 p-4">
        <button
          onClick={() => setOpen((o) => !o)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded hover:bg-[var(--color-bg-elevated)]"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-medium">{app.name}</h3>
            <span className="rounded-full bg-[var(--color-bg-elevated)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]">
              {app.slug}
            </span>
            {connections.length > 0 && (
              <span className="rounded-full bg-[var(--color-success-soft,rgba(34,197,94,0.15))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-success)]">
                {connections.length} connected
              </span>
            )}
          </div>
          {caps.length > 0 && (
            <p className="mt-1 text-xs text-[var(--color-fg-muted)]">
              Detected: {caps.join(' · ')}
            </p>
          )}
        </div>
        <a href={`/api/oauth/${app.id}/start`}>
          <Button>
            <ExternalLink className="mr-2 h-4 w-4" />
            Sign in
          </Button>
        </a>
        <button
          onClick={onDelete}
          disabled={pending}
          className="rounded p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-danger,#ef4444)]"
          aria-label="Remove provider"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-[var(--color-border)] p-4 text-sm">
          <KV k="Authorize URL" v={app.authorizeUrl} />
          <KV k="Token URL" v={app.tokenUrl} />
          {app.userinfoUrl && <KV k="Userinfo URL" v={app.userinfoUrl} />}
          {app.scopes && <KV k="Scopes" v={app.scopes} />}
          <div className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
              Callback URL
            </span>
            <code className="flex-1 truncate rounded bg-[var(--color-bg-elevated)] px-2 py-1 text-xs">
              {app.callbackUrl}
            </code>
            <button
              onClick={copyCallback}
              className="rounded p-1 hover:bg-[var(--color-bg-elevated)]"
              aria-label="Copy"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          {app.discovered.scopesSupported && app.discovered.scopesSupported.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
                Scopes supported by provider
              </p>
              <div className="flex flex-wrap gap-1">
                {app.discovered.scopesSupported.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-[var(--color-bg-elevated)] px-2 py-0.5 font-mono text-[10px]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {connections.length > 0 && (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
                Connections
              </p>
              <ul className="space-y-2">
                {connections.map((c) => (
                  <ConnectionRow key={c.id} c={c} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionRow({ c }: { c: OauthConnectionView }) {
  const [pending, startTransition] = useTransition();
  function onDisconnect() {
    if (!confirm(`Disconnect ${c.label}?`)) return;
    startTransition(async () => {
      const r = await deleteOauthConnectionAction(c.id);
      if (r.ok) toast.success('Disconnected');
      else toast.error(r.error ?? 'Failed');
    });
  }
  const grantedScopes = c.grantedScopes.split(/\s+/).filter(Boolean);
  return (
    <li className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{c.label}</p>
          <p className="truncate font-mono text-[10px] text-[var(--color-fg-muted)]">
            {c.externalId}
          </p>
        </div>
        <button
          onClick={onDisconnect}
          disabled={pending}
          className="rounded p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-danger,#ef4444)]"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {grantedScopes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {grantedScopes.map((s) => (
            <span
              key={s}
              className="rounded-full bg-[var(--color-bg-card)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-32 shrink-0 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
        {k}
      </span>
      <code className="flex-1 break-all rounded bg-[var(--color-bg-elevated)] px-2 py-1 text-xs">
        {v}
      </code>
    </div>
  );
}

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [discovering, setDiscovering] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discoveredScopes, setDiscoveredScopes] = useState<string[]>([]);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    discoveryUrl: '',
    authorizeUrl: '',
    tokenUrl: '',
    userinfoUrl: '',
    revokeUrl: '',
    clientId: '',
    clientSecret: '',
    scopes: '',
    pkce: true,
  });

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function discover() {
    if (!form.discoveryUrl) {
      toast.error('Paste a discovery URL or issuer URL first');
      return;
    }
    setDiscovering(true);
    try {
      const r = await discoverOauthAppAction(form.discoveryUrl);
      if (!r.ok || !r.endpoints) {
        toast.error(r.error ?? 'Discovery failed');
        return;
      }
      setForm((f) => ({
        ...f,
        authorizeUrl: r.endpoints!.authorizeUrl ?? f.authorizeUrl,
        tokenUrl: r.endpoints!.tokenUrl ?? f.tokenUrl,
        userinfoUrl: r.endpoints!.userinfoUrl ?? f.userinfoUrl,
        revokeUrl: r.endpoints!.revokeUrl ?? f.revokeUrl,
        pkce: r.endpoints!.codeChallengeMethodsSupported?.includes('S256') ?? f.pkce,
      }));
      setDiscoveredScopes(r.endpoints.scopesSupported ?? []);
      toast.success(`Discovered${r.endpoints.issuer ? ` · ${r.endpoints.issuer}` : ''}`);
    } finally {
      setDiscovering(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
      fd.set(k, typeof v === 'boolean' ? String(v) : v);
    }
    startTransition(async () => {
      const r = await createOauthAppAction(fd);
      if (!r.ok) {
        if (r.fieldErrors) setErrors(r.fieldErrors);
        toast.error(r.error ?? 'Failed');
        return;
      }
      toast.success('Provider added — click Sign in to test the flow');
      onDone();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Display name" error={errors.name}>
          <Input
            placeholder="My GitHub OAuth App"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            required
          />
        </Field>
        <Field label="Slug" hint="Stable identifier — used in callback URL" error={errors.slug}>
          <Input
            placeholder="my-github"
            value={form.slug}
            onChange={(e) => update('slug', e.target.value.toLowerCase())}
            required
          />
        </Field>
      </div>

      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
        <Field
          label="Discovery URL (optional)"
          hint="Paste your provider's issuer or /.well-known URL — we'll autofill the rest"
        >
          <div className="flex gap-2">
            <Input
              placeholder="https://accounts.google.com/.well-known/openid-configuration"
              value={form.discoveryUrl}
              onChange={(e) => update('discoveryUrl', e.target.value)}
            />
            <Button type="button" variant="outline" onClick={discover} disabled={discovering}>
              {discovering ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Autofill
            </Button>
          </div>
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Authorize URL" error={errors.authorizeUrl}>
          <Input
            placeholder="https://provider.example/oauth/authorize"
            value={form.authorizeUrl}
            onChange={(e) => update('authorizeUrl', e.target.value)}
            required
          />
        </Field>
        <Field label="Token URL" error={errors.tokenUrl}>
          <Input
            placeholder="https://provider.example/oauth/token"
            value={form.tokenUrl}
            onChange={(e) => update('tokenUrl', e.target.value)}
            required
          />
        </Field>
        <Field label="Userinfo URL (optional)" error={errors.userinfoUrl}>
          <Input
            placeholder="https://provider.example/userinfo"
            value={form.userinfoUrl}
            onChange={(e) => update('userinfoUrl', e.target.value)}
          />
        </Field>
        <Field label="Revoke URL (optional)" error={errors.revokeUrl}>
          <Input
            placeholder="https://provider.example/revoke"
            value={form.revokeUrl}
            onChange={(e) => update('revokeUrl', e.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Client ID" error={errors.clientId}>
          <Input
            value={form.clientId}
            onChange={(e) => update('clientId', e.target.value)}
            required
          />
        </Field>
        <Field label="Client Secret" hint="Sealed with AES-256-GCM" error={errors.clientSecret}>
          <Input
            type="password"
            value={form.clientSecret}
            onChange={(e) => update('clientSecret', e.target.value)}
            required
          />
        </Field>
      </div>

      <Field
        label="Scopes"
        hint="Space-delimited (e.g. openid email profile)"
        error={errors.scopes}
      >
        <Input value={form.scopes} onChange={(e) => update('scopes', e.target.value)} />
      </Field>

      {discoveredScopes.length > 0 && (
        <div>
          <p className="mb-1 text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
            Click to add discovered scopes
          </p>
          <div className="flex flex-wrap gap-1">
            {discoveredScopes.slice(0, 24).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => {
                  const cur = form.scopes.split(/\s+/).filter(Boolean);
                  if (!cur.includes(s)) update('scopes', [...cur, s].join(' '));
                }}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-0.5 font-mono text-[10px] hover:border-[var(--color-fg-muted)]"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.pkce}
          onChange={(e) => update('pkce', e.target.checked)}
        />
        Use PKCE (recommended)
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add provider
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wider text-[var(--color-fg-muted)]">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-[var(--color-fg-muted)]">{hint}</p>}
      {error && <p className="text-[11px] text-[var(--color-danger,#ef4444)]">{error}</p>}
    </div>
  );
}
