/**
 * Hub notification ring buffer.
 *
 * Mirror of clipboard-ring.ts — keeps the last `MAX` notifications received
 * over the hub WS in memory + localStorage so a future inbox view can read
 * them without a server round-trip. Pure TypeScript, no Rust changes.
 */
import { useEffect, useState } from 'react';

export interface HubNotificationEntry {
  /** millis since epoch */
  at: number;
  id: string;
  title: string;
  body?: string;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  actionUrl?: string;
}

const STORAGE_KEY = 'metu.companion.hubNotifications.v1';
const MAX = 20;

function load(): HubNotificationEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HubNotificationEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as HubNotificationEntry).at === 'number' &&
        typeof (e as HubNotificationEntry).id === 'string' &&
        typeof (e as HubNotificationEntry).title === 'string',
    );
  } catch {
    return [];
  }
}

function save(entries: HubNotificationEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota or private mode — silently ignore */
  }
  window.dispatchEvent(new CustomEvent('metu:hubNotifications:change'));
}

/** Append a notification to the ring; deduped by id. */
export function pushHubNotification(entry: HubNotificationEntry): void {
  const list = load();
  if (list.some((e) => e.id === entry.id)) return;
  const next = [entry, ...list].slice(0, MAX);
  save(next);
}

export function useHubNotifications(): HubNotificationEntry[] {
  const [items, setItems] = useState<HubNotificationEntry[]>(() => load());
  useEffect(() => {
    const onChange = () => setItems(load());
    window.addEventListener('metu:hubNotifications:change', onChange);
    return () => window.removeEventListener('metu:hubNotifications:change', onChange);
  }, []);
  return items;
}
