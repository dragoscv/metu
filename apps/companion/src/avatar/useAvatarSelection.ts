/**
 * Persisted avatar selection (renderer + preset) backed by localStorage so it
 * survives reloads and is shared across the main window, HUD, and assistant (they're
 * separate webview windows in the same origin).
 *
 * Exposes a tiny pub/sub so all windows update live when the user picks a new
 * avatar in the picker.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_AVATAR_SELECTION, type AvatarKind, type AvatarSelection } from './types';

const KEY = 'metu.companion.avatar';
const CUSTOM_KEY = 'metu.companion.avatar.customVrmUrl';

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): AvatarSelection {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_AVATAR_SELECTION;
    const parsed = JSON.parse(raw) as Partial<AvatarSelection>;
    return { ...DEFAULT_AVATAR_SELECTION, ...parsed };
  } catch {
    return DEFAULT_AVATAR_SELECTION;
  }
}

function write(sel: AvatarSelection) {
  localStorage.setItem(KEY, JSON.stringify(sel));
  listeners.forEach((l) => l());
}

export function getCustomVrmUrl(): string | null {
  return localStorage.getItem(CUSTOM_KEY);
}
export function setCustomVrmUrl(url: string | null) {
  if (url) localStorage.setItem(CUSTOM_KEY, url);
  else localStorage.removeItem(CUSTOM_KEY);
  listeners.forEach((l) => l());
}

export function useAvatarSelection() {
  const [sel, setSel] = useState<AvatarSelection>(read);
  const [customUrl, setCustom] = useState<string | null>(getCustomVrmUrl);

  useEffect(() => {
    const onChange = () => {
      setSel(read());
      setCustom(getCustomVrmUrl());
    };
    listeners.add(onChange);
    // cross-window sync via storage events
    window.addEventListener('storage', onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return {
    selection: sel,
    customVrmUrl: customUrl,
    setKind: (kind: AvatarKind) => write({ ...read(), kind }),
    setOrbPreset: (orbPresetId: string) => write({ ...read(), orbPresetId }),
    setFacePreset: (facePresetId: string) => write({ ...read(), facePresetId }),
    setVrmPreset: (vrmPresetId: string) => write({ ...read(), vrmPresetId }),
    setGlbPreset: (glbPresetId: string) => write({ ...read(), glbPresetId }),
    setMetuPalette: (metuPaletteId: string) => write({ ...read(), metuPaletteId }),
    setCustomVrmUrl,
  };
}
