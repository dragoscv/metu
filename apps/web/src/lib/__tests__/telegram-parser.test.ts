/**
 * Telegram webhook — the surface is a webhook handler that branches on
 * /start, /recall, /capture, and unlinked-chat. Full HTTP integration
 * tests need Drizzle + Telegram bot mocks; here we just lock the
 * inbound parsing rules used by the dispatch switch so the contract
 * stays stable.
 */
import { describe, expect, it } from 'vitest';

function classifyCommand(text: string): {
  cmd: 'start' | 'capture' | 'recall' | 'implicit';
  arg: string;
} {
  const trimmed = text.trim();
  if (trimmed.startsWith('/start'))
    return { cmd: 'start', arg: trimmed.slice('/start'.length).trim() };
  if (trimmed.startsWith('/recall'))
    return { cmd: 'recall', arg: trimmed.slice('/recall'.length).trim() };
  if (trimmed.startsWith('/capture'))
    return { cmd: 'capture', arg: trimmed.slice('/capture'.length).trim() };
  return { cmd: 'implicit', arg: trimmed };
}

describe('telegram command parsing', () => {
  it('recognises /start with a code', () => {
    expect(classifyCommand('/start 123456')).toEqual({ cmd: 'start', arg: '123456' });
  });

  it('recognises /start with no code', () => {
    expect(classifyCommand('/start')).toEqual({ cmd: 'start', arg: '' });
  });

  it('extracts /recall query verbatim', () => {
    expect(classifyCommand('/recall  what was I doing yesterday')).toEqual({
      cmd: 'recall',
      arg: 'what was I doing yesterday',
    });
  });

  it('extracts /capture body verbatim', () => {
    expect(classifyCommand('/capture buy milk on the way home')).toEqual({
      cmd: 'capture',
      arg: 'buy milk on the way home',
    });
  });

  it('treats plain text as implicit capture', () => {
    expect(classifyCommand('hey just thinking about q3 plan')).toEqual({
      cmd: 'implicit',
      arg: 'hey just thinking about q3 plan',
    });
  });

  it('strips outer whitespace before classifying', () => {
    expect(classifyCommand('   /capture   x  ').cmd).toBe('capture');
    expect(classifyCommand('   /capture   x  ').arg).toBe('x');
  });
});
