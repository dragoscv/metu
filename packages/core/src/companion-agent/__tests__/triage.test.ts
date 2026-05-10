/**
 * Triage heuristic table tests.
 *
 * The LLM classifier branch is mocked at the module level so these
 * tests only exercise the deterministic short-circuits + eagerness
 * gating logic. Anything that would hit the network is treated as a
 * test failure (we want triage to be predictable for hot paths).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@metu/ai', () => ({
  getModel: vi.fn(async () => {
    throw new Error('classifier should not have been called in heuristic tests');
  }),
}));

vi.mock('ai', () => ({
  generateObject: vi.fn(async () => {
    throw new Error('generateObject should not have been called in heuristic tests');
  }),
  streamText: vi.fn(),
  generateText: vi.fn(),
  tool: vi.fn(),
}));

import { triageTurn, HEURISTIC_ESCALATE_KEYWORDS } from '../triage';
import type { CompanionTurnInput } from '../types';

const base: Omit<CompanionTurnInput, 'utterance'> = {
  workspaceId: '00000000-0000-0000-0000-000000000000',
  userId: '00000000-0000-0000-0000-000000000001',
  personaSlug: 'metu',
  history: [],
  eagerness: 50,
  surface: 'companion',
};

describe('triageTurn — heuristics', () => {
  it('treats short greetings as local', async () => {
    for (const greeting of ['hi', 'hello', 'hey', 'thanks', 'cool', 'okay']) {
      const t = await triageTurn({ ...base, utterance: greeting });
      expect(t.lane, `for "${greeting}"`).toBe('local');
      expect(t.source).toBe('heuristic');
    }
  });

  it.each(HEURISTIC_ESCALATE_KEYWORDS.slice(0, 8))(
    'escalates when keyword "%s" appears',
    async (kw) => {
      const t = await triageTurn({ ...base, utterance: `please ${kw} that for me` });
      expect(t.lane).toBe('escalate');
      expect(t.source).toBe('heuristic');
      expect(t.reason.toLowerCase()).toContain(kw.toLowerCase());
    },
  );

  it('escalates utterances longer than 600 chars', async () => {
    const long = 'a'.repeat(700);
    const t = await triageTurn({ ...base, utterance: long });
    expect(t.lane).toBe('escalate');
    expect(t.reason).toMatch(/long utterance/i);
  });

  it('eagerness ≥75 stays local when no keyword fires', async () => {
    const t = await triageTurn({
      ...base,
      eagerness: 80,
      utterance: 'something neutral happens here without any trigger words',
    });
    expect(t.lane).toBe('local');
    expect(t.source).toBe('heuristic');
  });

  it('treats empty utterance as local (no work)', async () => {
    const t = await triageTurn({ ...base, utterance: '   ' });
    // Schema enforces min(1) so '   ' is allowed only because schema isn't
    // applied at triage layer; heuristic still resolves as local.
    expect(t.lane).toBe('local');
  });
});
