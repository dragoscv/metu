'use client';
import { useEffect, useState } from 'react';
import { Button, Card } from '@metu/ui';

interface AssetEntry {
  name: string;
  url: string;
  size: number;
}

type Platform = 'windows' | 'macos' | 'linux' | 'unknown';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'unknown';
  // Use the modern UA-CH platform field when available, fall back to UA string.
  const uaPlatform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent;
  const s = uaPlatform.toLowerCase();
  if (s.includes('win')) return 'windows';
  if (s.includes('mac')) return 'macos';
  if (s.includes('linux') || s.includes('x11')) return 'linux';
  return 'unknown';
}

function pickPrimaryAsset(platform: Platform, assets: AssetEntry[]): AssetEntry | null {
  switch (platform) {
    case 'windows':
      // tauri-action emits `*-setup.exe` (NSIS) and `*.msi`. Prefer NSIS so
      // a fresh user can install per-user without admin rights.
      return (
        assets.find((a) => a.name.endsWith('-setup.exe')) ??
        assets.find((a) => a.name.endsWith('.msi')) ??
        null
      );
    case 'macos':
      // Universal-binary DMG is the default we ship from the workflow.
      return assets.find((a) => a.name.endsWith('.dmg')) ?? null;
    case 'linux':
      return (
        assets.find((a) => a.name.endsWith('.AppImage')) ??
        assets.find((a) => a.name.endsWith('.deb')) ??
        null
      );
    default:
      return null;
  }
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  unknown: 'your platform',
};

export function DownloadClient({
  tag,
  publishedAt,
  assets,
  releaseUrl,
}: {
  tag: string;
  publishedAt: string;
  assets: AssetEntry[];
  releaseUrl: string;
}) {
  // Server render: 'unknown' so first paint is platform-agnostic. Detection
  // runs after hydration to avoid Cache-Control mismatches.
  const [platform, setPlatform] = useState<Platform>('unknown');
  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const primary = pickPrimaryAsset(platform, assets);
  const others = assets.filter((a) => !primary || a.url !== primary.url);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card>
        <div style={{ padding: 'var(--space-5)' }}>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <strong>{tag}</strong>{' '}
            <span style={{ color: 'var(--color-fg-muted)' }}>
              · published {new Date(publishedAt).toLocaleDateString()}
            </span>
          </div>
          {primary ? (
            <Button onClick={() => window.open(primary.url, '_blank')}>
              Download for {PLATFORM_LABEL[platform]} ({formatSize(primary.size)})
            </Button>
          ) : (
            <p style={{ color: 'var(--color-fg-muted)' }}>
              {platform === 'unknown'
                ? 'Detecting your platform…'
                : `No ${PLATFORM_LABEL[platform]} build in this release.`}{' '}
              See all assets below.
            </p>
          )}
        </div>
      </Card>
      <Card>
        <div style={{ padding: 'var(--space-5)' }}>
          <h3 style={{ marginTop: 0 }}>All downloads</h3>
          <ul
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              listStyle: 'none',
              padding: 0,
            }}
          >
            {others.map((a) => (
              <li key={a.url}>
                <a href={a.url} rel="noopener noreferrer">
                  {a.name}
                </a>{' '}
                <span style={{ color: 'var(--color-fg-muted)', fontSize: '0.85em' }}>
                  ({formatSize(a.size)})
                </span>
              </li>
            ))}
          </ul>
          <p
            style={{
              marginTop: 'var(--space-4)',
              fontSize: '0.9em',
              color: 'var(--color-fg-muted)',
            }}
          >
            <a href={releaseUrl} target="_blank" rel="noopener noreferrer">
              View release notes on GitHub →
            </a>
          </p>
        </div>
      </Card>
    </div>
  );
}
