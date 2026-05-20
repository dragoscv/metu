'use client';

import { useEffect } from 'react';

export function KeyboardFocus({ targetId, key = '/' }: { targetId: string; key?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) {
        return;
      }
      const el = document.getElementById(targetId);
      if (el instanceof HTMLInputElement) {
        e.preventDefault();
        el.focus();
        el.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [targetId, key]);
  return null;
}
