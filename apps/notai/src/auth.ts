/**
 * notai auth — Auth.js v5 with metu as the only OIDC provider.
 *
 * The whole point of notai is to demonstrate that a third-party app
 * signs in *with metu* (no local accounts), gets back an access token
 * scoped to a metu workspace, and uses that token to call the
 * `@metu/sdk`. We persist the access_token + refresh_token on the
 * session via JWT callbacks; never store user data here beyond what
 * Auth.js needs for the cookie.
 */
import NextAuth from 'next-auth';

const issuer = process.env.METU_ISSUER ?? 'http://localhost:24890';

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    {
      id: 'metu',
      name: 'metu',
      type: 'oidc',
      issuer,
      clientId: process.env.METU_CLIENT_ID,
      clientSecret: process.env.METU_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'openid profile email capture:write recall:read notify:write events:write',
        },
      },
    },
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    // Stash the access_token on the JWT so the page can use it server-side
    // to construct an SDK client. Never expose refresh_token to the client.
    async jwt({ token, account }) {
      if (account?.access_token) {
        token.metuAccessToken = account.access_token;
        token.metuExpiresAt = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      (session as { metuAccessToken?: string }).metuAccessToken = token.metuAccessToken as
        | string
        | undefined;
      return session;
    },
  },
});
