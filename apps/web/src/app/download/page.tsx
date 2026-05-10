/**
 * Public /download page — surfaces the latest companion release with a
 * platform-specific primary button. The asset filenames come straight from
 * tauri-action's bundle naming convention; we do best-effort matching and
 * always fall back to "see all assets on GitHub" so the page never lies.
 *
 * UA detection runs on the client to avoid burning the page cache per visitor.
 * Server-rendered first paint shows all platforms equally.
 */
import { Page, PageHeader, PageSection } from '@metu/ui';
import { DownloadClient } from './download-client';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
interface Release {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  body: string;
  assets: ReleaseAsset[];
}

async function getLatestRelease(): Promise<Release | null> {
  const repo = process.env.COMPANION_RELEASES_REPO ?? 'metu-app/metu';
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    'user-agent': 'metu-web-download-page',
    accept: 'application/vnd.github+json',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      // Cache at the data layer for 5 minutes; the page itself opts into
      // ISR-ish behavior via `revalidate`.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as Release;
  } catch {
    return null;
  }
}

export default async function DownloadPage() {
  const release = await getLatestRelease();

  return (
    <Page>
      <PageHeader
        title="Download METU Companion"
        description="Cross-platform desktop assistant. Always-on listening, push-to-talk, system tools."
      />
      {release ? (
        <PageSection>
          <DownloadClient
            tag={release.tag_name}
            publishedAt={release.published_at}
            assets={release.assets.map((a) => ({
              name: a.name,
              url: a.browser_download_url,
              size: a.size,
            }))}
            releaseUrl={release.html_url}
          />
        </PageSection>
      ) : (
        <PageSection>
          <p style={{ color: 'var(--color-fg-muted)' }}>
            No releases published yet. Once we cut <code>companion-v0.1.0</code>, it will appear
            here.
          </p>
        </PageSection>
      )}
    </Page>
  );
}
