'use client';

import { useState, useTransition } from 'react';
import { Button, Input } from '@metu/ui';
import { toast } from 'sonner';
import { upsertOauthAppForKindAction } from '@/app/actions/oauth-apps';

export function OauthAppsKindForm({ kinds }: { kinds: { kind: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <form
      action={(fd) =>
        start(async () => {
          const res = await upsertOauthAppForKindAction(fd);
          if (res.ok) {
            toast.success('OAuth credentials saved');
            (document.getElementById('oauth-kind-form') as HTMLFormElement | null)?.reset();
          } else {
            toast.error(res.error);
          }
        })
      }
      id="oauth-kind-form"
      className="space-y-3 text-sm"
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] text-[var(--color-fg-subtle)]">Provider</span>
          <select
            name="kind"
            required
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
          >
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.name} ({k.kind})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] text-[var(--color-fg-subtle)]">Token endpoint auth</span>
          <select
            name="tokenAuthMethod"
            defaultValue="client_secret_post"
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
          >
            <option value="client_secret_post">client_secret_post</option>
            <option value="client_secret_basic">client_secret_basic (LinkedIn / Twitter)</option>
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--color-fg-subtle)]">Client ID</span>
        <Input name="clientId" required placeholder="abc123…" autoComplete="off" />
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--color-fg-subtle)]">Client secret</span>
        <Input
          name="clientSecret"
          type="password"
          required
          placeholder="•••••"
          autoComplete="off"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          Scopes <span className="text-[var(--color-fg-subtle)]">(blank = catalog default)</span>
        </span>
        <Input name="scopes" placeholder="space-delimited" autoComplete="off" />
      </label>

      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="text-[11px] text-[var(--color-brand)] underline"
      >
        {showAdvanced ? 'Hide' : 'Show'} advanced URL overrides
      </button>

      {showAdvanced && (
        <div className="bg-[var(--color-bg-elevated)]/30 space-y-2 rounded-md border border-[var(--color-border)] p-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-[var(--color-fg-subtle)]">
              Authorize URL override
            </span>
            <Input name="authorizeUrl" placeholder="https://…/oauth/authorize" autoComplete="off" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-[var(--color-fg-subtle)]">Token URL override</span>
            <Input name="tokenUrl" placeholder="https://…/oauth/token" autoComplete="off" />
          </label>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" name="pkce" defaultChecked />
            Use PKCE (S256)
          </label>
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save credentials'}
      </Button>
    </form>
  );
}
