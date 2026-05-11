'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input } from '@metu/ui';
import { upsertProviderCredentialAction } from '@/app/actions/credentials';

const PROVIDERS = [
  'anthropic',
  'openai',
  'azure_openai',
  'google',
  'vertex',
  'ollama',
  'custom',
  'deepgram',
  'cartesia',
  'elevenlabs',
] as const;

export function ProviderCredentialForm() {
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [label, setLabel] = useState('default');
  const [pending, start] = useTransition();

  return (
    <div className="mt-3 grid gap-3">
      <div className="grid gap-2 md:grid-cols-2">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as (typeof PROVIDERS)[number])}
          className="h-10 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-sm"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. 'personal', 'team')"
        />
      </div>
      <Input
        type="password"
        autoComplete="new-password"
        placeholder="API key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      {provider === 'azure_openai' && (
        <Input
          placeholder="Azure endpoint (https://...)"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
      )}
      <Button
        disabled={pending || !apiKey.trim()}
        onClick={() =>
          start(async () => {
            const r = await upsertProviderCredentialAction({
              provider,
              label: label || 'default',
              apiKey,
              endpoint: endpoint || undefined,
              isDefault: true,
              config: {},
            });
            if (r.ok) {
              toast.success('Saved.');
              setApiKey('');
            } else if (r.error === 'plan_required') {
              toast.error(
                `Free tier allows 1 provider. Upgrade to Starter+ to add more.`,
                { action: { label: 'Upgrade', onClick: () => (window.location.href = '/settings/billing') } },
              );
            } else toast.error(r.error ?? 'Failed');
          })
        }
      >
        Save credential
      </Button>
    </div>
  );
}
