'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Button, Card } from '@metu/ui';
import {
  approveToolCallAction,
  rejectToolCallAction,
  undoToolCallAction,
} from '@/app/actions/conductor';

export interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  model?: string | null;
  provider?: string | null;
}

export interface ChatToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status:
    | 'pending'
    | 'awaiting_approval'
    | 'approved'
    | 'rejected'
    | 'running'
    | 'success'
    | 'failed'
    | 'undone'
    | 'cancelled';
  result: unknown;
  error: string | null;
  aclMode: string | null;
  estimatedCostUsd: number | null;
  requestedAt: string;
  finishedAt: string | null;
}

interface ConductorChatProps {
  conversationId: string;
  title: string;
  initialMessages: ChatMessage[];
  initialToolCalls: ChatToolCall[];
}

const STATUS_COLORS: Record<ChatToolCall['status'], string> = {
  pending: 'var(--color-fg-subtle)',
  awaiting_approval: 'var(--color-warning, #eab308)',
  approved: 'var(--color-success, #22c55e)',
  running: 'var(--color-brand)',
  success: 'var(--color-success, #22c55e)',
  rejected: 'var(--color-fg-subtle)',
  failed: 'var(--color-danger, #ef4444)',
  undone: 'var(--color-fg-subtle)',
  cancelled: 'var(--color-fg-subtle)',
};

export function ConductorChat({
  conversationId,
  title,
  initialMessages,
  initialToolCalls,
}: ConductorChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState<string>('');
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-sync when the server-provided history changes.
  useEffect(() => {
    setMessages(initialMessages);
    setStreaming('');
  }, [initialMessages, conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput('');
    setPending(true);
    setStreaming('');
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);

    try {
      const res = await fetch('/api/conductor/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, content: text }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreaming(acc);
      }
      setStreaming('');
      // Refresh from server: persisted assistant message + any tool_calls.
      router.refresh();
    } catch (err) {
      setStreaming('');
      setMessages((m) => [
        ...m,
        {
          id: `err-${Date.now()}`,
          role: 'system',
          content: `Stream failed: ${err instanceof Error ? err.message : String(err)}`,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <span className="text-xs text-[var(--color-fg-subtle)]">{messages.length} messages</span>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4"
      >
        <ol className="space-y-4">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.li
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-1"
              >
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  {m.role}
                  {m.model ? ` · ${m.model}` : ''}
                </span>
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] self-end whitespace-pre-wrap rounded-md bg-[var(--color-brand)] px-3 py-2 text-sm text-[var(--color-brand-fg)]'
                      : m.role === 'assistant'
                        ? 'max-w-[85%] whitespace-pre-wrap rounded-md bg-[var(--color-bg-elevated)] px-3 py-2 text-sm'
                        : 'max-w-[85%] whitespace-pre-wrap rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-fg-muted)]'
                  }
                >
                  {m.content}
                </div>
              </motion.li>
            ))}
            {streaming && (
              <motion.li
                key="streaming"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col gap-1"
              >
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  assistant · streaming
                </span>
                <div className="max-w-[85%] whitespace-pre-wrap rounded-md bg-[var(--color-bg-elevated)] px-3 py-2 text-sm">
                  {streaming}
                  <span className="ml-1 inline-block h-3 w-[2px] animate-pulse bg-[var(--color-fg-muted)]" />
                </div>
              </motion.li>
            )}
          </AnimatePresence>
        </ol>

        {initialToolCalls.length > 0 && (
          <section className="mt-6 border-t border-[var(--color-border)] pt-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-fg-subtle)]">
              Tool calls
            </h3>
            <ol className="space-y-2">
              {initialToolCalls.map((tc) => (
                <ToolCallRow key={tc.id} tc={tc} />
              ))}
            </ol>
          </section>
        )}
      </div>

      <Composer value={input} onChange={setInput} onSend={send} disabled={pending} />
    </div>
  );
}

function ToolCallRow({ tc }: { tc: ChatToolCall }) {
  const [, startTransition] = useTransition();

  return (
    <Card className="!p-3">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-2 w-2 shrink-0 rounded-full"
          style={{ background: STATUS_COLORS[tc.status] }}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm">
            <code className="font-mono">{tc.tool}</code>
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              {tc.status} · {tc.aclMode ?? 'n/a'}
            </span>
          </div>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-[var(--color-bg-elevated)] p-2 text-[11px] text-[var(--color-fg-muted)]">
            {JSON.stringify(tc.args, null, 2)}
          </pre>
          {tc.error && (
            <div className="mt-1 text-xs text-[var(--color-danger,#ef4444)]">{tc.error}</div>
          )}
          {tc.status === 'awaiting_approval' && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  startTransition(async () => {
                    await approveToolCallAction(tc.id);
                  })
                }
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  startTransition(async () => {
                    await rejectToolCallAction(tc.id);
                  })
                }
              >
                Reject
              </Button>
            </div>
          )}
          {tc.status === 'success' && (
            <div className="mt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  startTransition(async () => {
                    await undoToolCallAction(tc.id);
                  })
                }
              >
                Undo
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Composer({
  value,
  onChange,
  onSend,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      className="flex items-end gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2"
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        rows={2}
        placeholder="Talk to the Conductor — recall, decide, ship."
        className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none"
        disabled={disabled}
      />
      <Button type="submit" disabled={disabled || !value.trim()} size="sm">
        {disabled ? 'Streaming…' : 'Send'}
      </Button>
    </form>
  );
}
