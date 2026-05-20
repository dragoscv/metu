/**
 * Cross-device awareness store.
 *
 * Receives `event.timeline` envelopes that the web hub fans out from
 * /api/internal/hub/device-event. Filters to events whose source device
 * is NOT this companion's own fingerprint, keeps the most recent ones
 * grouped by source kind, and exposes the latest snapshot to the UI.
 *
 * Event volume can be high (every editor heartbeat) so we cap the ring
 * at MAX_RING entries and de-dupe by `device.${kind}+sourceDeviceId`
 * keeping only the freshest per key.
 */
import { useEffect, useState } from 'react';

const MAX_RING = 12;
const STALE_MS = 5 * 60_000;

export interface AwarenessEntry {
  kind: string; // e.g. 'device.vscode.heartbeat'
  title: string;
  sourceDeviceId: string;
  occurredAt: number;
}

let ring: AwarenessEntry[] = [];
const subscribers = new Set<() => void>();

function notify() {
  for (const s of subscribers) s();
}

export function pushAwareness(
  entry: Omit<AwarenessEntry, 'occurredAt'> & { occurredAt?: number },
): void {
  const occurredAt = entry.occurredAt ?? Date.now();
  const key = `${entry.kind}::${entry.sourceDeviceId}`;
  ring = [
    { ...entry, occurredAt },
    ...ring.filter((e) => `${e.kind}::${e.sourceDeviceId}` !== key),
  ].slice(0, MAX_RING);
  notify();
}

export function getAwareness(): AwarenessEntry[] {
  const cutoff = Date.now() - STALE_MS;
  return ring.filter((e) => e.occurredAt >= cutoff);
}

const FINGERPRINT_KEY = 'metu.companion.fingerprint';

export function ownFingerprint(): string {
  return localStorage.getItem(FINGERPRINT_KEY) ?? '';
}

export function useAwareness(): AwarenessEntry[] {
  const [snap, setSnap] = useState<AwarenessEntry[]>(() => getAwareness());
  useEffect(() => {
    const tick = () => setSnap(getAwareness());
    subscribers.add(tick);
    const interval = setInterval(tick, 30_000); // re-render to drop stale entries
    return () => {
      subscribers.delete(tick);
      clearInterval(interval);
    };
  }, []);
  return snap;
}
