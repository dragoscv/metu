/**
 * Wake-word routing — picks the wake provider chain for a persona.
 *
 * Companion-Agent slice 4. Mirrors `router.ts`. Inputs come from the
 * persona record + environment (which optional deps the host has wired).
 *
 * Decision logic:
 *   - Persona has no `wakeWord` → no chain (caller never starts a wake loop).
 *   - `costTier === 'premium'` AND porcupine wired → porcupine first
 *     (lowest latency, best accuracy, paid Picovoice tier).
 *   - Otherwise → openWakeWord first (free, on-device, MIT) with porcupine
 *     as fallback only when wired.
 *   - When neither runner is wired the chain is empty and the host should
 *     fall back to the global hotkey accelerator.
 */
import type { WakeProviderId } from './types';
import type { BillingTier, CostTier } from './router';

export type WakeRouteInput = {
  /** Per-persona wake word; null disables wake entirely. */
  word: string | null;
  costTier: CostTier;
  /** Workspace billing tier. Porcupine requires `pro` or higher. */
  billingTier?: BillingTier;
  /** True when @picovoice/porcupine-web is installed AND access key set. */
  hasPorcupine: boolean;
  /** True when an openWakeWord ONNX runner is registered. */
  hasOpenWakeWord: boolean;
};

const PORCUPINE_TIERS = new Set<BillingTier>(['pro', 'pro_plus', 'enterprise']);

export function pickWakeRoute(input: WakeRouteInput): WakeProviderId[] {
  if (!input.word) return [];
  const tier = input.billingTier ?? 'free';
  const porcupineAllowed = input.hasPorcupine && PORCUPINE_TIERS.has(tier);
  const chain: WakeProviderId[] = [];
  const preferPorcupine = input.costTier === 'premium' && porcupineAllowed;
  if (preferPorcupine) {
    chain.push('porcupine');
    if (input.hasOpenWakeWord) chain.push('open-wake-word');
    return chain;
  }
  if (input.hasOpenWakeWord) chain.push('open-wake-word');
  if (porcupineAllowed) chain.push('porcupine');
  return chain;
}
