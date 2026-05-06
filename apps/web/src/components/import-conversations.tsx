'use client';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Upload, FileText, Loader2, Check } from 'lucide-react';
import { Button } from '@metu/ui';
import { importConversationsAction } from '@/app/actions/import-conversations';
import { detectFormat, type ConversationFormat } from '@/lib/conversation-import/parse';

interface ProjectOption {
  id: string;
  name: string;
}

interface Props {
  projects: ProjectOption[];
}

const FORMATS: { value: ConversationFormat | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'chatgpt-json', label: 'ChatGPT export (JSON)' },
  { value: 'claude-json', label: 'Claude export (JSON)' },
  { value: 'markdown', label: 'Markdown / pasted text' },
];

export function ImportConversations({ projects }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [format, setFormat] = useState<ConversationFormat | 'auto'>('auto');
  const [projectId, setProjectId] = useState('');
  const [pending, start] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const detected = text.trim().length > 0 ? detectFormat(text) : null;

  function reset() {
    setText('');
    setFormat('auto');
    setProjectId('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function submitText(raw: string) {
    if (!raw.trim()) {
      toast.error('Nothing to import');
      return;
    }
    start(async () => {
      const r = await importConversationsAction({
        raw,
        format: format === 'auto' ? undefined : format,
        projectId: projectId || null,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      const { imported, skipped } = r.data;
      toast.success(
        `Imported ${imported} conversation${imported === 1 ? '' : 's'}` +
          (skipped > 0 ? ` (${skipped} skipped)` : ''),
      );
      reset();
      setOpen(false);
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      toast.error('File too large (max 25 MB)');
      return;
    }
    const raw = await file.text();
    await submitText(raw);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)]"
      >
        <Upload className="h-3.5 w-3.5" />
        Import conversation (ChatGPT, Claude, …)
      </button>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-[var(--color-fg-muted)]" />
          <h3 className="text-sm font-medium">Import conversation</h3>
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-xs text-[var(--color-fg-subtle)] hover:underline"
          disabled={pending}
        >
          Cancel
        </button>
      </div>

      <div className="mb-3 inline-flex rounded-[var(--radius)] border border-[var(--color-border)] p-0.5 text-xs">
        {(['paste', 'file'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-[calc(var(--radius)-2px)] px-3 py-1 transition-colors ${
              tab === t
                ? 'bg-[var(--color-bg-elevated)] text-[var(--color-fg)]'
                : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]'
            }`}
          >
            {t === 'paste' ? 'Paste text' : 'Upload file'}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="block text-[var(--color-fg-subtle)]">Format</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ConversationFormat | 'auto')}
            disabled={pending}
            className="mt-1 h-9 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 text-sm"
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-[var(--color-fg-subtle)]">Attach to project (optional)</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={pending}
            className="mt-1 h-9 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 text-sm"
          >
            <option value="">— none —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tab === 'paste' ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
            placeholder={
              'Paste a ChatGPT/Claude export (conversations.json), or a chat in markdown:\n\nUser: …\nAssistant: …'
            }
            rows={8}
            className="w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 font-mono text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-[var(--color-fg-subtle)]">
              {detected ? (
                <>
                  <Check className="-mt-0.5 inline h-3 w-3 text-[var(--color-success)]" /> Detected:{' '}
                  <code>{detected}</code>
                </>
              ) : (
                'Paste content above'
              )}
            </p>
            <Button
              type="button"
              onClick={() => submitText(text)}
              disabled={pending || !text.trim()}
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Importing…
                </>
              ) : (
                'Import'
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="bg-[var(--color-bg-elevated)]/50 block cursor-pointer rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)]">
            <FileText className="mx-auto mb-2 h-5 w-5" />
            <span className="block">
              {pending ? 'Importing…' : 'Click to choose a JSON or Markdown file'}
            </span>
            <span className="mt-1 block text-[10px] text-[var(--color-fg-subtle)]">
              .json / .md / .txt · up to 25 MB
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.md,.txt,application/json,text/markdown,text/plain"
              onChange={onFile}
              disabled={pending}
              className="hidden"
            />
          </label>
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            ChatGPT export: extract the zip and upload <code>conversations.json</code>. Claude
            export: same — upload <code>conversations.json</code>.
          </p>
        </div>
      )}
    </div>
  );
}
