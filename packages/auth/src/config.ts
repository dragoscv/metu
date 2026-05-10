/**
 * Auth.js v5 configuration — Google OAuth + Drizzle adapter.
 * Used by both the `auth()` helper and `proxy.ts` route protection.
 */
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { cookies } from 'next/headers';
import { getDb } from '@metu/db';
import { account, authenticator, session, user, verificationToken } from '@metu/db/schema';
import { ensurePersonalWorkspace, getUserWorkspaces } from '@metu/db/queries';

/** Cookie that pins the user's currently-active workspace. Read by the
 *  session callback below. Set/cleared by the `switchWorkspaceAction`. */
export const ACTIVE_WORKSPACE_COOKIE = 'metu.workspace';

// In-process cache to avoid re-querying the user's workspace on every request.
// Auth.js calls the `session` callback on every page render; without this we
// hammer the DB on every navigation and HMR ping during dev.
const workspaceCache = new Map<string, { id: string; slug: string; expiresAt: number }>();
const WORKSPACE_TTL_MS = 5 * 60_000;
const WORKSPACE_CACHE_MAX = 5_000;

function setWorkspaceCache(userId: string, value: { id: string; slug: string; expiresAt: number }) {
  if (workspaceCache.size >= WORKSPACE_CACHE_MAX) {
    // Drop oldest entry (Map preserves insertion order). Cheap LRU substitute.
    const oldest = workspaceCache.keys().next().value;
    if (oldest !== undefined) workspaceCache.delete(oldest);
  }
  workspaceCache.set(userId, value);
}

const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, in seconds
// `__Secure-` prefix requires HTTPS. AUTH_URL is the canonical app URL in v5.
const useSecureCookies = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? '').startsWith(
  'https://',
);
const cookiePrefix = useSecureCookies ? '__Secure-' : '';

// Skip the https check during `next build` — it sets NODE_ENV=production
// while collecting page data, but the real runtime environment (and its
// AUTH_URL) may be different. Phase constant comes from Next.js.
const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
if (process.env.NODE_ENV === 'production' && !useSecureCookies && !isBuildPhase) {
  throw new Error(
    '[auth] AUTH_URL (or NEXTAUTH_URL) must be an https:// URL in production so the session cookie is issued with the Secure flag and __Secure- prefix.',
  );
}

export const authConfig = {
  adapter: DrizzleAdapter(getDb(), {
    usersTable: user,
    accountsTable: account,
    sessionsTable: session,
    verificationTokensTable: verificationToken,
    authenticatorsTable: authenticator,
  }),
  session: {
    strategy: 'database',
    // 30-day rolling session. `updateAge` rewrites the DB row + cookie at most
    // once per day on activity, so a daily user effectively never gets logged
    // out. Auth.js derives the cookie's persistent expiry from `maxAge`.
    maxAge: SESSION_MAX_AGE,
    updateAge: 24 * 60 * 60,
  },
  // Explicit cookie config — Auth.js v5 beta omits `maxAge` from the default
  // sessionToken cookie, which makes some browsers treat it as a session
  // cookie and drop it across tab/window restarts. Setting maxAge here pins
  // the cookie's persistent expiry to the session expiry.
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
        maxAge: SESSION_MAX_AGE,
      },
    },
  },
  // `trustHost` is required when running behind a proxy (Vercel, Cloud Run,
  // localhost dev). In production, gate it on AUTH_URL being explicitly set
  // so a misconfigured deploy without AUTH_URL can't be tricked by a forged
  // X-Forwarded-Host into issuing OAuth callbacks to attacker-controlled
  // origins.
  trustHost:
    process.env.NODE_ENV !== 'production' ||
    Boolean(process.env.AUTH_URL || process.env.NEXTAUTH_URL),
  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: 'select_account',
          access_type: 'offline',
          // Pre-emptively request scopes used by Gmail/Calendar integrations.
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/calendar.readonly',
          ].join(' '),
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (!user?.id) return session;

      // Always include the user id, even if the workspace lookup fails. This
      // callback runs on every page render; if it throws, Auth.js treats the
      // session as invalid and the user gets bounced to /sign-in. A transient
      // DB blip should never cost the user their session.
      const baseSession = {
        ...session,
        user: { ...session.user, id: user.id },
      };

      try {
        const now = Date.now();
        const cached = workspaceCache.get(user.id);
        let ws = cached && cached.expiresAt > now ? cached : null;

        // If the user pinned a workspace via the switcher, prefer it
        // (provided they're still a member). The cookie lookup runs on
        // every request, so we can't cache the resolved workspace by
        // user-id alone.
        let pinnedId: string | null = null;
        try {
          const c = await cookies();
          pinnedId = c.get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null;
        } catch {
          // cookies() throws outside a request scope (e.g. some Auth.js
          // initialization paths). Fine — fall through to default.
          pinnedId = null;
        }

        if (pinnedId) {
          const rows = await getUserWorkspaces(user.id);
          const match = rows.find((r) => r.workspace.id === pinnedId);
          if (match) {
            ws = {
              id: match.workspace.id,
              slug: match.workspace.slug,
              expiresAt: now + WORKSPACE_TTL_MS,
            };
            // Don't poison the per-user cache with a pinned value —
            // another tab in another workspace would see the wrong one.
          } else if (!ws) {
            const found = rows[0]?.workspace;
            if (found) {
              ws = { id: found.id, slug: found.slug, expiresAt: now + WORKSPACE_TTL_MS };
              setWorkspaceCache(user.id, ws);
            }
          }
        } else if (!ws) {
          // Workspace is created in the `signIn` event, so a SELECT is enough.
          const rows = await getUserWorkspaces(user.id);
          const found = rows[0]?.workspace;
          if (found) {
            ws = { id: found.id, slug: found.slug, expiresAt: now + WORKSPACE_TTL_MS };
            setWorkspaceCache(user.id, ws);
          }
        }

        if (!ws) return baseSession;
        return {
          ...baseSession,
          user: { ...baseSession.user, workspaceId: ws.id, workspaceSlug: ws.slug },
        };
      } catch (err) {
        console.error('[auth] session callback workspace lookup failed', err);
        return baseSession;
      }
    },
  },
  events: {
    async signIn({ user: signedIn }) {
      if (!signedIn?.id) return;
      try {
        await ensurePersonalWorkspace(
          signedIn.id,
          signedIn.name ? `${signedIn.name}'s space` : 'Personal',
          `personal-${signedIn.id.slice(0, 8)}`,
        );
      } catch (err) {
        // Don't let workspace creation fail sign-in. The session callback
        // will retry the lookup on next render and the workspace can be
        // created lazily by the next request.
        console.error('[auth] ensurePersonalWorkspace failed', err);
      }
    },
  },
} satisfies NextAuthConfig;
