'use client';
import { createContext, useContext, useMemo } from 'react';
import { MESSAGES, type Locale } from './locale';
import en from './messages/en.json';

type Messages = typeof en;

interface Ctx {
  locale: Locale;
  messages: Messages;
}

const I18nContext = createContext<Ctx>({ locale: 'en', messages: en });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<Ctx>(() => ({ locale, messages: MESSAGES[locale] }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

/**
 * Tiny scope-bound translator. Returns the exact string for `key` under
 * `messages[scope]`. Falls back to the key itself if missing — never throws.
 */
export function useT<S extends keyof Messages>(scope: S) {
  const { messages } = useContext(I18nContext);
  const dict = messages[scope] as Record<string, string>;
  return (key: keyof Messages[S]) => dict[key as string] ?? (key as string);
}
