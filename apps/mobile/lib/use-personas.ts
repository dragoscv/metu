/**
 * Workspace persona catalogue for mobile — fetches from
 * /api/sdk/v1/presence/personas (bearer + presence:talk scope) and
 * falls back to BUILT_IN_PERSONAS when the request fails so the screen
 * is never empty.
 *
 * Matches the pet/hud companion hook so a persona created on web shows
 * up identically on mobile.
 */
import { useEffect, useState } from 'react';
import { BUILT_IN_PERSONAS } from '@metu/presence';
import { getToken } from './api';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://app.metu.ro';

export type CostTier = 'budget' | 'balanced' | 'premium';
export type BillingTier = 'free' | 'starter' | 'pro' | 'pro_plus' | 'enterprise';

export interface VoiceCap {
  spentUsd: number;
  capUsd: number;
  soft: boolean;
  hard: boolean;
  unlimited: boolean;
}

export interface MobilePersona {
  slug: string;
  name: string;
  language: string;
  voiceProvider: string;
  defaultForm: 'panel' | 'in_window' | 'hud' | 'pet' | undefined;
  costTier: CostTier;
  wakeWord?: string;
}

const FALLBACK: MobilePersona[] = BUILT_IN_PERSONAS.map((p) => ({
  slug: p.slug,
  name: p.name,
  language: p.language,
  voiceProvider: p.voiceProvider,
  defaultForm: undefined,
  costTier: 'balanced',
  wakeWord: undefined,
}));

export function usePersonas(): {
  personas: MobilePersona[];
  loading: boolean;
  billingTier: BillingTier;
  voiceCap: VoiceCap | null;
  quietActive: boolean;
} {
  const [personas, setPersonas] = useState<MobilePersona[]>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [billingTier, setBillingTier] = useState<BillingTier>('free');
  const [voiceCap, setVoiceCap] = useState<VoiceCap | null>(null);
  const [quietActive, setQuietActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setLoading(false);
          return;
        }
        const r = await fetch(`${BASE}/api/sdk/v1/presence/personas`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`personas ${r.status}`);
        const json = (await r.json()) as {
          personas: MobilePersona[];
          billingTier?: BillingTier;
          voiceCap?: VoiceCap;
          quietActive?: boolean;
        };
        if (!cancelled && Array.isArray(json.personas) && json.personas.length > 0) {
          setPersonas(json.personas);
        }
        if (!cancelled && json.billingTier) setBillingTier(json.billingTier);
        if (!cancelled && json.voiceCap) setVoiceCap(json.voiceCap);
        if (!cancelled && typeof json.quietActive === 'boolean') setQuietActive(json.quietActive);
      } catch {
        // Keep the fallback list silently — UI-side log noise isn't worth it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { personas, loading, billingTier, voiceCap, quietActive };
}

/** Prefer HUD-form personas on mobile (small screen overlay-ish UX). */
export function pickMobilePersonas(personas: MobilePersona[]): MobilePersona[] {
  const hud = personas.filter((p) => p.defaultForm === 'hud');
  if (hud.length > 0) return hud;
  return personas.filter((p) => p.voiceProvider !== 'none');
}
