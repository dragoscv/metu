'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { useState } from 'react';
import { ThemeProvider } from './theme-provider';
import { I18nProvider } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n/locale';

export function Providers({ children, locale }: { children: React.ReactNode; locale: Locale }) {
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
