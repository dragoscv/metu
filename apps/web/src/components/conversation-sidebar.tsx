'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, FolderKanban, MessageSquare, Plus, Sparkles } from 'lucide-react';
import { Button } from '@metu/ui';
import {
  archiveConversationAction,
  createSideChatAction,
  promoteSideChatAction,
} from '@/app/actions/conductor';

export interface ConvoListItem {
  id: string;
  title: string;
  kind: 'conductor' | 'side' | 'project' | 'tool';
  projectId: string | null;
  projectName: string | null;
  lastMessageAt: string | null;
}

export interface ProjectOption {
  id: string;
  name: string;
}

interface ConversationSidebarProps {
  activeId: string;
  conductorThread: ConvoListItem;
  sideChats: ConvoListItem[];
  projectChats: ConvoListItem[];
  projects: ProjectOption[];
}

export function ConversationSidebar({
  activeId,
  conductorThread,
  sideChats,
  projectChats,
  projects,
}: ConversationSidebarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [promoteFor, setPromoteFor] = useState<string | null>(null);

  function go(id: string) {
    router.push(`/chat?id=${id}`);
  }

  function newSideChat() {
    startTransition(async () => {
      const r = await createSideChatAction({});
      if (r.ok) router.push(`/chat?id=${r.id}`);
    });
  }

  function archive(id: string) {
    startTransition(async () => {
      await archiveConversationAction(id);
      if (id === activeId) router.push('/chat');
      router.refresh();
    });
  }

  function promote(conversationId: string, projectId: string) {
    startTransition(async () => {
      await promoteSideChatAction({ conversationId, projectId });
      setPromoteFor(null);
      router.refresh();
    });
  }

  return (
    <aside className="flex h-[calc(100vh-4rem)] w-64 shrink-0 flex-col gap-3 border-r border-[var(--color-border)] pr-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
          Threads
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={newSideChat}
          disabled={pending}
          aria-label="New side chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ConvoRow
        item={conductorThread}
        active={conductorThread.id === activeId}
        onSelect={go}
        icon={<Sparkles className="h-3.5 w-3.5" />}
      />

      <Section label="Side chats" empty="No side chats yet" items={sideChats}>
        {sideChats.map((c) => (
          <ConvoRow
            key={c.id}
            item={c}
            active={c.id === activeId}
            onSelect={go}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            menu={
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="text-[10px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPromoteFor(c.id);
                  }}
                >
                  Promote
                </button>
                <button
                  type="button"
                  className="text-[10px] text-[var(--color-fg-muted)] hover:text-[var(--color-danger,#ef4444)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    archive(c.id);
                  }}
                  aria-label={`Archive ${c.title}`}
                >
                  <Archive className="h-3 w-3" />
                </button>
              </div>
            }
            promoteOpen={promoteFor === c.id}
            promotePanel={
              <PromotePanel
                projects={projects}
                onCancel={() => setPromoteFor(null)}
                onPick={(projectId) => promote(c.id, projectId)}
                disabled={pending}
              />
            }
          />
        ))}
      </Section>

      <Section label="Project chats" empty="No project chats" items={projectChats}>
        {projectChats.map((c) => (
          <ConvoRow
            key={c.id}
            item={c}
            active={c.id === activeId}
            onSelect={go}
            icon={<FolderKanban className="h-3.5 w-3.5" />}
            subtitle={c.projectName ?? undefined}
            menu={
              <button
                type="button"
                className="text-[10px] text-[var(--color-fg-muted)] hover:text-[var(--color-danger,#ef4444)]"
                onClick={(e) => {
                  e.stopPropagation();
                  archive(c.id);
                }}
                aria-label={`Archive ${c.title}`}
              >
                <Archive className="h-3 w-3" />
              </button>
            }
          />
        ))}
      </Section>

      <div className="mt-auto pt-2 text-[10px] text-[var(--color-fg-subtle)]">
        <Link href="/chat" className="hover:text-[var(--color-fg-muted)]">
          Back to Conductor
        </Link>
      </div>
    </aside>
  );
}

function Section(props: {
  label: string;
  empty: string;
  items: ConvoListItem[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {props.label}
      </span>
      {props.items.length === 0 ? (
        <span className="px-1 text-xs text-[var(--color-fg-subtle)]">{props.empty}</span>
      ) : (
        <ul className="flex flex-col gap-0.5">{props.children}</ul>
      )}
    </div>
  );
}

function ConvoRow(props: {
  item: ConvoListItem;
  active: boolean;
  onSelect: (id: string) => void;
  icon: React.ReactNode;
  subtitle?: string;
  menu?: React.ReactNode;
  promoteOpen?: boolean;
  promotePanel?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={() => props.onSelect(props.item.id)}
        className={`group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          props.active
            ? 'bg-[var(--color-bg-elevated)] text-[var(--color-fg)]'
            : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]'
        }`}
      >
        <span className="text-[var(--color-fg-subtle)]">{props.icon}</span>
        <span className="flex-1 truncate">
          {props.item.title}
          {props.subtitle ? (
            <span className="ml-1 text-[10px] text-[var(--color-fg-subtle)]">
              · {props.subtitle}
            </span>
          ) : null}
        </span>
        {props.menu ? (
          <span className="opacity-0 transition-opacity group-hover:opacity-100">{props.menu}</span>
        ) : null}
      </button>
      {props.promoteOpen ? <div className="px-2 py-1">{props.promotePanel}</div> : null}
    </li>
  );
}

function PromotePanel(props: {
  projects: ProjectOption[];
  onCancel: () => void;
  onPick: (projectId: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
        Promote to project chat
      </div>
      {props.projects.length === 0 ? (
        <div className="text-xs text-[var(--color-fg-subtle)]">No projects in workspace.</div>
      ) : (
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {props.projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={props.disabled}
                onClick={() => props.onPick(p.id)}
                className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-[var(--color-bg-elevated)] disabled:opacity-50"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={props.onCancel}
        className="mt-1 text-[10px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]"
      >
        Cancel
      </button>
    </div>
  );
}
