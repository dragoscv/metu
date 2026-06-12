import { describe, expect, it } from 'vitest';
import { repairPlanText, conductorPlanSchema } from '../planner';

function parseRepaired(s: string | null) {
  expect(s).not.toBeNull();
  return conductorPlanSchema.parse(JSON.parse(s!));
}

describe('repairPlanText', () => {
  it('passes through canonical JSON unchanged in meaning', () => {
    const out = parseRepaired(repairPlanText('{"pulse":"quiet day","actions":[],"notes":"none"}'));
    expect(out.pulse).toBe('quiet day');
    expect(out.actions).toEqual([]);
  });

  it('strips ```json fences', () => {
    const out = parseRepaired(repairPlanText('```json\n{"pulse":"fenced","actions":[]}\n```'));
    expect(out.pulse).toBe('fenced');
  });

  it('strips bare ``` fences', () => {
    const out = parseRepaired(repairPlanText('```\n{"pulse":"bare","actions":[]}\n```'));
    expect(out.pulse).toBe('bare');
  });

  it('extracts JSON from surrounding prose', () => {
    const out = parseRepaired(
      repairPlanText('Here is my plan:\n{"pulse":"prose-wrapped","actions":[]}\nHope that helps!'),
    );
    expect(out.pulse).toBe('prose-wrapped');
  });

  it('coerces the sibling briefing shape', () => {
    const out = parseRepaired(
      repairPlanText(
        JSON.stringify({
          briefing: 'user shipped the release',
          suggestedActions: ['log a decision'],
          questions: ['was the rollback tested?'],
        }),
      ),
    );
    expect(out.pulse).toBe('user shipped the release');
    expect(out.notes).toContain('suggested: log a decision');
    expect(out.notes).toContain('questions: was the rollback tested?');
  });

  it('accepts summary/state aliases for briefing', () => {
    expect(parseRepaired(repairPlanText('{"summary":"s"}')).pulse).toBe('s');
    expect(parseRepaired(repairPlanText('{"state":"st"}')).pulse).toBe('st');
  });

  it('caps pulse at 500 chars', () => {
    const out = parseRepaired(
      repairPlanText(JSON.stringify({ pulse: 'x'.repeat(2000), actions: [] })),
    );
    expect(out.pulse.length).toBe(500);
  });

  it('returns null for unrepairable garbage', () => {
    expect(repairPlanText('not json at all')).toBeNull();
    expect(repairPlanText('{"irrelevant":"shape"}')).toBeNull();
    expect(repairPlanText('')).toBeNull();
  });
});
