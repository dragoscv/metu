import '@metu/ui/styles.css';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Providers } from '@/components/providers';
import { ThemeScript } from '@/components/theme-provider';
import { ErrorCatcher } from '@/components/error/error-catcher';

export const metadata: Metadata = {
  title: 'metu — your second brain',
  description: 'External RAM for AI-native founders. Personal AI Operating System.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://metu.ro'),
};

export const viewport: Viewport = {
  themeColor: '#0e7490',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Locale is resolved client-side from the cookie (see Providers) so the
  // root layout stays prerenderable under cacheComponents. `lang` is set
  // to the default and corrected on hydration for non-default locales.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)] antialiased">
        <Providers>
          <NuqsAdapter>{children}</NuqsAdapter>
          <ErrorCatcher />
          <Toaster
            position="bottom-right"
            theme="dark"
            toastOptions={{
              style: {
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-fg)',
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
