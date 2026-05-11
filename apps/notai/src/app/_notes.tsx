'use client';
/**
 * notai notes app — sidebar (notes list) + editor pane.
 *
 * Auto-saves on a debounce so the brain dump in metu memory stays
 * fresh without an explicit save button. Every save round-trips
 * through the metu SDK route which mirrors the note as a `capture`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type NotaiFolder,
  type NotaiNote,
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  listFolders,
  listNotes,
  renameFolder,
  updateNote,
} from '@/lib/notes';

export function NotesApp({ token }: { token: string }) {
  const [notes, setNotes] = useState<NotaiNote[]>([]);
  const [folders, setFolders] = useState<NotaiFolder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleNotes = useMemo(() => {
    let xs = activeFolder ? notes.filter((n) => n.folderId === activeFolder) : notes;
    const q = search.trim().toLowerCase();
    if (q) {
      xs = xs.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
    }
    return xs;
  }, [notes, activeFolder, search]);
  const active = useMemo(() => notes.find((n) => n.id === activeId) ?? null, [notes, activeId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [fresh, fls] = await Promise.all([listNotes(token), listFolders(token)]);
      setNotes(fresh);
      setFolders(fls);
      if (!activeId && fresh[0]) setActiveId(fresh[0].id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [token, activeId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onCreate() {
    setErr(null);
    try {
      const n = await createNote(token, { title: 'Untitled', body: '', folderId: activeFolder });
      setNotes((prev) => [n, ...prev]);
      setActiveId(n.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'create failed');
    }
  }

  async function onCreateFolder() {
    const name = window.prompt('Folder name?');
    if (!name?.trim()) return;
    try {
      const f = await createFolder(token, { name: name.trim() });
      setFolders((prev) => [...prev, f]);
      setActiveFolder(f.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'folder create failed');
    }
  }

  async function onRenameFolder(f: NotaiFolder) {
    const name = window.prompt('Rename folder', f.name);
    if (!name?.trim() || name.trim() === f.name) return;
    const next = name.trim();
    try {
      await renameFolder(token, f.id, next);
      setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, name: next } : x)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'folder rename failed');
    }
  }

  async function onDeleteFolder(f: NotaiFolder) {
    if (!window.confirm(`Delete folder "${f.name}"? Notes inside will move to All.`)) return;
    try {
      await deleteFolder(token, f.id);
      setFolders((prev) => prev.filter((x) => x.id !== f.id));
      // Notes whose folderId pointed here become "All" via the FK ON DELETE SET NULL —
      // mirror that locally so the next render is consistent without a refetch.
      setNotes((prev) => prev.map((n) => (n.folderId === f.id ? { ...n, folderId: null } : n)));
      if (activeFolder === f.id) setActiveFolder(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'folder delete failed');
    }
  }

  function patchActive(patch: { title?: string; body?: string }) {
    if (!active) return;
    setNotes((prev) => prev.map((n) => (n.id === active.id ? { ...n, ...patch } : n)));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await updateNote(token, active.id, patch);
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        setSavedAt(Date.now());
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'save failed');
      }
    }, 600);
  }

  async function onDelete(id: string) {
    setErr(null);
    try {
      await deleteNote(token, id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (activeId === id) setActiveId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    }
  }

  function onRowClick(id: string, e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      // Multi-select toggle. Shift behaves the same as Cmd here — proper
      // range-select would need a lastSelectedIndex anchor.
      e.preventDefault();
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setSelection(new Set());
    setActiveId(id);
  }

  async function onBulkDelete() {
    if (selection.size === 0) return;
    if (!window.confirm(`Delete ${selection.size} note${selection.size === 1 ? '' : 's'}?`)) return;
    const ids = [...selection];
    try {
      await Promise.all(ids.map((id) => deleteNote(token, id)));
      setNotes((prev) => prev.filter((n) => !selection.has(n.id)));
      if (activeId && selection.has(activeId)) setActiveId(null);
      setSelection(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'bulk delete failed');
    }
  }

  async function onBulkMove(folderId: string | null) {
    if (selection.size === 0) return;
    const ids = [...selection];
    try {
      await Promise.all(ids.map((id) => updateNote(token, id, { folderId })));
      setNotes((prev) => prev.map((n) => (selection.has(n.id) ? { ...n, folderId } : n)));
      setSelection(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'bulk move failed');
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        gap: 0,
        border: '1px solid #2a2a32',
        borderRadius: 12,
        overflow: 'hidden',
        height: 'calc(100vh - 200px)',
        minHeight: 480,
      }}
    >
      <aside
        style={{
          borderRight: '1px solid #2a2a32',
          background: '#0f0f12',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header
          style={{
            padding: '0.75rem',
            borderBottom: '1px solid #2a2a32',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: '#9b9ba1',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
          >
            Notes
          </span>
          <button
            type="button"
            onClick={onCreate}
            style={{
              background: '#7c3aed',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '0.25rem 0.6rem',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            + New
          </button>
        </header>
        <div
          style={{
            borderBottom: '1px solid #2a2a32',
            padding: '0.4rem 0.5rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            alignItems: 'center',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveFolder(null)}
            style={{
              fontSize: 11,
              padding: '0.2rem 0.5rem',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              background: activeFolder === null ? '#7c3aed' : 'transparent',
              color: activeFolder === null ? 'white' : '#9b9ba1',
            }}
          >
            All
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setActiveFolder(f.id)}
              onDoubleClick={() => onRenameFolder(f)}
              onContextMenu={(e) => {
                e.preventDefault();
                onDeleteFolder(f);
              }}
              title="Click to filter · double-click to rename · right-click to delete"
              style={{
                fontSize: 11,
                padding: '0.2rem 0.5rem',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                background: activeFolder === f.id ? '#7c3aed' : 'transparent',
                color: activeFolder === f.id ? 'white' : '#9b9ba1',
              }}
            >
              {f.name}
            </button>
          ))}
          <button
            type="button"
            onClick={onCreateFolder}
            title="New folder"
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              padding: '0.2rem 0.4rem',
              borderRadius: 4,
              border: '1px dashed #2a2a32',
              cursor: 'pointer',
              background: 'transparent',
              color: '#9b9ba1',
            }}
          >
            +
          </button>
        </div>
        <div style={{ borderBottom: '1px solid #2a2a32', padding: '0.4rem 0.5rem' }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or body…"
            style={{
              width: '100%',
              background: '#1c1c22',
              color: '#e7e7ea',
              border: '1px solid #2a2a32',
              borderRadius: 4,
              padding: '0.3rem 0.5rem',
              fontSize: 12,
              outline: 'none',
            }}
          />
        </div>
        {selection.size > 0 ? (
          <div
            style={{
              borderBottom: '1px solid #2a2a32',
              padding: '0.4rem 0.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#16121f',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 11, color: '#c4b5fd' }}>{selection.size} selected</span>
            <select
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                onBulkMove(v === '__none__' ? null : v);
                e.currentTarget.value = '';
              }}
              defaultValue=""
              style={{
                fontSize: 11,
                background: '#1c1c22',
                color: '#e7e7ea',
                border: '1px solid #2a2a32',
                borderRadius: 4,
                padding: '0.2rem 0.4rem',
              }}
            >
              <option value="" disabled>
                Move to…
              </option>
              <option value="__none__">All (no folder)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onBulkDelete}
              style={{
                fontSize: 11,
                background: 'transparent',
                color: '#f87171',
                border: '1px solid #2a2a32',
                borderRadius: 4,
                padding: '0.2rem 0.5rem',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setSelection(new Set())}
              style={{
                fontSize: 11,
                marginLeft: 'auto',
                background: 'transparent',
                color: '#9b9ba1',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        ) : null}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && visibleNotes.length === 0 ? (
            <p style={{ padding: '0.75rem', color: '#9b9ba1', fontSize: 12 }}>Loading…</p>
          ) : visibleNotes.length === 0 ? (
            <p style={{ padding: '0.75rem', color: '#9b9ba1', fontSize: 12 }}>
              No notes yet. Create one to seed your brain dump.
            </p>
          ) : (
            visibleNotes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={(e) => onRowClick(n.id, e)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: selection.has(n.id)
                    ? '#3b1d6b'
                    : n.id === activeId
                      ? '#1c1c22'
                      : 'transparent',
                  color: '#e7e7ea',
                  border: 'none',
                  borderBottom: '1px solid #1a1a20',
                  padding: '0.6rem 0.75rem',
                  cursor: 'pointer',
                  // Per-row view-transition name lets browsers animate
                  // reorder / delete when the list changes (Chrome 111+).
                  viewTransitionName: `notai-note-${n.id}`,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {n.title || 'Untitled'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#9b9ba1',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {n.body.slice(0, 60) || 'Empty'}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section style={{ display: 'flex', flexDirection: 'column' }}>
        {active ? (
          <>
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.6rem 0.9rem',
                borderBottom: '1px solid #2a2a32',
              }}
            >
              <input
                value={active.title}
                onChange={(e) => patchActive({ title: e.target.value })}
                placeholder="Untitled"
                style={{
                  flex: 1,
                  background: 'transparent',
                  color: '#e7e7ea',
                  border: 'none',
                  fontSize: 16,
                  fontWeight: 600,
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: 11, color: '#9b9ba1', marginRight: 12 }}>
                {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : 'Auto-saves'}
              </span>
              <button
                type="button"
                onClick={() => onDelete(active.id)}
                style={{
                  background: 'transparent',
                  color: '#f87171',
                  border: '1px solid #2a2a32',
                  borderRadius: 6,
                  padding: '0.25rem 0.6rem',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>
            </header>
            <textarea
              value={active.body}
              onChange={(e) => patchActive({ body: e.target.value })}
              placeholder="Start typing… every save flows into your metu second brain."
              style={{
                flex: 1,
                background: '#0a0a0c',
                color: '#e7e7ea',
                border: 'none',
                padding: '1rem',
                fontSize: 14,
                lineHeight: 1.6,
                resize: 'none',
                outline: 'none',
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
              }}
            />
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              color: '#9b9ba1',
            }}
          >
            Pick a note or create a new one.
          </div>
        )}
      </section>
      {err ? (
        <p style={{ position: 'absolute', bottom: 16, right: 16, color: '#f87171', fontSize: 12 }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}
