import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, CardTitle, Page, PageHeader } from '@metu/ui';
import { listAvailableProviders, getProviderPolicy } from '@metu/ai';
import { ProviderCredentialForm } from '@/components/provider-credential-form';
import { ProviderKeyTester } from '@/components/provider-key-tester';
import { CopilotConnect } from '@/components/copilot-connect';
import { CodaiConnect } from '@/components/codai-connect';
import { ProviderPolicyForm } from '@/components/provider-policy-form';
import { TestNotificationCard } from '@/components/test-notification-card';
import { loadCopilotIdentity } from '@/lib/copilot-identity';

const PROVIDER_LABELS: Record<string, string> = {
  copilot: 'GitHub Copilot',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  groq: 'Groq',
  mistral: 'Mistral',
  ollama: 'Ollama (local)',
  codai: 'Codai (ai.codai.ro)',
  custom: 'Custom endpoint',
};

function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? p;
}

function sourceBadge(source: 'workspace' | 'env' | 'none'): {
  text: string;
  cls: string;
} {
  switch (source) {
    case 'workspace':
      return {
        text: 'Workspace',
        cls: 'bg-[var(--color-success-soft,rgba(34,197,94,0.15))] text-[var(--color-success)]',
      };
    case 'env':
      return {
        text: 'Env',
        cls: 'bg-[var(--color-info-soft,rgba(59,130,246,0.15))] text-[var(--color-info,#3b82f6)]',
      };
    default:
      return {
        text: 'Not configured',
        cls: 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)]',
      };
  }
}

export default async function SettingsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const [providers, policy] = await Promise.all([
    listAvailableProviders(session.user.workspaceId),
    getProviderPolicy(session.user.workspaceId),
  ]);
  const copilotConnected = providers.find((p) => p.provider === 'copilot')?.source === 'workspace';
  const copilotUser = copilotConnected ? await loadCopilotIdentity(session.user.workspaceId) : null;
  const codaiConnected = providers.find((p) => p.provider === 'codai')?.source === 'workspace';
  const connectedProviders = providers
    .filter((p) => p.source === 'workspace')
    .map((p) => p.provider);

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Bring your own AI keys. Encrypted at rest." />

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>AI providers</CardTitle>
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {connectedProviders.length} connected
          </span>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {providers.map((p) => {
            const badge = sourceBadge(p.source);
            return (
              <li
                key={p.provider}
                className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2"
              >
                <span className="truncate text-sm font-medium">{providerLabel(p.provider)}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${badge.cls}`}
                >
                  {badge.text}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardTitle>Codai</CardTitle>
        <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
          Your own inference gateway at <code>ai.codai.ro</code> — OpenAI-compatible, with the{' '}
          <code>codai</code> auto-router (thinking, caching & cascade verification baked in). Paste
          a key and it becomes the default for reasoning, agentic, fast, vision & embeddings.
        </p>
        <CodaiConnect connected={codaiConnected} />
      </Card>

      <Card>
        <CardTitle>GitHub Copilot</CardTitle>
        <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
          Connect with device-code OAuth — uses your Copilot subscription (Claude, GPT-4o/5, Gemini,
          …) without managing per-provider keys.
        </p>
        <CopilotConnect connected={copilotConnected} user={copilotUser} />
      </Card>

      <Card>
        <CardTitle>Default models per agent</CardTitle>
        <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
          Pick which provider + model handles each kind of task. Leave on “auto” to use the built-in
          fallback chain.
        </p>
        <ProviderPolicyForm connectedProviders={connectedProviders} policy={policy} />
      </Card>

      <Card>
        <CardTitle>Add provider key (BYOK)</CardTitle>
        <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
          Encrypted with AES-256-GCM and stored per workspace.
        </p>
        <ProviderCredentialForm />
      </Card>

      <Card>
        <CardTitle>Test connected keys</CardTitle>
        <p className="mt-2 mb-3 text-xs text-[var(--color-fg-subtle)]">
          Pings the cheapest list endpoint for each provider with your stored
          credential. Latency is round-trip from this server.
        </p>
        <ProviderKeyTester providers={connectedProviders} />
      </Card>

      <TestNotificationCard />
    </Page>
  );
}
