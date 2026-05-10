/**
 * Workspace-aware persona fetch for the companion forms.
 *
 * Built-in personas are baked into `@metu/presence`; users can also create
 * their own (with custom wake words, voices, languages) via the web persona
 * editor. The companion needs the merged list so each persona can answer to
 * its OWN wake word — not just the built-ins.
 *
 * Cached in module scope per session; cleared on auth change by the
 * caller (Pet/Hud re-mount when accessToken changes, which re-runs the
 * effect and re-fetches).
 */
import { useEffect, useReducer, useState } from 'react';
import { BUILT_IN_PERSONAS } from '@metu/presence';
import type { BillingTier } from '@metu/voice';
import type { AuthState } from './auth';

export interface CompanionPersona {
  slug: string;
  name: string;
  voiceProvider: string;
  avatarKind: string;
  avatarUrl: string | null;
  defaultForm: 'panel' | 'in_window' | 'hud' | 'pet';
  wakeWord: string | null;
  hotkey: string | null;
  language: string;
  costTier: 'budget' | 'balanced' | 'premium';
  mode: string;
  isBuiltIn: boolean;
}

const FALLBACK: CompanionPersona[] = BUILT_IN_PERSONAS.map((p) => ({
  slug: p.slug,
  name: p.name,
  voiceProvider: p.voiceProvider,
  avatarKind: p.avatarKind,
  avatarUrl: p.avatarUrl ?? null,
  defaultForm: p.defaultForm,
  wakeWord: p.wakeWord ?? null,
  hotkey: p.hotkey ?? null,
  language: p.language,
  costTier: p.costTier,
  mode: p.mode,
  isBuiltIn: true,
}));

export function usePersonas(auth: AuthState | null): CompanionPersona[] {
  const [list, setList] = useState<CompanionPersona[]>(FALLBACK);
  const accessToken = auth?.accessToken;
  const apiBase = auth?.apiBase;
  useEffect(() => {
    if (!accessToken || !apiBase) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/api/sdk/v1/presence/personas`, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok: boolean;
          personas?: CompanionPersona[];
          billingTier?: BillingTier;
        };
        if (!cancelled && json.ok && json.personas?.length) {
          setList(json.personas);
          if (json.billingTier) currentBillingTier = json.billingTier;
        }
      } catch (err) {
        console.warn('[personas] fetch failed, falling back to built-ins', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, apiBase]);
  return list;
}

// Module-scope cache so wake-word hooks anywhere in the tree can read the
// resolved tier without each recomputing it. Defaults to 'free' (most
// restrictive) until the personas fetch lands.
let currentBillingTier: BillingTier = 'free';

export function useBillingTier(): BillingTier {
  const [tier, setTier] = useState<BillingTier>(currentBillingTier);
  useEffect(() => {
    // Cheap polling — tier rarely changes; this catches the personas fetch
    // landing after the consumer mounted.
    const t = setInterval(() => {
      if (tier !== currentBillingTier) setTier(currentBillingTier);
    }, 1000);
    return () => clearInterval(t);
  }, [tier]);
  return tier;
}

export function pickPetPersona(personas: CompanionPersona[]): CompanionPersona {
  return (
    personas.find((p) => p.slug === 'metu') ??
    personas.find((p) => p.defaultForm === 'pet' && p.voiceProvider !== 'none') ??
    personas[0]!
  );
}

export function pickHudPersona(personas: CompanionPersona[]): CompanionPersona {
  return (
    personas.find((p) => p.defaultForm === 'hud') ??
    personas.find((p) => p.voiceProvider !== 'none') ??
    personas[0]!
  );
}

// ---------------------------------------------------------------------------
// Persona override
//
// The Conductor (or anything else) can call `setPersonaOverride(form, slug)`
// to swap the persona currently shown in a given window. Forms subscribe via
// `useResolvedPersona(form, personas)` and re-render when the override
// changes. `null` clears the override and the form falls back to its picker.
// ---------------------------------------------------------------------------
export type PersonaForm = 'pet' | 'hud' | 'panel';

const overrides: Partial<Record<PersonaForm, string>> = {};
const overrideListeners = new Set<() => void>();

export function setPersonaOverride(form: PersonaForm, slug: string | null): void {
  if (slug === null) {
    delete overrides[form];
  } else {
    overrides[form] = slug;
  }
  for (const fn of overrideListeners) fn();
}

export function getPersonaOverride(form: PersonaForm): string | null {
  return overrides[form] ?? null;
}

export function _resetPersonaOverridesForTest(): void {
  for (const k of Object.keys(overrides) as PersonaForm[]) delete overrides[k];
  overrideListeners.clear();
}

export function useResolvedPersona(
  form: PersonaForm,
  personas: CompanionPersona[],
): CompanionPersona {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    overrideListeners.add(force);
    return () => {
      overrideListeners.delete(force);
    };
  }, []);
  const slug = overrides[form];
  if (slug) {
    const found = personas.find((p) => p.slug === slug);
    if (found) return found;
  }
  if (form === 'pet') return pickPetPersona(personas);
  if (form === 'hud') return pickHudPersona(personas);
  return personas[0]!;
}
