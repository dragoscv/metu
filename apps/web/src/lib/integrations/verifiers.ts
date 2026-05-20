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

// ─── Slack (OAuth bot/user token) ──────────────────────────────────────────

async function verifySlack(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      }),
    );
    if (!res.ok) return { ok: false, error: `Slack ${res.status}` };
    const data = (await readJson(res)) as {
      ok?: boolean;
      user_id?: string;
      user?: string;
      team?: string;
      team_id?: string;
      url?: string;
      error?: string;
    } | null;
    if (!data?.ok || !data.user_id) {
      return { ok: false, error: `Slack: ${data?.error ?? 'invalid token'}` };
    }
    return {
      ok: true,
      externalId: `${data.team_id ?? 'team'}:${data.user_id}`,
      label: data.team
        ? `${data.user ?? data.user_id} · ${data.team}`
        : (data.user ?? data.user_id),
      metadata: { teamId: data.team_id, teamUrl: data.url },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Slack verify failed' };
  }
}

// ─── Google Calendar (OAuth access token) ─────────────────────────────────

async function verifyGcal(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      }),
    );
    if (!res.ok) return { ok: false, error: `Google Calendar ${res.status}` };
    // Identity comes from the userinfo endpoint (we only have calendar scope here).
    const idRes = await withTimeout(
      fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      }),
    );
    const id = (await readJson(idRes)) as {
      sub?: string;
      email?: string;
      name?: string;
    } | null;
    if (!id?.sub) {
      return {
        ok: true,
        externalId: 'gcal:primary',
        label: 'Calendar (primary)',
      };
    }
    return {
      ok: true,
      externalId: id.sub,
      label: id.email ? `${id.name ?? id.email} (Calendar)` : `Calendar ${id.sub.slice(0, 8)}`,
      metadata: { email: id.email },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Calendar verify failed' };
  }
}

// ─── Reddit (OAuth bearer) ─────────────────────────────────────────────────

async function verifyReddit(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://oauth.reddit.com/api/v1/me', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      }),
    );
    if (!res.ok) return { ok: false, error: `Reddit ${res.status}` };
    const data = (await readJson(res)) as {
      id?: string;
      name?: string;
      total_karma?: number;
    } | null;
    if (!data?.id || !data.name) return { ok: false, error: 'Reddit: no identity' };
    return {
      ok: true,
      externalId: data.id,
      label: `u/${data.name}`,
      metadata: { karma: data.total_karma },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Reddit verify failed' };
  }
}

// ─── Twitter / X (OAuth2 bearer) ───────────────────────────────────────────

async function verifyTwitter(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://api.twitter.com/2/users/me', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      }),
    );
    if (!res.ok) return { ok: false, error: `Twitter ${res.status}` };
    const data = (await readJson(res)) as {
      data?: { id?: string; username?: string; name?: string };
    } | null;
    const u = data?.data;
    if (!u?.id || !u.username) return { ok: false, error: 'Twitter: no user' };
    return {
      ok: true,
      externalId: u.id,
      label: u.name ? `${u.name} (@${u.username})` : `@${u.username}`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Twitter verify failed' };
  }
}

// ─── YouTube (OAuth, Google) ───────────────────────────────────────────────

async function verifyYoutube(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet,statistics&mine=true', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      }),
    );
    if (!res.ok) return { ok: false, error: `YouTube ${res.status}` };
    const data = (await readJson(res)) as {
      items?: Array<{
        id?: string;
        snippet?: { title?: string; customUrl?: string };
        statistics?: { subscriberCount?: string; videoCount?: string };
      }>;
    } | null;
    const ch = data?.items?.[0];
    if (!ch?.id) return { ok: false, error: 'YouTube: no channel' };
    return {
      ok: true,
      externalId: ch.id,
      label: ch.snippet?.title ?? `channel ${ch.id}`,
      metadata: {
        customUrl: ch.snippet?.customUrl,
        subscribers: ch.statistics?.subscriberCount,
        videoCount: ch.statistics?.videoCount,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'YouTube verify failed' };
  }
}

// ─── Spotify (OAuth) ───────────────────────────────────────────────────────

async function verifySpotify(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': UA },
      }),
    );
    if (!res.ok) return { ok: false, error: `Spotify ${res.status}` };
    const data = (await readJson(res)) as {
      id?: string;
      display_name?: string;
      email?: string;
      country?: string;
      product?: string;
    } | null;
    if (!data?.id) return { ok: false, error: 'Spotify: no user' };
    return {
      ok: true,
      externalId: data.id,
      label: data.display_name ?? data.email ?? data.id,
      metadata: { country: data.country, product: data.product },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Spotify verify failed' };
  }
}

// ─── Instagram (Basic Display API) ─────────────────────────────────────────

async function verifyInstagram(token: string): Promise<VerifyResult> {
  try {
    const res = await withTimeout(
      fetch(
        `https://graph.instagram.com/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`,
        {
          headers: { 'User-Agent': UA },
        },
      ),
    );
    if (!res.ok) return { ok: false, error: `Instagram ${res.status}` };
    const data = (await readJson(res)) as {
      id?: string;
      username?: string;
      account_type?: string;
    } | null;
    if (!data?.id || !data.username) return { ok: false, error: 'Instagram: no user' };
    return {
      ok: true,
      externalId: data.id,
      label: `@${data.username}`,
      metadata: { accountType: data.account_type },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Instagram verify failed' };
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
  slack: verifySlack,
  gcal: verifyGcal,
  reddit: verifyReddit,
  twitter: verifyTwitter,
  youtube: verifyYoutube,
  spotify: verifySpotify,
  instagram: verifyInstagram,
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
