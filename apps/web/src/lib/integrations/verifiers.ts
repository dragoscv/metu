/**
 * Per-provider token verifiers. Each takes a token, calls a `/me`-style
 * endpoint, and either returns identity (externalId, label) or an error.
 *
 * Verifiers are server-only — they execute outbound HTTP with the user's
 * token and must never be invoked from the client.
 */
import 'server-only';
import type { IntegrationKind } from '@metu/types';

const UA = 'metu/0.1.0';

export interface VerifyOk {
  ok: true;
  externalId: string;
  label: string;
  metadata?: Record<string, unknown>;
}
export interface VerifyErr {
  ok: false;
  error: string;
}
export type VerifyResult = VerifyOk | VerifyErr;

async function withTimeout<T>(p: Promise<T>, ms = 10_000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ─── GitHub (PAT, classic or fine-grained) ─────────────────────────────────

async function verifyGithub(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': UA,
        },
      }),
    );
    if (!res.ok) return { ok: false, error: `GitHub ${res.status}: invalid token` };
    const data = (await readJson(res)) as {
      login?: string;
      name?: string;
      html_url?: string;
      avatar_url?: string;
    } | null;
    if (!data?.login) return { ok: false, error: 'GitHub: no login in response' };
    return {
      ok: true,
      externalId: data.login,
      label: data.name ? `${data.name} (@${data.login})` : `@${data.login}`,
      metadata: { htmlUrl: data.html_url, avatarUrl: data.avatar_url },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'GitHub verify failed',
    };
  }
}

// ─── Telegram (bot token) ──────────────────────────────────────────────────

async function verifyTelegram(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(fetch(`https://api.telegram.org/bot${token}/getMe`));
    if (!res.ok) return { ok: false, error: `Telegram ${res.status}` };
    const data = (await readJson(res)) as {
      ok?: boolean;
      result?: { id?: number; username?: string; first_name?: string };
    } | null;
    if (!data?.ok || !data.result?.id) {
      return { ok: false, error: 'Telegram: invalid bot token' };
    }
    const r = data.result;
    return {
      ok: true,
      externalId: String(r.id),
      label: r.username ? `@${r.username}` : (r.first_name ?? `bot ${r.id}`),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Telegram verify failed',
    };
  }
}

// ─── Vercel (token) ────────────────────────────────────────────────────────

async function verifyVercel(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://api.vercel.com/v2/user', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      }),
    );
    if (!res.ok) return { ok: false, error: `Vercel ${res.status}: invalid token` };
    const data = (await readJson(res)) as {
      user?: { uid?: string; username?: string; email?: string; name?: string };
    } | null;
    const u = data?.user;
    if (!u?.uid) return { ok: false, error: 'Vercel: no user in response' };
    return {
      ok: true,
      externalId: u.uid,
      label: u.username ? `@${u.username}` : (u.name ?? u.email ?? `user ${u.uid}`),
      metadata: { email: u.email },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Vercel verify failed',
    };
  }
}

// ─── Stripe (secret key) ───────────────────────────────────────────────────

async function verifyStripe(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://api.stripe.com/v1/account', {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': UA,
        },
      }),
    );
    if (!res.ok) return { ok: false, error: `Stripe ${res.status}: invalid key` };
    const data = (await readJson(res)) as {
      id?: string;
      business_profile?: { name?: string };
      email?: string;
      country?: string;
      settings?: { dashboard?: { display_name?: string } };
    } | null;
    if (!data?.id) return { ok: false, error: 'Stripe: no account id' };
    const name =
      data.settings?.dashboard?.display_name ??
      data.business_profile?.name ??
      data.email ??
      data.id;
    const mode = token.startsWith('sk_live_') ? 'live' : 'test';
    return {
      ok: true,
      externalId: data.id,
      label: `${name} (${mode})`,
      metadata: { mode, country: data.country },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Stripe verify failed',
    };
  }
}

// ─── Linear (API key) ──────────────────────────────────────────────────────

async function verifyLinear(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: token, // Linear uses raw key, no Bearer prefix
          'Content-Type': 'application/json',
          'User-Agent': UA,
        },
        body: JSON.stringify({
          query: '{ viewer { id name email } }',
        }),
      }),
    );
    if (!res.ok) return { ok: false, error: `Linear ${res.status}: invalid key` };
    const data = (await readJson(res)) as {
      data?: { viewer?: { id?: string; name?: string; email?: string } };
    } | null;
    const v = data?.data?.viewer;
    if (!v?.id) return { ok: false, error: 'Linear: no viewer' };
    return {
      ok: true,
      externalId: v.id,
      label: v.name ?? v.email ?? `user ${v.id}`,
      metadata: { email: v.email },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Linear verify failed',
    };
  }
}

// ─── Notion (integration token) ────────────────────────────────────────────

async function verifyNotion(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'User-Agent': UA,
        },
      }),
    );
    if (!res.ok) return { ok: false, error: `Notion ${res.status}: invalid token` };
    const data = (await readJson(res)) as {
      id?: string;
      name?: string;
      bot?: { workspace_name?: string; owner?: { user?: { name?: string } } };
    } | null;
    if (!data?.id) return { ok: false, error: 'Notion: no user id' };
    const ws = data.bot?.workspace_name;
    return {
      ok: true,
      externalId: data.id,
      label: ws ? `${data.name ?? 'Bot'} · ${ws}` : (data.name ?? `user ${data.id}`),
      metadata: { workspaceName: ws },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Notion verify failed',
    };
  }
}

// ─── Dispatcher ────────────────────────────────────────────────────────────

const VERIFIERS: Partial<Record<IntegrationKind, (token: string) => Promise<VerifyResult>>> = {
  github: verifyGithub,
  telegram: verifyTelegram,
  vercel: verifyVercel,
  stripe: verifyStripe,
  linear: verifyLinear,
  notion: verifyNotion,
};

export function isTokenIntegration(kind: IntegrationKind): boolean {
  return kind in VERIFIERS;
}

export async function verifyIntegrationToken(
  kind: IntegrationKind,
  token: string,
): Promise<VerifyResult> {
  const fn = VERIFIERS[kind];
  if (!fn) return { ok: false, error: `${kind} requires OAuth — not yet implemented` };
  return fn(token);
}
