/**
 * Sense-engine settings — persisted blocklist + watch preference.
 *
 * The Rust sense engine keeps its blocklist in memory only; this module is
 * the durable source of truth (tauri-plugin-store) and re-applies it on
 * every launch so privacy choices survive restarts.
 */
import { Store } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './runtime';

const FILE = 'sense.json';
const BLOCKLIST_KEY = 'blocklist';
const PAUSED_KEY = 'userPaused';

/** Apps never captured by default — extend, don't replace, user entries. */
const DEFAULT_BLOCKLIST = ['keepass', '1password', 'bitwarden', 'signal'];

let store: Store | null = null;
async function getStore(): Promise<Store> {
  if (!store) store = await Store.load(FILE, { autoSave: true, defaults: {} });
  return store;
}

export async function loadBlocklist(): Promise<string[]> {
  if (!isTauri()) return [];
  const s = await getStore();
  const v = await s.get<string[]>(BLOCKLIST_KEY);
  return v ?? DEFAULT_BLOCKLIST;
}

export async function saveBlocklist(apps: string[]): Promise<void> {
  const s = await getStore();
  await s.set(BLOCKLIST_KEY, apps);
  await s.save();
  await invoke('sense_set_blocklist', { apps }).catch(() => {});
}

export async function loadWatchPaused(): Promise<boolean> {
  if (!isTauri()) return false;
  const s = await getStore();
  return (await s.get<boolean>(PAUSED_KEY)) ?? false;
}

export async function saveWatchPaused(paused: boolean): Promise<void> {
  const s = await getStore();
  await s.set(PAUSED_KEY, paused);
  await s.save();
  await invoke('sense_set_paused', { paused }).catch(() => {});
}

/**
 * Apply persisted sense settings to the native engine. Call once when the
 * assistant window mounts (the engine starts with empty blocklist +
 * unpaused; this restores user intent).
 */
export async function applySenseSettings(): Promise<{ paused: boolean }> {
  if (!isTauri()) return { paused: false };
  const [blocklist, paused] = await Promise.all([loadBlocklist(), loadWatchPaused()]);
  await invoke('sense_set_blocklist', { apps: blocklist }).catch(() => {});
  if (paused) await invoke('sense_set_paused', { paused: true }).catch(() => {});
  return { paused };
}
