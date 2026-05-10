import NextAuth from 'next-auth';
import { authConfig } from './config';

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export { authConfig, ACTIVE_WORKSPACE_COOKIE } from './config';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      workspaceId: string;
      workspaceSlug: string;
    };
  }
}
