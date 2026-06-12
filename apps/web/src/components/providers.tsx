'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { useEffect, useState } from 'react';
import { ThemeProvider } from './theme-provider';
import { I18nProvider } from '@/lib/i18n/provider';
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, type Locale } from '@/lib/i18n/locale';

function readLocaleCookie(): Locale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const v = m?.[1];
  return (LOCALES as readonly string[]).includes(v ?? '') ? (v as Locale) : DEFAULT_LOCALE;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Resolve locale on the client so the server tree stays cacheable.
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    const l = readLocaleCookie();
    if (l !== DEFAULT_LOCALE) {
      setLocale(l);
      document.documentElement.lang = l;
    }
  }, []);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <NuqsAdapter>
      <QueryClientProvider client={client}>
        <I18nProvider locale={locale}>
          <ThemeProvider>{children}</ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>
    </NuqsAdapter>
  );
}
