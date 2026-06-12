/**
 * Hub limits — token-bucket + cap unit tests. Pure in-memory logic;
 * no DB or sockets needed. Uses unique IPs per test to avoid the
 * module-level ipBuckets map leaking state between cases.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  consumeHandshakeBudget,
  consumeConnBudget,
  consumeDistributedHandshakeBudget,
  isDistributedLimitConfigured,
  newConnBudget,
  exceedsConnectionCap,
  ipFromReq,
  HUB_LIMITS,
} from '../limits';

afterEach(() => {
  vi.useRealTimers();
});

describe('consumeHandshakeBudget', () => {
  it('allows up to HANDSHAKE_PER_IP handshakes per window, rejects the next', () => {
    const ip = `t-${Math.random()}`;
    for (let i = 0; i < HUB_LIMITS.HANDSHAKE_PER_IP; i++) {
      expect(consumeHandshakeBudget(ip)).toBe(true);
    }
    expect(consumeHandshakeBudget(ip)).toBe(false);
  });

  it('resets the budget after the window elapses', () => {
    vi.useFakeTimers();
    const ip = `t-${Math.random()}`;
    for (let i = 0; i < HUB_LIMITS.HANDSHAKE_PER_IP + 1; i++) consumeHandshakeBudget(ip);
    expect(consumeHandshakeBudget(ip)).toBe(false);
    vi.advanceTimersByTime(HUB_LIMITS.WINDOW_MS + 1);
    expect(consumeHandshakeBudget(ip)).toBe(true);
  });

  it('tracks budgets per IP independently', () => {
    const a = `t-${Math.random()}`;
    const b = `t-${Math.random()}`;
    for (let i = 0; i < HUB_LIMITS.HANDSHAKE_PER_IP; i++) consumeHandshakeBudget(a);
    expect(consumeHandshakeBudget(a)).toBe(false);
    expect(consumeHandshakeBudget(b)).toBe(true);
  });
});

describe('consumeConnBudget', () => {
  it('allows up to MESSAGES_PER_CONN per window, rejects the next', () => {
    const budget = newConnBudget();
    for (let i = 0; i < HUB_LIMITS.MESSAGES_PER_CONN; i++) {
      expect(consumeConnBudget(budget)).toBe(true);
    }
    expect(consumeConnBudget(budget)).toBe(false);
  });

  it('resets after the message window elapses', () => {
    vi.useFakeTimers();
    const budget = newConnBudget();
    for (let i = 0; i < HUB_LIMITS.MESSAGES_PER_CONN + 1; i++) consumeConnBudget(budget);
    expect(consumeConnBudget(budget)).toBe(false);
    vi.advanceTimersByTime(HUB_LIMITS.MESSAGE_WINDOW_MS + 1);
    expect(consumeConnBudget(budget)).toBe(true);
  });
});

describe('exceedsConnectionCap', () => {
  it('rejects at and above the cap, allows below', () => {
    expect(exceedsConnectionCap(HUB_LIMITS.MAX_CONNECTIONS - 1)).toBe(false);
    expect(exceedsConnectionCap(HUB_LIMITS.MAX_CONNECTIONS)).toBe(true);
    expect(exceedsConnectionCap(HUB_LIMITS.MAX_CONNECTIONS + 1)).toBe(true);
  });
});

describe('ipFromReq', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(ipFromReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })).toBe('1.2.3.4');
    expect(ipFromReq({ 'x-forwarded-for': ['9.9.9.9, 1.1.1.1'] })).toBe('9.9.9.9');
  });

  it('falls back to x-real-ip then anon', () => {
    expect(ipFromReq({ 'x-real-ip': '7.7.7.7' })).toBe('7.7.7.7');
    expect(ipFromReq({})).toBe('anon');
  });
});

describe('consumeDistributedHandshakeBudget', () => {
  const ENV = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  function configure() {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
  }

  it('is a no-op (allow) when Redis is unconfigured', async () => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    expect(isDistributedLimitConfigured()).toBe(false);
    await expect(consumeDistributedHandshakeBudget('1.1.1.1')).resolves.toBe(true);
  });

  it('allows when the shared count is within budget', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ result: 5 }, { result: 1 }]))),
    );
    await expect(consumeDistributedHandshakeBudget('1.1.1.1')).resolves.toBe(true);
  });

  it('rejects when the shared count exceeds the budget', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([{ result: HUB_LIMITS.HANDSHAKE_PER_IP + 1 }, { result: 1 }]),
          ),
      ),
    );
    await expect(consumeDistributedHandshakeBudget('1.1.1.1')).resolves.toBe(false);
  });

  it('fails open on network error', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('redis down');
      }),
    );
    await expect(consumeDistributedHandshakeBudget('1.1.1.1')).resolves.toBe(true);
  });
});
