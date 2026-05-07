'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type ThemeName = 'glass' | 'minimal' | 'dense' | 'soft';

export const THEMES: { name: ThemeName; label: string; hint: string }[] = [
  { name: 'minimal', label: 'Minimal', hint: 'Flat, low-chroma focus' },
  { name: 'glass', label: 'Glass', hint: 'Translucent + gradient' },
  { name: 'dense', label: 'Dense pro', hint: 'High-contrast data UI' },
  { name: 'soft', label: 'Soft', hint: 'Light + friendly' },
];

const STORAGE_KEY = 'metu:theme';
const SSR_DEFAULT: ThemeName = 'minimal';

interface Ctx {
  theme: ThemeName;
  isSystem: boolean;
  setTheme: (t: ThemeName) => void;
  resetToSystem: () => void;
}

const ThemeContext = createContext<Ctx>({
  theme: SSR_DEFAULT,
  isSystem: true,
  setTheme: () => {},
  resetToSystem: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function systemTheme(): ThemeName {
  if (typeof window === 'undefined') return SSR_DEFAULT;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'minimal' : 'soft';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(SSR_DEFAULT);
  const [isSystem, setIsSystem] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored && THEMES.some((t) => t.name === stored)) {
      setThemeState(stored);
      setIsSystem(false);
      document.documentElement.dataset.theme = stored;
    } else {
      const sys = systemTheme();
      setThemeState(sys);
      setIsSystem(true);
      document.documentElement.dataset.theme = sys;
    }
  }, []);

  useEffect(() => {
    if (!isSystem) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const sys = systemTheme();
      setThemeState(sys);
      document.documentElement.dataset.theme = sys;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [isSystem]);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    setIsSystem(false);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const resetToSystem = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const sys = systemTheme();
    setThemeState(sys);
    setIsSystem(true);
    document.documentElement.dataset.theme = sys;
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, isSystem, setTheme, resetToSystem }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Inline pre-paint theme script. Mirrors provider: localStorage > OS prefers-color-scheme > minimal. */
export function ThemeScript() {
  const code = `try{var t=localStorage.getItem('${STORAGE_KEY}');var v=(t&&['glass','minimal','dense','soft'].indexOf(t)>-1)?t:(matchMedia('(prefers-color-scheme: dark)').matches?'minimal':'soft');document.documentElement.dataset.theme=v;}catch(e){document.documentElement.dataset.theme='${SSR_DEFAULT}';}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
