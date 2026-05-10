/**
 * Multi-provider AI registry with BYOK + intent routing.
 *
 * Usage:
 *   const model = await getModel({ workspaceId, intent: 'reasoning' });
 *   const { text } = await generateText({ model, prompt });
 *
 * Routing:
 *   1. Per-workspace policy in workspace.providerPolicy[intent] picks provider.
 *   2. If a workspace BYOK credential exists for that provider → use it.
 *   3. Else fall back to env-level credentials.
 *   4. On error, walk a fallback chain.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { providerCredential, workspace } from '@metu/db/schema';
import type { AiIntent, AiProvider } from '@metu/types';
import type { LanguageModel } from 'ai';
import { open } from './crypto';
import { copilotFetch, getCopilotSession } from './copilot';

// ─── Default model per (provider, intent) ──────────────────────────────────

const DEFAULTS: Record<AiProvider, Partial<Record<AiIntent, string>>> = {
  anthropic: {
    reasoning: 'claude-opus-4-5',
    agentic: 'claude-sonnet-4-5',
    fast: 'claude-haiku-4',
    vision: 'claude-sonnet-4-5',
  },
  openai: {
    reasoning: 'gpt-5',
    agentic: 'gpt-5',
    fast: 'gpt-4o-mini',
    embed: 'text-embedding-3-small',
    transcribe: 'whisper-1',
    vision: 'gpt-4o',
  },
  azure_openai: {
    reasoning: 'gpt-5',
    agentic: 'gpt-5',
    fast: 'gpt-4o-mini',
    embed: 'text-embedding-3-small',
    vision: 'gpt-4o',
  },
  google: {
    reasoning: 'gemini-2.5-pro',
    agentic: 'gemini-2.5-pro',
    fast: 'gemini-2.5-flash',
    vision: 'gemini-2.5-pro',
    embed: 'text-embedding-004',
  },
  vertex: {
    reasoning: 'gemini-2.5-pro',
    fast: 'gemini-2.5-flash',
  },
  copilot: {
    // GitHub Copilot LLM proxy. The DB credential stores a GitHub OAuth
    // token (sealed); on each call we exchange it for a short-lived Copilot
    // session token. Models below are advertised by the Copilot API.
    reasoning: 'claude-sonnet-4',
    agentic: 'claude-sonnet-4',
    fast: 'gpt-4o-mini',
    vision: 'gpt-4o',
    embed: 'text-embedding-3-small',
  },
  ollama: {
    embed: 'nomic-embed-text',
    fast: 'llama3.2',
  },
  custom: {},
  // Voice providers — no LLM intents. Empty maps so DEFAULTS matches the
  // AiProvider union (extended for BYOK voice keys in slice 5b).
  deepgram: {},
  cartesia: {},
  elevenlabs: {},
};

const FALLBACK_CHAIN: Record<AiIntent, AiProvider[]> = {
  reasoning: ['copilot', 'anthropic', 'openai', 'google', 'azure_openai'],
  agentic: ['copilot', 'anthropic', 'openai', 'google', 'azure_openai'],
  fast: ['copilot', 'google', 'openai', 'anthropic', 'azure_openai'],
  embed: ['openai', 'azure_openai', 'google', 'ollama'],
  transcribe: ['openai', 'google'],
  vision: ['copilot', 'anthropic', 'openai', 'google'],
};

// ─── Credential resolution ─────────────────────────────────────────────────

async function loadWorkspacePolicy(workspaceId: string) {
  const db = getDb();
  const [ws] = await db
    .select({ providerPolicy: workspace.providerPolicy })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const raw = (ws?.providerPolicy ?? {}) as Record<string, unknown>;
  // Backward-compat: legacy values were plain provider strings; normalize to
  // { provider, model? } objects.
  const out: Partial<Record<AiIntent, { provider: AiProvider; model?: string }>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') {
      out[k as AiIntent] = { provider: v as AiProvider };
    } else if (v && typeof v === 'object' && 'provider' in v) {
      const o = v as { provider: AiProvider; model?: string };
      out[k as AiIntent] = { provider: o.provider, model: o.model };
    }
  }
  return out;
}

async function loadWorkspaceCredential(workspaceId: string, provider: AiProvider) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(providerCredential)
    .where(
      and(
        eq(providerCredential.workspaceId, workspaceId),
        eq(providerCredential.provider, provider),
      ),
    )
    .orderBy(desc(providerCredential.isDefault))
    .limit(1);
  if (!row) return null;
  return {
    apiKey: open({
      ciphertext: row.apiKeyCiphertext,
      iv: row.apiKeyIv,
      tag: row.apiKeyTag,
    }),
    endpoint: row.endpoint,
    defaultModel: row.defaultModel,
    config: row.config as Record<string, unknown>,
  };
}

interface ResolvedCredential {
  apiKey: string;
  endpoint?: string | null;
  defaultModel?: string | null;
  config: Record<string, unknown>;
  source: 'workspace';
}

async function resolveCredential(
  workspaceId: string,
  provider: AiProvider,
): Promise<ResolvedCredential | null> {
  const ws = await loadWorkspaceCredential(workspaceId, provider);
  if (ws) return { ...ws, source: 'workspace' };
  // No env fallback for AI provider keys — credentials must be added per
  // workspace via Settings → AI providers (BYOK), then sealed in the DB.
  return null;
}

/**
 * Public alias of `resolveCredential` for callers outside the model factory
 * (e.g. the voice token broker, which needs to mint a provider-side
 * ephemeral session and never returns the BYOK key to the client).
 */
export const getProviderCredential = resolveCredential;
export type { ResolvedCredential };

// ─── Model factory ─────────────────────────────────────────────────────────

export interface GetModelInput {
  workspaceId: string;
  intent: AiIntent;
  /** Force a specific provider, ignoring policy. */
  provider?: AiProvider;
  /** Override the default model name. */
  model?: string;
}

export interface ResolvedModel {
  provider: AiProvider;
  modelId: string;
  /**
   * AI SDK model handle — pass to generateText/streamText/generateObject.
   * For embed-intent calls cast to the embedding-model parameter shape;
   * see `packages/core/src/memory/index.ts` for the pattern.
   */
  model: LanguageModel;
  source: 'workspace';
}

export async function getModel(input: GetModelInput): Promise<ResolvedModel> {
  const policy = await loadWorkspacePolicy(input.workspaceId);
  const policyEntry = policy[input.intent];
  const requested = input.provider ?? policyEntry?.provider ?? FALLBACK_CHAIN[input.intent][0];

  const chain: AiProvider[] = [...new Set([requested!, ...FALLBACK_CHAIN[input.intent]])];

  for (const provider of chain) {
    const cred = await resolveCredential(input.workspaceId, provider);
    if (!cred) continue;
    // Model precedence: explicit input > policy override (when provider matches) >
    // credential default > catalog default.
    const policyModel =
      policyEntry && policyEntry.provider === provider ? policyEntry.model : undefined;
    const modelId =
      input.model ?? policyModel ?? cred.defaultModel ?? DEFAULTS[provider][input.intent];
    if (!modelId) continue;
    try {
      const model = instantiate(provider, cred, modelId, input.intent);
      // Embed-intent paths produce embedding models; callers cast back to
      // EmbeddingModel via the AI SDK's parameter shape (see memory/index.ts).
      // The widened public type is LanguageModel for the common path.
      return { provider, modelId, model: model as LanguageModel, source: cred.source };
    } catch (err) {
      console.warn(`[ai] provider ${provider} failed to instantiate`, err);
    }
  }
  throw new Error(
    `No AI provider configured for intent '${input.intent}'. Add a provider key in Settings → AI providers (BYOK) for workspace ${input.workspaceId}.`,
  );
}

function instantiate(
  provider: AiProvider,
  cred: ResolvedCredential,
  modelId: string,
  intent: AiIntent,
) {
  switch (provider) {
    case 'anthropic': {
      const client = createAnthropic({ apiKey: cred.apiKey });
      return client(modelId);
    }
    case 'openai': {
      const client = createOpenAI({ apiKey: cred.apiKey });
      if (intent === 'embed') return client.textEmbedding(modelId);
      return client(modelId);
    }
    case 'azure_openai': {
      if (!cred.endpoint) throw new Error('Azure OpenAI requires endpoint');
      const client = createAzure({
        apiKey: cred.apiKey,
        baseURL: cred.endpoint,
      });
      if (intent === 'embed') return client.textEmbedding(modelId);
      return client(modelId);
    }
    case 'google':
    case 'vertex': {
      const client = createGoogleGenerativeAI({ apiKey: cred.apiKey });
      if (intent === 'embed') return client.textEmbedding(modelId);
      return client(modelId);
    }
    case 'copilot': {
      // cred.apiKey is the sealed GitHub OAuth token. Resolve a Copilot
      // session synchronously here for the baseURL; the fetch wrapper
      // ensures every subsequent call has a fresh, valid bearer.
      const ghToken = cred.apiKey;
      // Fire-and-forget warmup so the first request doesn't pay token cost.
      void getCopilotSession(ghToken).catch(() => {});
      const baseURL =
        (cred.config as { endpoint?: string })?.endpoint ??
        'https://api.individual.githubcopilot.com';
      const client = createOpenAI({
        apiKey: 'copilot', // ignored; real bearer is set by copilotFetch
        baseURL,
        fetch: copilotFetch(ghToken) as typeof fetch,
      });
      if (intent === 'embed') return client.textEmbedding(modelId);
      // Copilot only speaks Chat Completions, not the new Responses API.
      return client.chat(modelId);
    }
    case 'ollama':
      throw new Error('Ollama provider not yet wired (V2).');
    case 'custom':
      throw new Error('Custom provider not yet wired.');
  }
}

// ─── Convenience: list usable providers in a workspace ─────────────────────

export async function listAvailableProviders(workspaceId: string) {
  const providers: AiProvider[] = [
    'anthropic',
    'openai',
    'azure_openai',
    'google',
    'vertex',
    'copilot',
    'ollama',
  ];
  const out: { provider: AiProvider; source: 'workspace' | 'none' }[] = [];
  for (const p of providers) {
    const cred = await resolveCredential(workspaceId, p);
    out.push({ provider: p, source: cred?.source ?? 'none' });
  }
  return out;
}

/** Read the normalized provider policy for a workspace. */
export async function getProviderPolicy(workspaceId: string) {
  return loadWorkspacePolicy(workspaceId);
}
