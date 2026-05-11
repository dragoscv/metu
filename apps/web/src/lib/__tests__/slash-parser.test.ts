import { describe, expect, it } from 'vitest';
import { parseSlash } from '../slash';

describe('parseSlash (command palette)', () => {
  it('returns null for plain text', () => {
    expect(parseSlash('hello world')).toBeNull();
    expect(parseSlash('')).toBeNull();
    expect(parseSlash('   ')).toBeNull();
  });

  it('parses /cmd with no arg', () => {
    expect(parseSlash('/recall')).toEqual({ cmd: '/recall', arg: '' });
    expect(parseSlash('/CAPTURE')).toEqual({ cmd: '/capture', arg: '' });
  });

  it('parses /cmd with multi-word arg', () => {
    expect(parseSlash('/recall foo bar')).toEqual({ cmd: '/recall', arg: 'foo bar' });
    expect(parseSlash('/go dashboard')).toEqual({ cmd: '/go', arg: 'dashboard' });
  });

  it('lower-cases the cmd', () => {
    expect(parseSlash('/Tool whisper-1')).toEqual({ cmd: '/tool', arg: 'whisper-1' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseSlash('  /focus  ')).toEqual({ cmd: '/focus', arg: '' });
  });

  it('rejects non-word command chars', () => {
    expect(parseSlash('/-bad arg')).toBeNull();
    expect(parseSlash('/ foo')).toBeNull();
  });
});
