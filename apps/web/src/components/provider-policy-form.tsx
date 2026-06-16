'use client';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MODEL_CATALOG } from '@metu/ai/models';
import type { AiIntent, AiProvider, ProviderPolicy } from '@metu/types';
import { updateProviderPolicyAction } from '@/app/actions/policy';
import { listCopilotModelsAction, type CopilotModelOption } from '@/app/actions/copilot-models';

const INTENTS: { id: AiIntent; label: string; description: string }[] = [
  {
    id: 'reasoning',
    label: 'Reasoning',
    description: 'Deep, slow thinking — focus engine, project intel',
  },
  {
    id: 'agentic',
    label: 'Agentic',
    description: 'Tool-using chat / agent loops',
  },
  { id: 'fast', label: 'Fast', description: 'Quick classifications, rewrites' },
  {
    id: 'chat',
    label: 'Chat',
    description: 'Conversational replies — Telegram, proactive messages',
  },
  { id: 'vision', label: 'Vision', description: 'Image / screenshot analysis' },
  { id: 'embed', label: 'Embedding', description: 'Memory chunk vectors' },
  { id: 'transcribe', label: 'Transcribe', description: 'Voice notes → text' },
];

interface Props {
  connectedProviders: AiProvider[];
  policy: ProviderPolicy;
}

interface ModelOpt {
  id: string;
  label: string;
}

function copilotModelsForIntent(models: CopilotModelOption[], intent: AiIntent): ModelOpt[] {
  const filtered = models.filter((m) => {
    switch (intent) {
      case 'reasoning':
      case 'agentic':
      case 'fast':
      case 'chat':
        return !m.supportsEmbeddings;
      case 'vision':
        return m.supportsVision;
      case 'embed':
        return m.supportsEmbeddings;
      case 'transcribe':
        return false; // Copilot doesn't expose transcription
      default:
        return false;
    }
  });
  return filtered.map((m) => ({
    id: m.id,
    label: `${m.name}${m.preview ? ' (preview)' : ''} · ${m.vendor}`,
  }));
}

function staticModelsForIntent(provider: AiProvider, intent: AiIntent): ModelOpt[] {
  if (provider === 'copilot') return [];
  return MODEL_CATALOG[provider]
    .filter((m) => m.intents.includes(intent))
    .map((m) => ({ id: m.id, label: m.label }));
}

export function ProviderPolicyForm({ connectedProviders, policy }: Props) {
  const [copilotModels, setCopilotModels] = useState<CopilotModelOption[] | null>(null);
  const [copilotError, setCopilotError] = useState<string | null>(null);

  const copilotConnected = connectedProviders.includes('copilot');

  useEffect(() => {
    if (!copilotConnected) return;
    let active = true;
    void listCopilotModelsAction().then((r) => {
      if (!active) return;
      if (r.ok) setCopilotModels(r.models);
      else setCopilotError(r.error);
    });
    return () => {
      active = false;
    };
  }, [copilotConnected]);

  if (connectedProviders.length === 0) {
    return (
      <p className="mt-3 text-xs text-[var(--color-fg-muted)]">
        Connect at least one provider above to assign defaults.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {copilotError ? (
        <p className="text-xs text-[var(--color-warning)]">Copilot model list: {copilotError}</p>
      ) : null}
      {INTENTS.map((i) => (
        <PolicyRow
          key={i.id}
          intent={i.id}
          label={i.label}
          description={i.description}
          connectedProviders={connectedProviders}
          entry={policy[i.id]}
          copilotModels={copilotModels}
        />
      ))}
    </div>
  );
}

function PolicyRow({
  intent,
  label,
  description,
  connectedProviders,
  entry,
  copilotModels,
}: {
  intent: AiIntent;
  label: string;
  description: string;
  connectedProviders: AiProvider[];
  entry?: { provider: AiProvider; model?: string };
  copilotModels: CopilotModelOption[] | null;
}) {
  const [provider, setProvider] = useState<AiProvider | ''>(entry?.provider ?? '');
  const [model, setModel] = useState<string>(entry?.model ?? '');
  const [pending, start] = useTransition();

  const baseModels: ModelOpt[] = !provider
    ? []
    : provider === 'copilot'
      ? copilotModelsForIntent(copilotModels ?? [], intent)
      : staticModelsForIntent(provider, intent);

  const models: ModelOpt[] =
    model && !baseModels.some((m) => m.id === model)
      ? [{ id: model, label: `${model} (saved)` }, ...baseModels]
      : baseModels;

  const loadingCopilot = provider === 'copilot' && copilotModels === null;

  function save(nextProvider: AiProvider | '', nextModel: string) {
    start(async () => {
      const r = await updateProviderPolicyAction({
        intent,
        provider: nextProvider === '' ? null : nextProvider,
        model: nextModel || null,
      });
      if (!r.ok) toast.error(r.error ?? 'Failed');
    });
  }

  return (
    <div className="bg-[var(--color-bg-elevated)]/40 grid items-center gap-3 rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2.5 md:grid-cols-[200px_minmax(140px,1fr)_minmax(180px,1.4fr)]">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-[var(--color-fg-subtle)]">{description}</p>
      </div>
      <select
        value={provider}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value as AiProvider | '';
          setProvider(v);
          setModel('');
          save(v, '');
        }}
        className="focus:ring-[var(--color-accent,var(--color-fg))]/30 h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
      >
        <option value="">— auto (fallback) —</option>
        {connectedProviders.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <select
        value={model}
        disabled={pending || !provider || loadingCopilot}
        onChange={(e) => {
          const v = e.target.value;
          setModel(v);
          save(provider, v);
        }}
        className="focus:ring-[var(--color-accent,var(--color-fg))]/30 h-9 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
      >
        <option value="">
          {!provider ? '—' : loadingCopilot ? 'loading…' : 'default for provider'}
        </option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
