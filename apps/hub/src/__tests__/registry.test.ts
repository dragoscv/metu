/**
 * Hub registry — connection bookkeeping unit tests.
 *
 * The registry is a pure in-memory map; we just need to prove the
 * `byDevice` invariant (one connection per deviceId — re-adding kicks
 * the prior entry off the workspace fanout list) and the per-workspace
 * grouping. No real ws is needed; we stub `WebSocket` with a fake.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { registry, type Connection } from '../registry';

function fakeConn(over: Partial<Connection>): Connection {
  return {
    ws: {} as Connection['ws'],
    workspaceId: 'w1',
    userId: 'u1',
    deviceId: 'd1',
    kind: 'web',
    send: () => {},
    ...over,
  };
}

beforeEach(() => {
  // Clear residue between tests — registry is module-singleton.
  for (const c of [...byAll()]) registry.remove(c);
});

function byAll(): Connection[] {
  return registry.forWorkspace('w1').concat(registry.forWorkspace('w2'));
}

describe('registry', () => {
  it('groups connections by workspace', () => {
    const a = fakeConn({ deviceId: 'd-a' });
    const b = fakeConn({ deviceId: 'd-b' });
    const c = fakeConn({ workspaceId: 'w2', deviceId: 'd-c' });
    registry.add(a);
    registry.add(b);
    registry.add(c);
    expect(registry.forWorkspace('w1').map((x) => x.deviceId).sort()).toEqual(['d-a', 'd-b']);
    expect(registry.forWorkspace('w2').map((x) => x.deviceId)).toEqual(['d-c']);
  });

  it('byDevice keeps only the latest connection per deviceId', () => {
    const first = fakeConn({ deviceId: 'd-x' });
    const second = fakeConn({ deviceId: 'd-x' });
    registry.add(first);
    registry.add(second);
    expect(registry.forDevice('d-x')).toBe(second);
  });

  it('remove() clears the workspace bucket when empty', () => {
    const c = fakeConn({ deviceId: 'd-only' });
    registry.add(c);
    expect(registry.forWorkspace('w1').length).toBe(1);
    registry.remove(c);
    expect(registry.forWorkspace('w1').length).toBe(0);
  });

  it('byKind() tallies connections per device kind', () => {
    registry.add(fakeConn({ deviceId: 'd1', kind: 'web' }));
    registry.add(fakeConn({ deviceId: 'd2', kind: 'web' }));
    registry.add(fakeConn({ deviceId: 'd3', kind: 'mobile' }));
    expect(registry.byKind()).toEqual({ web: 2, mobile: 1 });
  });
});
