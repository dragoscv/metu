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
  deleteNote,
  listFolders,
  listNotes,
  updateNote,
} from '@/lib/notes';

export function NotesApp({ token }: { token: string }) {
  const [notes, setNotes] = useState<NotaiNote[]>([]);
  const [folders, setFolders] = useState<NotaiFolder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleNotes = useMemo(
    () => (activeFolder ? notes.filter((n) => n.folderId === activeFolder) : notes),
    [notes, activeFolder],
  );
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
        style={{ borderRight: '1px solid #2a2a32', background: '#0f0f12', display: 'flex', flexDirection: 'column' }}
      >
        <header style={{ padding: '0.75rem', borderBottom: '1px solid #2a2a32', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#9b9ba1', textTransform: 'uppercase', letterSpacing: 0.5 }}>Notes</span>
          <button
            type="button"
            onClick={onCreate}
            style={{ background: '#7c3aed', color: 'white', border: 'none', borderRadius: 6, padding: '0.25rem 0.6rem', fontSize: 12, cursor: 'pointer' }}
          >
            + New
          </button>
        </header>
        <div style={{ borderBottom: '1px solid #2a2a32', padding: '0.4rem 0.5rem', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
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
            style={{ marginLeft: 'auto', fontSize: 11, padding: '0.2rem 0.4rem', borderRadius: 4, border: '1px dashed #2a2a32', cursor: 'pointer', background: 'transparent', color: '#9b9ba1' }}
          >
            +
          </button>
        </div>
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
                onClick={() => setActiveId(n.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: n.id === activeId ? '#1c1c22' : 'transparent',
                  color: '#e7e7ea',
                  border: 'none',
                  borderBottom: '1px solid #1a1a20',
                  padding: '0.6rem 0.75rem',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.title || 'Untitled'}
                </div>
                <div style={{ fontSize: 11, color: '#9b9ba1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.9rem', borderBottom: '1px solid #2a2a32' }}>
              <input
                value={active.title}
                onChange={(e) => patchActive({ title: e.target.value })}
                placeholder="Untitled"
                style={{ flex: 1, background: 'transparent', color: '#e7e7ea', border: 'none', fontSize: 16, fontWeight: 600, outline: 'none' }}
              />
              <span style={{ fontSize: 11, color: '#9b9ba1', marginRight: 12 }}>
                {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString()}` : 'Auto-saves'}
              </span>
              <button
                type="button"
                onClick={() => onDelete(active.id)}
                style={{ background: 'transparent', color: '#f87171', border: '1px solid #2a2a32', borderRadius: 6, padding: '0.25rem 0.6rem', fontSize: 12, cursor: 'pointer' }}
              >
                Delete
              </button>
            </header>
            <textarea
              value={active.body}
              onChange={(e) => patchActive({ body: e.target.value })}
              placeholder="Start typing… every save flows into your metu second brain."
              style={{ flex: 1, background: '#0a0a0c', color: '#e7e7ea', border: 'none', padding: '1rem', fontSize: 14, lineHeight: 1.6, resize: 'none', outline: 'none', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
            />
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#9b9ba1' }}>
            Pick a note or create a new one.
          </div>
        )}
      </section>
      {err ? (
        <p style={{ position: 'absolute', bottom: 16, right: 16, color: '#f87171', fontSize: 12 }}>{err}</p>
      ) : null}
    </div>
  );
}
