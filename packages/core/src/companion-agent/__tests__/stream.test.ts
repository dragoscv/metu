/**
 * @vitest-environment node
 *
 * Tests the streaming orchestrator (`streamCompanionTurn`) which powers
 * the realtime / pipeline NDJSON path. We mock both `@metu/ai` (so no
 * model calls leave the test) and the `ai` SDK helpers to make the
 * generators deterministic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@metu/ai', () => ({
  getModel: vi.fn(() => ({})),
}));

const mockedGenerateObject = vi.fn();
const mockedStreamText = vi.fn();
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: (...args: unknown[]) => mockedStreamText(...args),
  generateObject: (...args: unknown[]) => mockedGenerateObject(...args),
  tool: (def: unknown) => def,
  stepCountIs: vi.fn(() => true),
}));

import { streamCompanionTurn, type CompanionStreamEvent } from '../run';

const baseInput = {
  workspaceId: 'b3b8a4c2-1f0e-4a4b-9d9c-1f2a3b4c5d6e',
  userId: 'c4c9b5d3-2e1f-4b5c-aeae-2e3f4a5b6c7d',
  personaSlug: 'metu',
  utterance: 'hello',
  history: [],
  eagerness: 50,
  surface: 'companion' as const,
};

async function collect(gen: AsyncGenerator<CompanionStreamEvent>): Promise<CompanionStreamEvent[]> {
  const out: CompanionStreamEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe('streamCompanionTurn', () => {
  beforeEach(() => {
    mockedGenerateObject.mockReset();
    mockedStreamText.mockReset();
  });

  it('escalate path: emits triage → ack → escalated and calls onEscalate', async () => {
    // utterance "schedule a meeting" hits the heuristic escalate keyword.
    const onEscalate = vi.fn(async () => 'evt_abc');
    const events = await collect(
      streamCompanionTurn(
        { ...baseInput, utterance: 'schedule a meeting tomorrow at 3pm' },
        { onEscalate },
      ),
    );
    expect(events.map((e) => e.type)).toEqual(['triage', 'ack', 'escalated']);
    const escalated = events.find((e) => e.type === 'escalated');
    expect(escalated).toMatchObject({ type: 'escalated', eventId: 'evt_abc' });
    expect(onEscalate).toHaveBeenCalledOnce();
    // Classifier must NOT be called when the heuristic fires.
    expect(mockedGenerateObject).not.toHaveBeenCalled();
    // streamText must NOT be called for an escalated turn.
    expect(mockedStreamText).not.toHaveBeenCalled();
  });

  it('local path: emits triage → delta(s) → final and never calls onEscalate', async () => {
    const chunks = ['Hi', ' there', '!'];
    mockedStreamText.mockReturnValue({
      textStream: (async function* () {
        for (const c of chunks) yield c;
      })(),
      // streamLocal awaits these promises after the textStream drains.
      text: Promise.resolve('Hi there!'),
      steps: Promise.resolve([]),
    });
    const onEscalate = vi.fn(async () => 'evt_should_not_fire');
    const events = await collect(
      streamCompanionTurn({ ...baseInput, utterance: 'hi' }, { onEscalate }),
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('triage');
    expect(types.at(-1)).toBe('final');
    const deltas = events.filter(
      (e): e is Extract<CompanionStreamEvent, { type: 'delta' }> => e.type === 'delta',
    );
    expect(deltas.map((d) => d.text)).toEqual(chunks);
    const final = events.find(
      (e): e is Extract<CompanionStreamEvent, { type: 'final' }> => e.type === 'final',
    );
    expect(final?.text).toBe('Hi there!');
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it('always emits a terminal event when streamLocal throws', async () => {
    // "tell me a story" hits no escalate keyword → goes local → streamLocal
    // is invoked. Make it explode and assert we still terminate cleanly.
    mockedStreamText.mockImplementationOnce(() => {
      throw new Error('upstream model down');
    });
    const events = await collect(
      streamCompanionTurn(
        { ...baseInput, utterance: 'tell me a long story about ferrets', eagerness: 50 },
        {},
      ),
    );
    const terminal = events.at(-1);
    expect(terminal?.type).toMatch(/^(final|escalated|error)$/);
    expect(events[0]?.type).toBe('triage');
  });
});
