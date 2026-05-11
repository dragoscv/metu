# SDK quickstart — recipe: notai

This walks through the simplest possible third-party app that signs in
with metu and uses it as a memory + notification fabric. The full
runnable code lives in [`apps/notai/`](../apps/notai/).

## 1. Register the app in metu

In the metu web app go to `/apps` → "Register app" → fill:

| Field         | Value                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| Name          | notai                                                                      |
| Redirect URIs | `http://localhost:24896/api/auth/callback/metu`                            |
| Scopes        | `openid profile email capture:write recall:read notify:write events:write` |
| Type          | first-party                                                                |

You'll get back a `client_id` and `client_secret`. Stash them.

## 2. Create the consumer app

```sh
mkdir -p apps/your-app/src
cd apps/your-app
pnpm init
pnpm add @metu/sdk next next-auth react react-dom zod
pnpm add -D typescript @types/react @types/node
```

Your app needs three files at minimum: an Auth.js config, the
`[...nextauth]` route, and a page that uses the token.

### `src/auth.ts`

```ts
import NextAuth from 'next-auth';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    {
      id: 'metu',
      name: 'metu',
      type: 'oidc',
      issuer: process.env.METU_ISSUER ?? 'http://localhost:24890',
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
    async jwt({ token, account }) {
      if (account?.access_token) token.metuAccessToken = account.access_token;
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
```

### `src/app/api/auth/[...nextauth]/route.ts`

```ts
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
```

### `src/app/page.tsx`

```tsx
import { auth, signIn } from '@/auth';
import { createClient } from '@metu/sdk';

export default async function Home() {
  const session = await auth();
  const token = (session as { metuAccessToken?: string } | null)?.metuAccessToken;

  if (!session || !token) {
    return (
      <form
        action={async () => {
          'use server';
          await signIn('metu');
        }}
      >
        <button type="submit">Sign in with metu</button>
      </form>
    );
  }

  const metu = createClient({
    baseUrl: process.env.METU_ISSUER!,
    auth: { kind: 'token', accessToken: token },
  });

  // capture, recall, notify — that's the whole surface.
  return <main>Signed in.</main>;
}
```

## 3. Methods you'll actually use

```ts
// Write into metu memory (the conductor sees the new capture immediately).
await metu.capture({
  kind: 'text',
  content: 'pricing decision: $19/mo solo plan',
  source: 'your-app',
  metadata: { thread: 'q3-pricing' },
});

// Search across the workspace's memory + recent captures.
const hits = await metu.recall({
  query: 'pricing decision',
  k: 10,
  mode: 'hybrid',
});

// Notify the user on whichever device they're most present on.
await metu.notify({
  title: 'Build green',
  body: 'mmo deploy passed',
  urgency: 'normal',
  source: 'your-app',
});
```

## 4. Live channel (optional)

```ts
const ws = await metu.connect({
  kind: 'external_app',
  platform: 'node',
  name: 'your-app-server',
  fingerprint: 'your-app-server-1',
});
ws.on('event.notification', (n) => console.log(n.title));
```

## Reference implementation

The minimal scaffold lives at [`apps/notai/`](../apps/notai/):

| File                                      | Purpose                         |
| ----------------------------------------- | ------------------------------- |
| `src/auth.ts`                             | Auth.js v5 with metu OIDC       |
| `src/app/api/auth/[...nextauth]/route.ts` | Next-Auth route handler         |
| `src/lib/metu.ts`                         | SDK client factory              |
| `src/app/page.tsx`                        | Server component with auth gate |
| `src/app/_island.tsx`                     | Client island doing the calls   |

That's it. The full notes-CRUD + sidebar follows in slice 7.
