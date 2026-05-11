import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, CardDescription, CardTitle, Page, PageHeader, Button } from '@metu/ui';
import { BUILT_IN_PERSONAS } from '@metu/presence';
import {
  getWorkspacePreferences,
  setPreferredLanguageAction,
} from '@/app/actions/workspace-preferences';
import { updateDisplayNameAction, deleteAccountAction } from '@/app/actions/profile';

export const metadata = { title: 'Profile · metu' };

const LANG_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ro', label: 'Română' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
];

const LANG_FLAG: Record<string, string> = {
  en: '🇬🇧',
  ro: '🇷🇴',
  fr: '🇫🇷',
  de: '🇩🇪',
  es: '🇪🇸',
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const u = session.user;
  const prefs = await getWorkspacePreferences();
  const current = prefs.preferredLanguage ?? 'en';

  return (
    <Page>
      <PageHeader
        eyebrow={<span className="text-sm text-[var(--color-fg-muted)]">Account</span>}
        title="Profile"
      />

      <Card>
        <div className="flex items-center gap-4">
          {u.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={u.image}
              alt=""
              className="h-16 w-16 rounded-full border border-[var(--color-border)]"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full bg-[var(--color-bg-card)] text-xl text-[var(--color-fg-muted)]">
              {(u.name ?? u.email ?? '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{u.name ?? 'Unnamed'}</p>
            <p className="truncate text-sm text-[var(--color-fg-muted)]">{u.email}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Workspace</CardTitle>
        <CardDescription className="mt-2">
          You belong to workspace{' '}
          <code className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-xs">
            {u.workspaceId}
          </code>
          . User id{' '}
          <code className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-xs">
            {u.id}
          </code>
          .
        </CardDescription>
      </Card>

      <Card>
        <CardTitle>Preferred language</CardTitle>
        <CardDescription className="mt-2">
          Used as the fallback when a persona doesn't pin its own language. Affects voice
          transcription (STT language hint) and speech.
        </CardDescription>
        <form action={setPreferredLanguageAction} className="mt-3 flex items-center gap-2">
          <select
            name="preferredLanguage"
            defaultValue={current}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm"
          >
            {LANG_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {LANG_FLAG[o.code] ?? '🌐'} {o.label} ({o.code})
              </option>
            ))}
          </select>
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Personas</CardTitle>
        <CardDescription className="mt-2">
          Built-in personas grouped by language. Edit or clone them in{' '}
          <code className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-xs">
            /settings/presence
          </code>
          .
        </CardDescription>
        <ul className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
          {BUILT_IN_PERSONAS.map((p) => (
            <li
              key={p.slug}
              className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5"
            >
              <span className="truncate">
                {LANG_FLAG[p.language] ?? '🌐'} {p.name}
              </span>
              <code className="text-xs text-[var(--color-fg-muted)]">{p.language}</code>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>Display name</CardTitle>
        <CardDescription className="mt-2">
          Shown across the app and on shared timelines. Leaves the underlying identity provider
          record unchanged.
        </CardDescription>
        <form
          action={async (fd: FormData) => {
            'use server';
            await updateDisplayNameAction({ name: String(fd.get('name') ?? '') });
          }}
          className="mt-3 flex items-center gap-2"
        >
          <input
            name="name"
            defaultValue={u.name ?? ''}
            maxLength={80}
            required
            placeholder="Your name"
            className="min-w-[16rem] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm"
          />
          <Button type="submit" size="sm">
            Save
          </Button>
        </form>
      </Card>

      <Card variant="outline">
        <CardTitle>Delete account</CardTitle>
        <CardDescription className="mt-2">
          Removes you from every workspace you belong to and deletes your user record. Workspaces
          where you are the sole owner must be transferred or deleted first. This cannot be undone.
        </CardDescription>
        <form
          action={async (fd: FormData) => {
            'use server';
            const result = await deleteAccountAction({ confirm: String(fd.get('confirm') ?? '') });
            if ('ok' in result && !result.ok) {
              // surface error via search param so the page can show it on next render
              const { redirect } = await import('next/navigation');
              redirect(`/settings/profile?error=${encodeURIComponent(result.error)}`);
            }
          }}
          className="mt-3 flex items-center gap-2"
        >
          <input
            name="confirm"
            placeholder="Type DELETE to confirm"
            required
            className="min-w-[16rem] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 font-mono text-sm"
          />
          <Button type="submit" size="sm" variant="danger">
            Delete forever
          </Button>
        </form>
      </Card>

      <Card variant="outline">
        <CardTitle>Roadmap</CardTitle>
        <CardDescription className="mt-2">
          Avatar upload, passkey (WebAuthn) registration, and OAuth-provider unlinking are queued
          for the next batch. Sign-in identity is currently mirrored from Google.
        </CardDescription>
      </Card>
    </Page>
  );
}
