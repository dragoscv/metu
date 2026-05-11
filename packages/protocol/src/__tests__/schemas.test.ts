/**
 * @metu/protocol — zod schema round-trip tests.
 *
 * Goal: catch accidental schema breaks on shared envelopes. For each
 * top-level schema we (a) build a minimal valid sample, (b) parse it,
 * (c) re-stringify, (d) re-parse. The output must equal the input
 * structurally — that proves the schema neither rejects valid traffic
 * nor silently invents fields, and that downstream consumers can rely
 * on `safeParse(JSON.parse(text)).data` round-tripping.
 */
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  HelloSchema,
  HelloAckSchema,
  ServerEventSchema,
  ClientEventSchema,
  CaptureCreateSchema,
  RecallQuerySchema,
  NotifyCreateSchema,
  IntentCreateSchema,
} from '../index';

const UUID = '00000000-0000-4000-8000-000000000000';
const ISO = '2026-01-01T00:00:00.000Z';

describe('HelloSchema', () => {
  it('round-trips a minimal hello', () => {
    const v = {
      v: PROTOCOL_VERSION,
      type: 'hello' as const,
      accessToken: 'metu_at_test',
      kind: 'web' as const,
      platform: 'darwin',
      name: 'My MacBook',
      fingerprint: 'fp-1',
    };
    const parsed = HelloSchema.parse(v);
    expect(parsed.capabilities).toEqual([]);
    expect(HelloSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects an unknown device kind', () => {
    expect(() =>
      HelloSchema.parse({
        v: PROTOCOL_VERSION,
        type: 'hello',
        accessToken: 't',
        kind: 'mystery',
        platform: 'x',
        name: 'x',
        fingerprint: 'x',
      }),
    ).toThrow();
  });

  it('rejects a wrong protocol version', () => {
    expect(() =>
      HelloSchema.parse({
        v: 99,
        type: 'hello',
        accessToken: 't',
        kind: 'web',
        platform: 'x',
        name: 'x',
        fingerprint: 'x',
      }),
    ).toThrow();
  });
});

describe('HelloAckSchema', () => {
  it('round-trips', () => {
    const v = {
      v: PROTOCOL_VERSION,
      type: 'hello_ack' as const,
      deviceId: UUID,
      workspaceId: UUID,
      userId: UUID,
      serverTime: ISO,
    };
    const parsed = HelloAckSchema.parse(v);
    expect(parsed.acl).toEqual({});
  });
});

describe('ServerEventSchema discriminated union', () => {
  it.each([
    [
      'event.timeline',
      {
        type: 'event.timeline',
        id: UUID,
        kind: 'capture.created',
        title: 'New capture',
        occurredAt: ISO,
      },
    ],
    ['event.notification', { type: 'event.notification', id: UUID, title: 'hi' }],
    ['tool.invoke', { type: 'tool.invoke', id: UUID, tool: 'recall', args: { q: 'hi' } }],
    ['command', { type: 'command', id: UUID, command: 'refocus' }],
    ['persona.deactivate', { type: 'persona.deactivate', activationId: UUID }],
    ['ping', { type: 'ping', at: ISO }],
  ])('round-trips %s', (_label, sample) => {
    const parsed = ServerEventSchema.parse(sample);
    const roundTripped = ServerEventSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it('rejects an unknown server event type', () => {
    expect(() => ServerEventSchema.parse({ type: 'unknown' })).toThrow();
  });
});

describe('ClientEventSchema discriminated union', () => {
  it.each([
    ['event.app', { type: 'event.app', kind: 'todo.created' }],
    ['event.device', { type: 'event.device', kind: 'window.focused' }],
    ['tool.result', { type: 'tool.result', id: UUID, ok: true }],
    ['presence', { type: 'presence', state: 'online' }],
  ])('round-trips %s', (_label, sample) => {
    const parsed = ClientEventSchema.parse(sample);
    const roundTripped = ClientEventSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });
});

describe('domain create schemas', () => {
  it('CaptureCreateSchema round-trips', () => {
    const sample = { kind: 'text' as const, content: 'hello' };
    const parsed = CaptureCreateSchema.parse(sample);
    expect(parsed.kind).toBe('text');
    expect(parsed.content).toBe('hello');
    expect(parsed.source).toBe('sdk');
  });

  it('RecallQuerySchema requires a non-empty query string', () => {
    expect(() => RecallQuerySchema.parse({})).toThrow();
    expect(RecallQuerySchema.parse({ query: 'cats' }).query).toBe('cats');
  });

  it('NotifyCreateSchema accepts a minimal payload', () => {
    expect(NotifyCreateSchema.parse({ title: 'hi' }).title).toBe('hi');
  });

  it('IntentCreateSchema requires a title', () => {
    expect(() => IntentCreateSchema.parse({})).toThrow();
    const v = IntentCreateSchema.parse({ title: 'Pay invoice' });
    expect(v.title).toBe('Pay invoice');
    expect(v.status).toBe('inbox');
  });
});
