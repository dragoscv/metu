'use client';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@metu/ui';
import { Suspense } from 'react';

function SignInInner() {
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') ?? '/dashboard';

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-8 shadow-2xl">
        <div className="mb-8 flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-brand)] text-[var(--color-brand-fg)]">
            m
          </span>
          metu
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back.</h1>
        <p className="mt-2 text-sm text-[var(--color-fg-muted)]">Sign in to your second brain.</p>
        <Button className="mt-8 w-full" size="lg" onClick={() => signIn('google', { callbackUrl })}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.93l3.66-2.83Z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38Z"
              fill="#EA4335"
            />
          </svg>
          Continue with Google
        </Button>
        <p className="mt-6 text-center text-xs text-[var(--color-fg-subtle)]">
          By continuing you agree to our Terms & Privacy Policy.
        </p>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}
