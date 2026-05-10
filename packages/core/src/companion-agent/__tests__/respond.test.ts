/**
 * `respondLocal` tool-allowlist test.
 *
 * Ensures the fast lane only exposes read-only tools to the model and
 * never accidentally leaks a mutating tool (e.g. `create_task`,
 * `notify_user`, `external_invoke`).
 *
 * Strategy: stub `getModel` to return a fake model and stub
 * `generateText` to capture the `tools` arg, then assert its keys.
 */
import { describe, expect, it, vi } from 'vitest';

const captured: { tools?: Record<string, unknown> } = {};

vi.mock('@metu/ai', () => ({
  getModel: vi.fn(async () => ({
    model: { id: 'fake-fast' },
    provider: 'anthropic',
    modelId: 'fake',
  })),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(async (args: { tools?: Record<string, unknown> }) => {
    captured.tools = args.tools;
    return { text: 'ok' };
  }),
  streamText: vi.fn(),
  tool: (def: unknown) => def,
}));

import { respondLocal } from '../respond';

describe('respondLocal', () => {
  it('exposes only the read-only allowlist to the model', async () => {
    await respondLocal({
      workspaceId: '00000000-0000-0000-0000-000000000000',
      userId: '00000000-0000-0000-0000-000000000001',
      personaSlug: 'metu',
      utterance: 'what was I doing?',
      history: [],
      eagerness: 50,
      surface: 'companion',
    });

    const keys = Object.keys(captured.tools ?? {});
    // Must contain the read-only ones we expect.
    expect(keys).toEqual(
      expect.arrayContaining([
        'recall',
        'list_projects',
        'list_tasks',
        'restore_continuity',
        'device.screenshot',
      ]),
    );
    // Must NOT contain any of the mutating ones.
    for (const banned of [
      'create_task',
      'notify_user',
      'external_invoke',
      'tag_capture',
      'propose_decision',
    ]) {
      expect(keys, `should not expose ${banned}`).not.toContain(banned);
    }
  });
});
