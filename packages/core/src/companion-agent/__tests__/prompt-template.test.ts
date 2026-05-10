import { describe, expect, it } from 'vitest';
import { renderPersonaPrompt } from '../prompt-template';

const FIXED = new Date('2025-03-14T09:42:00.000Z');

describe('renderPersonaPrompt', () => {
  it('substitutes always-available date/time vars', () => {
    const out = renderPersonaPrompt('Today is {{currentDate}} ({{currentTime}}).', { now: FIXED });
    expect(out).toBe('Today is 2025-03-14 (09:42 UTC).');
  });

  it('substitutes caller-supplied vars', () => {
    const out = renderPersonaPrompt(
      'Hi {{userName}}, you are {{personaName}}, replying in {{language}}.',
      {
        now: FIXED,
        userName: 'Dragos',
        personaName: 'Metu',
        language: 'Romanian',
      },
    );
    expect(out).toBe('Hi Dragos, you are Metu, replying in Romanian.');
  });

  it('leaves unknown placeholders untouched', () => {
    const out = renderPersonaPrompt('{{userName}} {{notReal}}', {
      now: FIXED,
      userName: 'Ada',
    });
    expect(out).toBe('Ada {{notReal}}');
  });

  it('leaves known but missing placeholders untouched', () => {
    const out = renderPersonaPrompt('Hi {{userName}}!', { now: FIXED });
    expect(out).toBe('Hi {{userName}}!');
  });

  it('inserts recentDigest paragraph', () => {
    const out = renderPersonaPrompt('Recent context: {{recentDigest}}', {
      now: FIXED,
      recentDigest: 'Working on Metu rollout.',
    });
    expect(out).toBe('Recent context: Working on Metu rollout.');
  });
});
