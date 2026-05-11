/**
 * notai home — proves the SDK loop end-to-end:
 *  1. sign in with metu (OIDC)
 *  2. capture a note (writes to metu.capture, mirrors locally only as a banner)
 *  3. recall against metu memory
 *  4. notify (fires a metu notification routed to the most-present device)
 *
 * Server component for auth check + initial recall results; one
 * client island for the form interactions.
 */
import { auth, signIn, signOut } from '@/auth';
import { NotesApp } from './_notes';

export default async function HomePage() {
  const session = await auth();
  const accessToken = (session as { metuAccessToken?: string } | null)?.metuAccessToken;

  if (!session || !accessToken) {
    return (
      <main style={{ padding: '4rem 2rem', maxWidth: 480, margin: '0 auto' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>notai</h1>
        <p style={{ color: '#9b9ba1' }}>
          A note-taking app where every note flows through your metu second brain.
        </p>
        <form
          action={async () => {
            'use server';
            await signIn('metu', { redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            style={{
              marginTop: '2rem',
              padding: '0.75rem 1.25rem',
              borderRadius: 8,
              background: '#7c3aed',
              color: 'white',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign in with metu →
          </button>
        </form>
      </main>
    );
  }

  return (
    <main style={{ padding: '2rem', maxWidth: 1080, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ fontSize: '2rem', margin: 0 }}>notai</h1>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/' });
          }}
        >
          <button
            type="submit"
            style={{
              background: 'transparent',
              color: '#9b9ba1',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Sign out
          </button>
        </form>
      </header>
      <p style={{ color: '#9b9ba1', marginTop: 4, marginBottom: 24 }}>
        Signed in as {session.user?.email ?? session.user?.name ?? 'unknown'} · Notes auto-mirror
        into your metu second brain.
      </p>
      <NotesApp token={accessToken} />
    </main>
  );
}
