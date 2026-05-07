'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const GO_MAP: Record<string, { href: string; label: string }> = {
  d: { href: '/dashboard', label: 'Now' },
  i: { href: '/inbox', label: 'Brain dump' },
  p: { href: '/projects', label: 'Projects' },
  g: { href: '/goals', label: 'Goals' },
  t: { href: '/timeline', label: 'Timeline' },
  m: { href: '/memory', label: 'Memory' },
  c: { href: '/chat', label: 'Chat' },
  u: { href: '/metu', label: 'METU' },
  a: { href: '/agents', label: 'Agents' },
  s: { href: '/settings', label: 'Settings' },
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const goPending = useRef(false);
  const goTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never override modifier combos — those belong to other handlers.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();

      // Two-key sequence: `g` then nav letter.
      if (goPending.current) {
        const target = GO_MAP[key];
        if (target) {
          e.preventDefault();
          goPending.current = false;
          if (goTimer.current) clearTimeout(goTimer.current);
          router.push(target.href);
          return;
        }
        // Cancel sequence on unknown key
        goPending.current = false;
        if (goTimer.current) clearTimeout(goTimer.current);
      }

      if (key === 'g') {
        e.preventDefault();
        goPending.current = true;
        if (goTimer.current) clearTimeout(goTimer.current);
        goTimer.current = setTimeout(() => {
          goPending.current = false;
        }, 1500);
        toast('Go to…', {
          description: 'Press D, I, P, G, T, M, C, A, S',
          duration: 1500,
        });
        return;
      }

      if (key === '?') {
        e.preventDefault();
        router.push('/help/keyboard');
        return;
      }

      if (key === '/') {
        // Focus the first visible search/filter input on the page.
        const candidates = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            'input[type="search"], input[placeholder*="earch" i], input[placeholder*="ilter" i]',
          ),
        );
        const visible = candidates.find((el) => el.offsetParent !== null);
        if (visible) {
          e.preventDefault();
          visible.focus();
          visible.select();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (goTimer.current) clearTimeout(goTimer.current);
    };
  }, [router]);

  return null;
}
