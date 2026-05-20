import { describe, it, expect } from 'vitest';
import { matchSlashCommands, expandSlashCommand, SLASH_COMMANDS } from '../slash-commands';

describe('matchSlashCommands', () => {
  it('returns empty when input does not start with slash', () => {
    expect(matchSlashCommands('recall foo')).toEqual([]);
    expect(matchSlashCommands('')).toEqual([]);
  });

  it('returns all commands when only slash is typed', () => {
    expect(matchSlashCommands('/')).toEqual(SLASH_COMMANDS);
  });

  it('filters by prefix of first word', () => {
    expect(
      matchSlashCommands('/re')
        .map((c) => c.name)
        .sort(),
    ).toEqual(['recall', 'restore']);
    expect(matchSlashCommands('/no').map((c) => c.name)).toEqual(['notify']);
    expect(matchSlashCommands('/h').map((c) => c.name)).toEqual(['help']);
    expect(matchSlashCommands('/de').map((c) => c.name)).toEqual(['decision']);
    expect(matchSlashCommands('/f').map((c) => c.name)).toEqual(['focus']);
    expect(matchSlashCommands('/a').map((c) => c.name)).toEqual(['act']);
  });

  it('expands /restore with no arg', () => {
    expect(expandSlashCommand('/restore')).toMatch(/back/i);
  });

  it('expands /decision with arg', () => {
    expect(expandSlashCommand('/decision use postgres for storage')).toMatch(
      /decision.*use postgres/i,
    );
  });

  it('expands /focus with arg', () => {
    expect(expandSlashCommand('/focus ship the audit')).toMatch(/focus.*ship the audit/i);
  });

  it('expands /act with arg', () => {
    expect(expandSlashCommand('/act remind me at 5pm')).toMatch(/remind me at 5pm/);
  });

  it('is case-insensitive on the prefix', () => {
    expect(matchSlashCommands('/RECALL').map((c) => c.name)).toEqual(['recall']);
  });

  it('returns empty when no command matches', () => {
    expect(matchSlashCommands('/zzz')).toEqual([]);
  });
});

describe('expandSlashCommand', () => {
  it('passes through plain text unchanged', () => {
    expect(expandSlashCommand('hello world')).toBe('hello world');
  });

  it('expands /recall with arg', () => {
    expect(expandSlashCommand('/recall the meeting')).toMatch(
      /^Recall everything you remember relevant to: the meeting/,
    );
  });

  it('expands /recall with no arg to default prompt', () => {
    expect(expandSlashCommand('/recall')).toMatch(/last few days/);
  });

  it('expands /notify with arg', () => {
    expect(expandSlashCommand('/notify ship it')).toMatch(/Send a push notification.*ship it/);
  });

  it('expands /goal with multiline arg', () => {
    const out = expandSlashCommand('/goal Read more books\nthis year');
    expect(out).toMatch(/Create a new goal titled:/);
    expect(out).toContain('Read more books');
  });

  it('preserves input for unknown command', () => {
    expect(expandSlashCommand('/zzz hi')).toBe('/zzz hi');
  });

  it('handles leading whitespace', () => {
    expect(expandSlashCommand('  /help')).toMatch(/tools you have access to/);
  });
});
