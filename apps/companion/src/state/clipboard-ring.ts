/**
 * Clipboard ring buffer.
 *
 * Polls the OS clipboard text every `POLL_MS` ms; keeps the last `MAX`
 * distinct snippets in memory + localStorage so the user can flick them
 * into metu as captures with a single click.
 *
 * Pure TypeScript — no Rust changes needed; uses the already-allowed
 * `tauri-plugin-clipboard-manager` `readText()` capability.
 */
import { useEffect, useRef, useState } from 'react';
import { readText } from '@tauri-apps/plugin-clipboard-manager';

export interface ClipboardEntry {
  /** millis since epoch */
  at: number;
  text: string;
}

const STORAGE_KEY = 'metu.companion.clipboardRing.v1';
const MAX = 20;
const POLL_MS = 3000;
const MAX_LEN = 4000; // ignore very large pastes (likely binary or huge code)

function load(): ClipboardEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is ClipboardEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as ClipboardEntry).at === 'number' &&
        typeof (e as ClipboardEntry).text === 'string',
    );
  } catch {
    return [];
  }
}

function save(entries: ClipboardEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // best-effort
  }
}

export function useClipboardRing(enabled: boolean) {
  const [entries, setEntries] = useState<ClipboardEntry[]>(() => load());
  const lastSeenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    async function poll() {
      try {
        const text = (await readText()) ?? '';
        if (!alive) return;
        const trimmed = text.trim();
        if (!trimmed || trimmed.length > MAX_LEN) return;
        if (trimmed === lastSeenRef.current) return;
        lastSeenRef.current = trimmed;
        setEntries((prev) => {
          if (prev.length > 0 && prev[0]!.text === trimmed) return prev;
          const next = [
            { at: Date.now(), text: trimmed },
            ...prev.filter((e) => e.text !== trimmed),
          ].slice(0, MAX);
          save(next);
          return next;
        });
      } catch {
        // clipboard read can fail (no permission, unfocused). Ignore.
      }
    }

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled]);

  function clear() {
    setEntries([]);
    save([]);
    lastSeenRef.current = null;
  }

  function remove(at: number) {
    setEntries((prev) => {
      const next = prev.filter((e) => e.at !== at);
      save(next);
      return next;
    });
  }

  return { entries, clear, remove };
}
