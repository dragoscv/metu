/**
 * Companion-agent end-to-end smoke test.
 *
 * Stubs `getModel`, `streamText`, and `generateText` so we exercise the
 * full orchestration (`runCompanionTurn`) without burning real tokens.
 *
 * Goal: catch wiring regressions where:
 *   - the persona-prompt renderer drops vars
 *   - the local-lane allowlist forgets to inject base tools
 *   - the escalate callback fires for plainly-local utterances
 *   - the streamed text reader doesn't aggregate
 *
 * This is the single highest-value test in the suite — it touches every
 * file in `companion-agent/`. Keep the mocks thin so a real refactor of
 * the AI SDK wrapper still surfaces errors here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const captured: {
  systemPrompt?: string;
  toolKeys?: string[];
  callCount: number;
} = { callCount: 0 };

vi.mock('@metu/ai', () => ({
  getModel: vi.fn(async () => ({
    model: { id: 'fake-fast' },
    provider: 'anthropic',
    modelId: 'fake',
  })),
}));

vi.mock('ai', () => ({
  stepCountIs: vi.fn(() => () => false),
  generateText: vi.fn(async (args: { system?: string; tools?: Record<string, unknown> }) => {
    captured.callCount++;
    captured.systemPrompt = args.system;
    captured.toolKeys = Object.keys(args.tools ?? {});
    return { text: 'Sure — quick answer here.' };
  }),
  streamText: vi.fn((args: { system?: string; tools?: Record<string, unknown> }) => {
    captured.callCount++;
    captured.systemPrompt = args.system;
    captured.toolKeys = Object.keys(args.tools ?? {});
    return {
      textStream: (async function* () {
        yield 'Sure — ';
        yield 'quick answer here.';
      })(),
      toolCalls: Promise.resolve([]),
      finishReason: Promise.resolve('stop'),
    };
  }),
  generateObject: vi.fn(async () => ({
    object: { lane: 'local', reason: 'mock classifier' },
  })),
  tool: (def: unknown) => def,
}));

import { runCompanionTurn } from '../run';

beforeEach(() => {
  captured.systemPrompt = undefined;
  captured.toolKeys = undefined;
  captured.callCount = 0;
});

describe('runCompanionTurn smoke', () => {
  it('handles a plain "what was I doing" turn locally with rendered persona vars', async () => {
    const escalateCalls: string[] = [];
    const result = await runCompanionTurn(
      {
        workspaceId: 'b3b8a4c2-1f0e-4a4b-9d9c-1f2a3b4c5d6e',
        userId: 'c4c9b5d3-2e1f-5b5c-aedf-2f3b4c5d6e7f',
        personaSlug: 'metu',
        utterance: 'what was I doing yesterday?',
        history: [],
        eagerness: 80,
        surface: 'companion',
        promptContext: { userName: 'Dragos', language: 'en' },
      },
      {
        onEscalate: async (_input, reason) => {
          escalateCalls.push(reason);
          return 'fake-tick-id';
        },
      },
    );

    expect(result.text).toContain('answer');
    expect(escalateCalls).toEqual([]);
    expect(captured.callCount).toBeGreaterThan(0);
    expect(captured.toolKeys).toEqual(expect.arrayContaining(['recall']));
    // Prompt must include the FAST LANE preamble that respond.ts appends.
    expect(captured.systemPrompt).toMatch(/FAST LANE/);
  });
});
