'use client';
import { useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn, Button } from '@metu/ui';
import { archiveConversationAction, createSideChatAction } from '@/app/actions/conductor';

export interface ConvoListItem {
  id: string;
  kind: 'conductor' | 'side' | 'project' | 'tool';
  title: string;
  lastMessageAt: string | null;
  status: 'active' | 'archived' | 'pinned';
}

export function ConductorSidebar({
  conversations,
  activeId,
}: {
  conversations: ConvoListItem[];
  activeId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function selectConvo(id: string) {
    const sp = new URLSearchParams(searchParams);
    sp.set('id', id);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function newChat() {
    startTransition(async () => {
      const r = await createSideChatAction({});
      if (r.ok && r.id) selectConvo(r.id);
    });
  }

  const conductor = conversations.find((c) => c.kind === 'conductor');
  const sides = conversations.filter((c) => c.kind !== 'conductor');

  return (
    <aside className="flex h-[calc(100vh-4rem)] w-64 shrink-0 flex-col gap-3 border-r border-[var(--color-border)] pr-3">
      <Button size="sm" onClick={newChat} disabled={pending}>
        <Plus className="h-4 w-4" />
        New conversation
      </Button>

      {conductor && (
        <ConvoButton
          item={conductor}
          active={conductor.id === activeId}
          onClick={() => selectConvo(conductor.id)}
        />
      )}

      <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-subtle)]">
        Side chats
      </div>
      <ol className="flex flex-col gap-1 overflow-y-auto">
        {sides.length === 0 && (
          <li className="px-2 text-xs text-[var(--color-fg-subtle)]">No side chats.</li>
        )}
        {sides.map((c) => (
          <ConvoButton
            key={c.id}
            item={c}
            active={c.id === activeId}
            onClick={() => selectConvo(c.id)}
            onArchive={() =>
              startTransition(async () => {
                await archiveConversationAction(c.id);
                if (c.id === activeId && conductor) selectConvo(conductor.id);
              })
            }
          />
        ))}
      </ol>
    </aside>
  );
}

function ConvoButton({
  item,
  active,
  onClick,
  onArchive,
}: {
  item: ConvoListItem;
  active: boolean;
  onClick: () => void;
  onArchive?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        active
          ? 'text-[var(--color-fg)]'
          : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
      )}
    >
      {active && (
        <motion.span
          layoutId="conductor-active"
          className="absolute inset-0 -z-10 rounded-md bg-[var(--color-bg-card)]"
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
      <span className="flex-1 truncate">{item.title}</span>
      {onArchive && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          className="text-[10px] text-[var(--color-fg-subtle)] opacity-0 transition-opacity hover:text-[var(--color-fg)] group-hover:opacity-100"
          aria-label="archive"
        >
          ✕
        </span>
      )}
    </button>
  );
}
