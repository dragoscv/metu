import { Badge } from '@metu/ui';
import { ExternalLink, FileText, Github, Globe, Hash, Layers, Link2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { Favicon } from '@/components/favicon';

const PROVIDER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  github: Github,
  gitlab: Github,
  notion: FileText,
  linear: Layers,
  slack: Hash,
  gdrive: FileText,
  figma: Layers,
  generic: Globe,
};

const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  notion: 'Notion',
  linear: 'Linear',
  slack: 'Slack',
  gdrive: 'Drive',
  figma: 'Figma',
  generic: 'Link',
};

export interface ResourceItem {
  id: string;
  provider: string;
  kind: string;
  title: string;
  url: string;
  metadata: Record<string, unknown>;
}

export function LinkedResourcesPanel({
  links,
  editHref,
}: {
  links: ResourceItem[];
  editHref: string;
}) {
  if (links.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-5 text-center text-xs text-[var(--color-fg-subtle)]">
        No links yet.{' '}
        <a href={editHref} className="text-[var(--color-brand)] hover:underline">
          Attach a repo or URL
        </a>
        .
      </p>
    );
  }

  // group by provider for nicer display
  const byProvider = new Map<string, ResourceItem[]>();
  for (const l of links) {
    const list = byProvider.get(l.provider) ?? [];
    list.push(l);
    byProvider.set(l.provider, list);
  }

  return (
    <div className="space-y-3">
      {Array.from(byProvider.entries()).map(([provider, items]) => {
        const Icon = PROVIDER_ICONS[provider] ?? Link2;
        return (
          <div
            key={provider}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)]"
          >
            <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
              <Icon className="h-3.5 w-3.5 text-[var(--color-fg-muted)]" />
              <span className="text-xs font-semibold">{PROVIDER_LABEL[provider] ?? provider}</span>
              <Badge size="xs" variant="neutral">
                {items.length}
              </Badge>
            </header>
            <ul className="divide-y divide-[var(--color-border)]">
              {items.map((l) => {
                const meta = l.metadata as {
                  language?: string;
                  private?: boolean;
                  stars?: number;
                };
                return (
                  <li key={l.id} className="flex items-center gap-2 px-3 py-2">
                    {provider === 'generic' && (
                      <Favicon url={l.url} className="h-4 w-4 shrink-0 rounded-sm" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{l.title}</span>
                        {l.kind !== 'url' && (
                          <Badge size="xs" variant="outline">
                            {l.kind}
                          </Badge>
                        )}
                        {meta.private && (
                          <Badge size="xs" variant="warning">
                            private
                          </Badge>
                        )}
                        {meta.language && (
                          <Badge size="xs" variant="neutral">
                            {meta.language}
                          </Badge>
                        )}
                      </div>
                      <span className="block truncate text-[11px] text-[var(--color-fg-subtle)]">
                        {l.url}
                      </span>
                    </div>
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
                      aria-label="Open"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
