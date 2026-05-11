/**
 * In-memory connection registry.
 *
 * Single-instance for v1. When we scale horizontally we'll add a Redis pub/sub
 * fanout layer that publishes outbound envelopes to all hub instances.
 */
import type { WebSocket } from 'ws';

export interface Connection {
  ws: WebSocket;
  workspaceId: string;
  userId: string;
  deviceId: string;
  kind: string;
  send: (payload: unknown) => void;
}

const byWorkspace = new Map<string, Set<Connection>>();
const byDevice = new Map<string, Connection>();

export const registry = {
  add(conn: Connection) {
    let set = byWorkspace.get(conn.workspaceId);
    if (!set) {
      set = new Set();
      byWorkspace.set(conn.workspaceId, set);
    }
    set.add(conn);
    byDevice.set(conn.deviceId, conn);
  },
  remove(conn: Connection) {
    byWorkspace.get(conn.workspaceId)?.delete(conn);
    if (byWorkspace.get(conn.workspaceId)?.size === 0) byWorkspace.delete(conn.workspaceId);
    if (byDevice.get(conn.deviceId) === conn) byDevice.delete(conn.deviceId);
  },
  forWorkspace(workspaceId: string): Connection[] {
    return Array.from(byWorkspace.get(workspaceId) ?? []);
  },
  forDevice(deviceId: string): Connection | undefined {
    return byDevice.get(deviceId);
  },
  size(): number {
    return byDevice.size;
  },
  /** Number of workspaces with at least one live connection. */
  workspaceCount(): number {
    return byWorkspace.size;
  },
  /** Connection counts grouped by device kind. */
  byKind(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of byDevice.values()) out[c.kind] = (out[c.kind] ?? 0) + 1;
    return out;
  },
};
