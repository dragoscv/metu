'use client';
/**
 * Telegram link-code panel — issues a fresh six-digit code on demand
 * and shows it with a clear expiry. Designed to live inside a Card
 * on the integration settings page.
 */
import { useState, useTransition } from 'react';
import { Button } from '@metu/ui';
import { issueTelegramLinkCodeAction } from '@/app/actions/telegram';

export function TelegramLinkPanel({ botUsername }: { botUsername?: string | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const issue = () => {
    setError(null);
    start(async () => {
      try {
        const r = await issueTelegramLinkCodeAction();
        setCode(r.code);
        setExpiresAt(r.expiresAt);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div className="mt-3 space-y-2">
      <Button onClick={issue} disabled={pending}>
        {pending ? 'Issuing\u2026' : 'Generate link code'}
      </Button>
      {code && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 font-mono">
          <div className="text-2xl tracking-[0.4em]">{code}</div>
          <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
            Expires {expiresAt ? new Date(expiresAt).toLocaleTimeString() : 'shortly'}. Send{' '}
            <code>/start {code}</code> to <strong>@{botUsername ?? 'your_bot'}</strong>.
          </div>
        </div>
      )}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
