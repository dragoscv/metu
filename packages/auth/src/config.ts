/**
 * Auth.js v5 configuration — Google OAuth + Drizzle adapter.
 * Used by both the `auth()` helper and `proxy.ts` route protection.
 */
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { getDb } from '@metu/db';
import { account, authenticator, session, user, verificationToken } from '@metu/db/schema';
import { ensurePersonalWorkspace } from '@metu/db/queries';

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
      // Ensure user has at least one workspace and attach context.
      const ws = await ensurePersonalWorkspace(
        user.id,
        user.name ? `${user.name}'s space` : 'Personal',
        `personal-${user.id.slice(0, 8)}`,
      );
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
