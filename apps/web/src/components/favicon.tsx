'use client';
import { Globe } from 'lucide-react';
import { useState } from 'react';

export function faviconUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64`;
  } catch {
    return null;
  }
}

export function Favicon({
  url,
  className = 'h-4 w-4 shrink-0 rounded-sm',
}: {
  url: string;
  className?: string;
}) {
  const src = faviconUrl(url);
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <Globe className={`${className} text-[var(--color-fg-muted)]`} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
      decoding="async"
    />
  );
}
