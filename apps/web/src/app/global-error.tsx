'use client';
/**
 * Last-resort error boundary. Rendered when the root layout itself crashed,
 * so we MUST include <html>/<body> and we can NOT rely on global CSS being
 * loaded. Everything here is inline-styled and self-contained.
 */
import { useEffect, useState } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error('[global] fatal', error);
  }, [error]);

  const report = [
    '## metu fatal error',
    '',
    `- **time**: ${new Date().toISOString()}`,
    `- **kind**: fatal`,
    typeof window !== 'undefined' ? `- **url**: ${window.location.href}` : '',
    error.digest ? `- **digest**: \`${error.digest}\`` : '',
    typeof navigator !== 'undefined' ? `- **userAgent**: ${navigator.userAgent}` : '',
    '',
    '### message',
    '```',
    error.message || '(no message)',
    '```',
    error.stack ? '\n### stack\n```\n' + error.stack + '\n```' : '',
  ]
    .filter(Boolean)
    .join('\n');

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowDetails(true);
    }
  }

  const card: React.CSSProperties = {
    maxWidth: 560,
    width: '100%',
    background: '#111118',
    border: '1px solid #2a2a35',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
  };
  const btn: React.CSSProperties = {
    padding: '8px 14px',
    border: '1px solid #2a2a35',
    background: '#16161e',
    color: '#e5e7eb',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
  const primaryBtn: React.CSSProperties = {
    ...btn,
    background: '#0e7490',
    border: '1px solid #0e7490',
    color: '#fff',
  };

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          background: '#0b0b10',
          color: '#e5e7eb',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          margin: 0,
        }}
      >
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span
              aria-hidden
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#f59e0b',
                fontSize: 18,
              }}
            >
              !
            </span>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>metu hit a wall</h1>
          </div>
          <p style={{ fontSize: 14, color: '#9ca3af', marginTop: 0, marginBottom: 12 }}>
            {error.message || 'An unexpected fatal error occurred.'}
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 11,
                color: '#6b7280',
                fontFamily: 'monospace',
                margin: '0 0 16px',
              }}
            >
              ref: {error.digest}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" onClick={reset} style={primaryBtn}>
              Try again
            </button>
            <button type="button" onClick={copy} style={btn}>
              {copied ? '✓ Copied' : 'Copy details'}
            </button>
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              style={btn}
              aria-expanded={showDetails}
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              style={btn}
            >
              Home
            </button>
          </div>
          {showDetails && (
            <pre
              style={{
                marginTop: 16,
                maxHeight: 280,
                overflow: 'auto',
                padding: 12,
                background: '#08080d',
                border: '1px solid #2a2a35',
                borderRadius: 8,
                fontSize: 11,
                lineHeight: 1.5,
                color: '#9ca3af',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {report}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
