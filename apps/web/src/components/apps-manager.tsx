'use client';
import { useState, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button, Card, CardTitle } from '@metu/ui';
import {
  registerAppAction,
  revokeAppAction,
  rotateClientSecretAction,
  type RegisterAppResult,
} from '@/app/actions/apps';

export interface RegisteredApp {
  id: string;
  clientId: string;
  type: string;
  name: string;
  allowedScopes: string;
  redirectUris: string[];
  iconUrl: string | null;
  webhookUrl: string | null;
}

export function AppsManager({ apps }: { apps: RegisteredApp[] }) {
  const [showCreate, setShowCreate] = useState(false);
  const [secret, setSecret] = useState<RegisterAppResult | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Apps</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            First- and third-party apps that connect to METU. Each gets a scoped OAuth2/OIDC client.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>Register app</Button>
      </div>

      <AnimatePresence>
        {showCreate ? (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <CreateForm
              onClose={() => setShowCreate(false)}
              onCreated={(r) => {
                setShowCreate(false);
                setSecret(r);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {secret ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
          >
            <SecretCard secret={secret} onDismiss={() => setSecret(null)} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {apps.length === 0 ? (
          <Card>
            <div className="px-1 py-8 text-center text-sm text-[var(--color-fg-muted)]">
              No registered apps yet.
            </div>
          </Card>
        ) : (
          apps.map((app) => <AppCard key={app.id} app={app} />)
        )}
      </div>
    </div>
  );
}

function CreateForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: RegisterAppResult) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<'first_party' | 'third_party' | 'public'>('first_party');
  const [redirectUris, setRedirectUris] = useState('http://localhost:3000/oauth/callback');
  const [scopes, setScopes] = useState('openid profile capture:write recall:read notify:write');
  const [webhookUrl, setWebhookUrl] = useState('');

  return (
    <Card>
      <CardTitle>Register a new app</CardTitle>
      <div className="mt-3 grid gap-3">
        <Field label="Name" value={name} onChange={setName} placeholder="notai" />
        <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-muted)]">
          Type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-fg)]"
          >
            <option value="first_party">first_party (your own app)</option>
            <option value="third_party">third_party (with secret)</option>
            <option value="public">public (PKCE, no secret — mobile / desktop / SPA)</option>
          </select>
        </label>
        <Field
          label="Redirect URIs (one per line)"
          value={redirectUris}
          onChange={setRedirectUris}
          multiline
          rows={3}
        />
        <Field label="Allowed scopes (space-delimited)" value={scopes} onChange={setScopes} />
        <Field
          label="Webhook URL (optional)"
          value={webhookUrl}
          onChange={setWebhookUrl}
          placeholder="https://example.com/metu/webhook"
        />
      </div>
      {error ? <p className="mt-3 text-sm text-[var(--color-danger)]">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          disabled={pending || !name || !redirectUris.trim()}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await registerAppAction({
                name,
                type,
                redirectUris: redirectUris
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean),
                scopes,
                webhookUrl: webhookUrl.trim() || undefined,
              });
              if (result.ok) onCreated(result);
              else setError(result.error);
            });
          }}
        >
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </Card>
  );
}

function SecretCard({ secret, onDismiss }: { secret: RegisterAppResult; onDismiss: () => void }) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-[var(--color-warning)]" />
        <CardTitle>Save these secrets now</CardTitle>
      </div>
      <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
        We store only hashes. You won&apos;t see these values again.
      </p>
      <dl className="mt-3 grid gap-2 text-sm">
        <Pair label="Client ID" value={secret.clientId} />
        {secret.clientSecret ? (
          <Pair label="Client secret" value={secret.clientSecret} mono />
        ) : null}
        {secret.webhookSecret ? (
          <Pair label="Webhook secret" value={secret.webhookSecret} mono />
        ) : null}
      </dl>
      <div className="mt-4 flex justify-end">
        <Button onClick={onDismiss}>I&apos;ve saved them</Button>
      </div>
    </Card>
  );
}

function AppCard({ app }: { app: RegisteredApp }) {
  const [pending, startTransition] = useTransition();
  const [rotated, setRotated] = useState<string | null>(null);
  return (
    <Card>
      <div className="flex items-start gap-3">
        {app.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.iconUrl} alt="" className="h-10 w-10 rounded-md" />
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-md bg-[var(--color-bg-elevated)] text-sm font-semibold">
            {app.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{app.name}</div>
          <div className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
            {app.type} · <code className="font-mono text-[11px]">{app.clientId}</code>
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs text-[var(--color-fg-muted)]">
        scopes: <code className="font-mono">{app.allowedScopes}</code>
      </div>
      <div className="mt-1 text-xs text-[var(--color-fg-muted)]">
        redirects:
        <ul className="ml-3 mt-0.5 list-disc">
          {app.redirectUris.map((u) => (
            <li key={u} className="break-all font-mono">
              {u}
            </li>
          ))}
        </ul>
      </div>
      {rotated ? (
        <div className="mt-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-warning-bg,transparent)] p-2 text-xs">
          New secret (shown once): <code className="break-all font-mono">{rotated}</code>
        </div>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        {app.type !== 'public' ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const r = await rotateClientSecretAction(app.id);
                if (r.ok) setRotated(r.clientSecret);
              });
            }}
          >
            Rotate secret
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!confirm('Revoke this app? All existing tokens stop working.')) return;
            startTransition(async () => {
              await revokeAppAction(app.id);
            });
          }}
        >
          Revoke
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
  multiline,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-muted)]">
      {label}
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 font-mono text-xs text-[var(--color-fg)]"
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-fg)]"
        />
      )}
    </label>
  );
}

function Pair({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {label}
      </dt>
      <dd
        className={
          'break-all rounded-md bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm ' +
          (mono ? 'font-mono' : '')
        }
      >
        {value}
      </dd>
    </div>
  );
}
