'use client';
/**
 * PersonaManager — Settings → Presence CRUD UI.
 *
 * Lists workspace personas (built-ins first), lets the user edit a small
 * curated set of fields per row, clone any persona into a new custom one,
 * and delete custom personas. Voice/STT/avatar pickers are constrained to
 * the canonical provider catalogs in `@metu/presence`.
 */
import { useState, useTransition } from 'react';
import { Badge, Button, Card, CardTitle } from '@metu/ui';
import {
  AVATAR_KINDS,
  COST_TIERS,
  PERSONA_FORMS,
  PERSONA_MODES,
  PROACTIVITY,
  type AvatarKind,
  type CostTier,
  type PersonaForm,
  type PersonaMode,
  type Proactivity,
} from '@metu/presence';
import {
  createPersonaAction,
  deletePersonaAction,
  seedBuiltInPersonasAction,
  updatePersonaAction,
} from '@/app/actions/personas';

const VOICE_PROVIDERS = [
  'openai-realtime',
  'cartesia-sonic-turbo',
  'elevenlabs-flash',
  'deepgram-aura-2',
  'none',
] as const;

const STT_PROVIDERS = [
  'deepgram-nova3',
  'openai-whisper-1',
  'openai-4o-mini-transcribe',
  'local-whisper-cpp',
] as const;

// Per-minute and per-million-token estimates mirrored from
// `apps/web/src/lib/voice-billing.ts`. Kept inline here because this is
// a client component and pricing is plain data, not a secret.
const VOICE_COST_PREVIEW: Record<string, string> = {
  'openai-realtime': '~$0.06/min (5/20 per Mtok in/out)',
  'anthropic-realtime': '~$0.06/min (5/20 per Mtok in/out)',
  'cartesia-sonic-turbo': '~$0.017/min',
  'elevenlabs-flash': '~$0.083/min',
  'deepgram-aura-2': '~$0.030/min',
  'piper-local': 'free (on-device)',
  none: 'text only',
};

function voiceCostPreview(provider: string): string {
  return VOICE_COST_PREVIEW[provider] ?? '—';
}

export interface PersonaRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  systemPrompt: string;
  voiceProvider: string;
  voiceId: string;
  sttProvider: string;
  avatarKind: string;
  defaultForm: string;
  hotkey: string | null;
  wakeWord: string | null;
  proactivity: string;
  language: string;
  costTier: string;
  mode: string;
  eagerness: number;
  isBuiltIn: boolean;
}

export function PersonaManager({ initial }: { initial: PersonaRow[] }) {
  const [rows, setRows] = useState<PersonaRow[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function refreshFromServer() {
    // Server actions revalidate the page; the parent re-renders with fresh
    // `initial`. Locally we optimistically update state already.
  }

  function handleSeed() {
    setError(null);
    startTransition(async () => {
      const res = await seedBuiltInPersonasAction();
      if (!res.ok) setError(res.error);
      else refreshFromServer();
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this persona? This cannot be undone.')) return;
    setError(null);
    startTransition(async () => {
      const res = await deletePersonaAction(id);
      if (!res.ok) setError(res.error);
      else setRows((prev) => prev.filter((r) => r.id !== id));
    });
  }

  function handleSave(id: string, patch: Partial<PersonaRow>) {
    setError(null);
    startTransition(async () => {
      const res = await updatePersonaAction({
        id,
        name: patch.name,
        description: patch.description,
        systemPrompt: patch.systemPrompt,
        voiceProvider: patch.voiceProvider as (typeof VOICE_PROVIDERS)[number] | undefined,
        voiceId: patch.voiceId,
        sttProvider: patch.sttProvider as (typeof STT_PROVIDERS)[number] | undefined,
        avatarKind: patch.avatarKind as AvatarKind | undefined,
        defaultForm: patch.defaultForm as PersonaForm | undefined,
        hotkey: patch.hotkey === undefined ? undefined : patch.hotkey,
        wakeWord: patch.wakeWord === undefined ? undefined : patch.wakeWord,
        proactivity: patch.proactivity as Proactivity | undefined,
        language: patch.language,
        costTier: patch.costTier as CostTier | undefined,
        mode: patch.mode as PersonaMode | undefined,
        eagerness: patch.eagerness,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      setEditingId(null);
    });
  }

  if (rows.length === 0) {
    return (
      <Card className="p-6 text-center">
        <CardTitle>Set up your personas</CardTitle>
        <p className="text-muted-foreground mt-2 text-sm">
          Seed the five built-in personas (Atlas, Iris, Mira, Echo, metu) to your workspace. You can
          edit, clone, or extend them afterwards.
        </p>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        <Button className="mt-4" onClick={handleSeed} disabled={pending}>
          {pending ? 'Seeding…' : 'Seed built-in personas'}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {rows.length} persona{rows.length === 1 ? '' : 's'} ·{' '}
          {rows.filter((r) => r.isBuiltIn).length} built-in
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSeed} disabled={pending}>
            Re-seed missing built-ins
          </Button>
          <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancel' : 'New custom persona'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {showCreate && (
        <CreatePersonaForm
          onCreated={(row) => {
            setRows((prev) => [...prev, row]);
            setShowCreate(false);
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((p) =>
          editingId === p.id ? (
            <EditPersonaForm
              key={p.id}
              row={p}
              onSave={(patch) => handleSave(p.id, patch)}
              onCancel={() => setEditingId(null)}
              pending={pending}
            />
          ) : (
            <PersonaCard
              key={p.id}
              row={p}
              onEdit={() => setEditingId(p.id)}
              onDelete={() => handleDelete(p.id)}
              pending={pending}
            />
          ),
        )}
      </div>
    </div>
  );
}

// ─── Read-only card ───────────────────────────────────────────────────────

function PersonaCard({
  row,
  onEdit,
  onDelete,
  pending,
}: {
  row: PersonaRow;
  onEdit: () => void;
  onDelete: () => void;
  pending: boolean;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between">
        <div>
          <CardTitle>{row.name}</CardTitle>
          <p className="text-muted-foreground text-xs">{row.slug}</p>
        </div>
        {row.isBuiltIn && <Badge>built-in</Badge>}
      </div>
      <p className="text-muted-foreground text-sm">{row.description}</p>
      <dl className="text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt>Voice</dt>
        <dd className="text-foreground">
          {row.voiceProvider === 'none' ? '—' : `${row.voiceProvider} · ${row.voiceId}`}
        </dd>
        <dt>STT</dt>
        <dd className="text-foreground">{row.sttProvider}</dd>
        <dt>Avatar</dt>
        <dd className="text-foreground">{row.avatarKind}</dd>
        <dt>Default form</dt>
        <dd className="text-foreground">{row.defaultForm}</dd>
        <dt>Hotkey</dt>
        <dd className="text-foreground">{row.hotkey ?? '—'}</dd>
        <dt>Wake word</dt>
        <dd className="text-foreground">{row.wakeWord ?? '—'}</dd>
        <dt>Proactivity</dt>
        <dd className="text-foreground">{row.proactivity}</dd>
      </dl>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} disabled={pending}>
          Edit
        </Button>
        {!row.isBuiltIn && (
          <Button size="sm" variant="ghost" onClick={onDelete} disabled={pending}>
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}

// ─── Edit form ────────────────────────────────────────────────────────────

function EditPersonaForm({
  row,
  onSave,
  onCancel,
  pending,
}: {
  row: PersonaRow;
  onSave: (patch: Partial<PersonaRow>) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const [draft, setDraft] = useState<PersonaRow>(row);

  function update<K extends keyof PersonaRow>(key: K, value: PersonaRow[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <CardTitle>Edit · {row.slug}</CardTitle>
        {row.isBuiltIn && <Badge>built-in</Badge>}
      </div>

      <Field label="Name">
        <input
          className={inputCls}
          value={draft.name}
          onChange={(e) => update('name', e.target.value)}
        />
      </Field>
      <Field label="Description">
        <input
          className={inputCls}
          value={draft.description}
          onChange={(e) => update('description', e.target.value)}
        />
      </Field>
      <Field label="System prompt">
        <textarea
          className={`${inputCls} min-h-[6rem]`}
          value={draft.systemPrompt}
          onChange={(e) => update('systemPrompt', e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Voice provider">
          <select
            className={inputCls}
            value={draft.voiceProvider}
            onChange={(e) => update('voiceProvider', e.target.value)}
          >
            {VOICE_PROVIDERS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
            Estimated cost: {voiceCostPreview(draft.voiceProvider)}
          </p>
        </Field>
        <Field label="Voice ID">
          <input
            className={inputCls}
            value={draft.voiceId}
            onChange={(e) => update('voiceId', e.target.value)}
            disabled={draft.voiceProvider === 'none'}
          />
        </Field>
        <Field label="STT provider">
          <select
            className={inputCls}
            value={draft.sttProvider}
            onChange={(e) => update('sttProvider', e.target.value)}
          >
            {STT_PROVIDERS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Avatar kind">
          <select
            className={inputCls}
            value={draft.avatarKind}
            onChange={(e) => update('avatarKind', e.target.value)}
          >
            {AVATAR_KINDS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default form">
          <select
            className={inputCls}
            value={draft.defaultForm}
            onChange={(e) => update('defaultForm', e.target.value)}
          >
            {PERSONA_FORMS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Proactivity">
          <select
            className={inputCls}
            value={draft.proactivity}
            onChange={(e) => update('proactivity', e.target.value)}
          >
            {PROACTIVITY.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hotkey">
          <input
            className={inputCls}
            value={draft.hotkey ?? ''}
            placeholder="e.g. Ctrl+Alt+A"
            onChange={(e) => update('hotkey', e.target.value || null)}
          />
        </Field>
        <Field label="Wake word">
          <input
            className={inputCls}
            value={draft.wakeWord ?? ''}
            placeholder="e.g. hey-mira"
            onChange={(e) => update('wakeWord', e.target.value || null)}
          />
        </Field>
        <Field label="Mode">
          <select
            className={inputCls}
            value={draft.mode}
            onChange={(e) => update('mode', e.target.value)}
          >
            {PERSONA_MODES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cost tier">
          <select
            className={inputCls}
            value={draft.costTier}
            onChange={(e) => update('costTier', e.target.value)}
          >
            {COST_TIERS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Language">
          <select
            className={inputCls}
            value={draft.language}
            onChange={(e) => update('language', e.target.value)}
          >
            {['en', 'ro', 'fr', 'de', 'es'].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Eagerness · ${draft.eagerness}`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.eagerness}
            onChange={(e) => update('eagerness', Number(e.target.value))}
            className="w-full"
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onSave({
              name: draft.name,
              description: draft.description,
              systemPrompt: draft.systemPrompt,
              voiceProvider: draft.voiceProvider,
              voiceId: draft.voiceId,
              sttProvider: draft.sttProvider,
              avatarKind: draft.avatarKind,
              defaultForm: draft.defaultForm,
              proactivity: draft.proactivity,
              hotkey: draft.hotkey,
              wakeWord: draft.wakeWord,
              language: draft.language,
              costTier: draft.costTier,
              mode: draft.mode,
              eagerness: draft.eagerness,
            })
          }
          disabled={pending}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Card>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────

function CreatePersonaForm({
  onCreated,
  onError,
}: {
  onCreated: (row: PersonaRow) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [voiceProvider, setVoiceProvider] =
    useState<(typeof VOICE_PROVIDERS)[number]>('openai-realtime');
  const [voiceId, setVoiceId] = useState('verse');
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim() || !slug.trim()) {
      onError('Name and slug are required.');
      return;
    }
    startTransition(async () => {
      const res = await createPersonaAction({
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        description,
        systemPrompt,
        voiceProvider,
        voiceId,
        voiceTuning: {},
        sttProvider: 'deepgram-nova3',
        avatarKind: 'orb',
        avatarUrl: null,
        formPrefs: { panel: true, inWindow: true, hud: true, assistant: false },
        defaultForm: 'panel',
        wakeWord: null,
        hotkey: null,
        proactivity: 'gentle',
        aclOverrides: {},
      });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onCreated({
        id: res.id,
        slug: slug.trim().toLowerCase(),
        name: name.trim(),
        description,
        systemPrompt,
        voiceProvider,
        voiceId,
        sttProvider: 'deepgram-nova3',
        avatarKind: 'orb',
        defaultForm: 'panel',
        hotkey: null,
        wakeWord: null,
        proactivity: 'gentle',
        language: 'en',
        costTier: 'balanced',
        mode: 'ambient_nudges',
        eagerness: 50,
        isBuiltIn: false,
      });
      setName('');
      setSlug('');
      setDescription('');
      setSystemPrompt('');
    });
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <CardTitle>New custom persona</CardTitle>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aurora"
          />
        </Field>
        <Field label="Slug">
          <input
            className={inputCls}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="aurora"
          />
        </Field>
      </div>
      <Field label="Description">
        <input
          className={inputCls}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="System prompt">
        <textarea
          className={`${inputCls} min-h-[6rem]`}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Voice provider">
          <select
            className={inputCls}
            value={voiceProvider}
            onChange={(e) => setVoiceProvider(e.target.value as (typeof VOICE_PROVIDERS)[number])}
          >
            {VOICE_PROVIDERS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Voice ID">
          <input
            className={inputCls}
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            disabled={voiceProvider === 'none'}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending ? 'Creating…' : 'Create persona'}
        </Button>
      </div>
    </Card>
  );
}

// ─── Tiny field helpers ───────────────────────────────────────────────────

const inputCls =
  'w-full rounded border border-[var(--color-border-subtle)] bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--color-fg-default)]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-muted-foreground flex flex-col gap-1 text-xs">
      <span>{label}</span>
      {children}
    </label>
  );
}
