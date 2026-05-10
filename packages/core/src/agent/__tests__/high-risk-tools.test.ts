/**
 * Schema-level smoke test for the high-risk mutating tools added in the
 * 2026-05-11 audit pass. We don't exercise the executors (those need a
 * live DB / GitHub / Resend); we only verify:
 *   - The tool is registered.
 *   - Its kind is `high_risk` so the default ACL is `ask`.
 *   - Its zod schema rejects obviously bad inputs.
 *
 * Catches accidental registry deletions and arg-shape regressions.
 */
import { describe, it, expect } from 'vitest';
import { getTool, listTools } from '../tools';

describe('high-risk mutating tools', () => {
  const expected = [
    'send_telegram',
    'send_email',
    'archive_project',
    'delete_capture',
    'merge_pr',
    'commit_file',
  ] as const;

  it('all six are registered as high_risk', () => {
    for (const name of expected) {
      const t = getTool(name);
      expect(t, `${name} should be registered`).not.toBeNull();
      expect(t!.kind, `${name} should be high_risk`).toBe('high_risk');
    }
    const names = new Set(listTools().map((t) => t.name));
    for (const name of expected) expect(names.has(name)).toBe(true);
  });

  it('send_email rejects invalid recipient', () => {
    const t = getTool('send_email')!;
    expect(t.args.safeParse({ to: 'not-an-email', subject: 'x', text: 'y' }).success).toBe(false);
    expect(t.args.safeParse({ to: 'a@b.co', subject: 'x', text: 'y' }).success).toBe(true);
  });

  it('send_telegram enforces text length bounds', () => {
    const t = getTool('send_telegram')!;
    expect(t.args.safeParse({ text: '' }).success).toBe(false);
    expect(t.args.safeParse({ text: 'x'.repeat(4001) }).success).toBe(false);
    expect(t.args.safeParse({ text: 'hi' }).success).toBe(true);
  });

  it('merge_pr requires owner/repo shape', () => {
    const t = getTool('merge_pr')!;
    const goodId = 'a4b3c1d0-1234-4567-8901-abcdef012345';
    expect(
      t.args.safeParse({
        integrationId: goodId,
        repoFullName: 'no-slash',
        prNumber: 1,
      }).success,
    ).toBe(false);
    expect(
      t.args.safeParse({
        integrationId: goodId,
        repoFullName: 'owner/repo',
        prNumber: 1,
      }).success,
    ).toBe(true);
  });

  it('commit_file caps content size', () => {
    const t = getTool('commit_file')!;
    const goodId = 'a4b3c1d0-1234-4567-8901-abcdef012345';
    expect(
      t.args.safeParse({
        integrationId: goodId,
        repoFullName: 'owner/repo',
        path: 'a.txt',
        content: 'x'.repeat(200_001),
        message: 'm',
      }).success,
    ).toBe(false);
  });

  it('archive_project + delete_capture require uuid', () => {
    expect(getTool('archive_project')!.args.safeParse({ projectId: 'nope' }).success).toBe(false);
    expect(getTool('delete_capture')!.args.safeParse({ captureId: 'nope' }).success).toBe(false);
  });
});
