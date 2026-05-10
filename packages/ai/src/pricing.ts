/**
 * Token-usage → USD pricing.
 *
 * Used to populate `message.cost_usd` and `tool_call.estimated_cost_usd` so
 * the /metu dashboard, daily caps, and per-run telemetry reflect actual spend.
 *
 * Rates are USD per 1,000,000 tokens (input / output). Conservative rounding;
 * keep entries lowercase and match by `startsWith` against the model id.
 *
 * `copilot` and `ollama` are subscription / local — treated as $0.
 * Unknown provider+model pairs return $0 (better than guessing).
 */
import type { AiProvider } from '@metu/types';

export interface UsageLike {
  inputTokens?: number | null | undefined;
  outputTokens?: number | null | undefined;
}

interface Rate {
  /** Match by id.startsWith(prefix); first match wins. Order matters. */
  prefix: string;
  inUsdPerM: number;
  outUsdPerM: number;
}

const RATES: Partial<Record<AiProvider, Rate[]>> = {
  anthropic: [
    { prefix: 'claude-opus-4', inUsdPerM: 15, outUsdPerM: 75 },
    { prefix: 'claude-sonnet-4', inUsdPerM: 3, outUsdPerM: 15 },
    { prefix: 'claude-haiku-4', inUsdPerM: 0.8, outUsdPerM: 4 },
    { prefix: 'claude-3-7-sonnet', inUsdPerM: 3, outUsdPerM: 15 },
    { prefix: 'claude-3-5-sonnet', inUsdPerM: 3, outUsdPerM: 15 },
    { prefix: 'claude-3-5-haiku', inUsdPerM: 0.8, outUsdPerM: 4 },
  ],
  openai: [
    { prefix: 'gpt-5-mini', inUsdPerM: 0.25, outUsdPerM: 2 },
    { prefix: 'gpt-5', inUsdPerM: 1.25, outUsdPerM: 10 },
    { prefix: 'gpt-4.1', inUsdPerM: 2, outUsdPerM: 8 },
    { prefix: 'gpt-4o-mini', inUsdPerM: 0.15, outUsdPerM: 0.6 },
    { prefix: 'gpt-4o', inUsdPerM: 2.5, outUsdPerM: 10 },
    { prefix: 'o3-mini', inUsdPerM: 1.1, outUsdPerM: 4.4 },
    { prefix: 'o3', inUsdPerM: 2, outUsdPerM: 8 },
    { prefix: 'text-embedding-3-large', inUsdPerM: 0.13, outUsdPerM: 0 },
    { prefix: 'text-embedding-3-small', inUsdPerM: 0.02, outUsdPerM: 0 },
  ],
  azure_openai: [
    { prefix: 'gpt-5-mini', inUsdPerM: 0.25, outUsdPerM: 2 },
    { prefix: 'gpt-5', inUsdPerM: 1.25, outUsdPerM: 10 },
    { prefix: 'gpt-4o-mini', inUsdPerM: 0.15, outUsdPerM: 0.6 },
    { prefix: 'gpt-4o', inUsdPerM: 2.5, outUsdPerM: 10 },
  ],
  google: [
    { prefix: 'gemini-2.5-pro', inUsdPerM: 1.25, outUsdPerM: 10 },
    { prefix: 'gemini-2.5-flash', inUsdPerM: 0.3, outUsdPerM: 2.5 },
    { prefix: 'gemini-2.0-flash', inUsdPerM: 0.075, outUsdPerM: 0.3 },
  ],
  vertex: [
    { prefix: 'gemini-2.5-pro', inUsdPerM: 1.25, outUsdPerM: 10 },
    { prefix: 'gemini-2.5-flash', inUsdPerM: 0.3, outUsdPerM: 2.5 },
  ],
};

/**
 * Estimate the USD cost of a single LLM call given the provider, model id,
 * and the SDK's usage object. Returns `null` when no rate is known so callers
 * can distinguish "free / unmetered" (copilot, ollama) from "actually 0".
 */
export function estimateCostUsd(
  provider: AiProvider | string | null | undefined,
  modelId: string | null | undefined,
  usage: UsageLike | null | undefined,
): number | null {
  if (!provider || !modelId || !usage) return null;
  // Subscription / local — no per-token cost to attribute.
  if (provider === 'copilot' || provider === 'ollama' || provider === 'custom') return 0;
  const rates = RATES[provider as AiProvider];
  if (!rates) return null;
  const id = modelId.toLowerCase();
  const rate = rates.find((r) => id.startsWith(r.prefix));
  if (!rate) return null;
  const inTok = usage.inputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  const cost = (inTok * rate.inUsdPerM + outTok * rate.outUsdPerM) / 1_000_000;
  // Round to 6 decimals to keep telemetry stable.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
