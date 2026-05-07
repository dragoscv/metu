/**
 * Auth.js v5 configuration — Google OAuth + Drizzle adapter.
 * Used by both the `auth()` helper and `proxy.ts` route protection.
 */
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { getDb } from '@metu/db';
import { account, authenticator, session, user, verificationToken } from '@metu/db/schema';
import { ensurePersonalWorkspace, getUserWorkspaces } from '@metu/db/queries';

// In-process cache to avoid re-querying the user's workspace on every request.
// Auth.js calls the `session` callback on every page render; without this we
// hammer the DB on every navigation and HMR ping during dev.
const workspaceCache = new Map<string, { id: string; slug: string; expiresAt: number }>();
const WORKSPACE_TTL_MS = 5 * 60_000;

export const authConfig = {
  adapter: DrizzleAdapter(getDb(), {
    usersTable: user,
    accountsTable: account,
    sessionsTable: session,
    verificationTokensTable: verificationToken,
    authenticatorsTable: authenticator,
  }),
  session: { strategy: 'database' },
  trustHost: true,
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

      const now = Date.now();
      const cached = workspaceCache.get(user.id);
      let ws = cached && cached.expiresAt > now ? cached : null;

      if (!ws) {
        // Workspace is created in the `signIn` event, so a SELECT is enough here.
        const rows = await getUserWorkspaces(user.id);
        const found = rows[0]?.workspace;
        if (found) {
          ws = { id: found.id, slug: found.slug, expiresAt: now + WORKSPACE_TTL_MS };
          workspaceCache.set(user.id, ws);
        }
      }

      if (!ws) return session;
      return {
        ...session,
        user: {
          ...session.user,
          id: user.id,
          workspaceId: ws.id,
          workspaceSlug: ws.slug,
        },
      };
    },
  },
  events: {
    async signIn({ user: signedIn }) {
      if (signedIn?.id) {
        await ensurePersonalWorkspace(
          signedIn.id,
          signedIn.name ? `${signedIn.name}'s space` : 'Personal',
          `personal-${signedIn.id.slice(0, 8)}`,
        );
      }
    },
  },
} satisfies NextAuthConfig;
