/**
 * GitHub Copilot provider — connects via OAuth device-code flow and uses the
 * Copilot LLM proxy (OpenAI-compatible) as the inference backend.
 *
 * Two tokens are involved:
 *   1. GitHub OAuth access token (long-lived) — sealed in the DB as the
 *      provider_credential.apiKey for provider='copilot'.
 *   2. Copilot session token (~25 min) — derived on demand by exchanging (1)
 *      with the Copilot internal token endpoint. Cached in-memory.
 *
 * Headers required by the Copilot API are baked into every model call.
 * Reference: client_id below is the public well-known Copilot CLI/editor
 * client used by all editor integrations.
 */

const COPILOT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

const EDITOR_VERSION = 'vscode/1.95.0';
const EDITOR_PLUGIN_VERSION = 'metu/0.1.0';
const USER_AGENT = 'metu/0.1.0';

export interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export async function startDeviceFlow(
  opts: { clientId?: string; scope?: string } = {},
): Promise<DeviceCodeStart> {
  const clientId = opts.clientId ?? COPILOT_CLIENT_ID;
  const scope = opts.scope ?? 'read:user';
  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      client_id: clientId,
      scope,
    }),
  });
  if (!res.ok) {
    throw new Error(`device code request failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval,
  };
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'ok'; accessToken: string };

export async function pollDeviceFlow(
  deviceCode: string,
  opts: { clientId?: string } = {},
): Promise<DevicePollResult> {
  const clientId = opts.clientId ?? COPILOT_CLIENT_ID;
  const res = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    interval?: number;
  };
  if (data.access_token) return { status: 'ok', accessToken: data.access_token };
  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow_down', interval: data.interval ?? 10 };
    case 'expired_token':
      return { status: 'expired' };
    case 'access_denied':
      return { status: 'denied' };
    default:
      return { status: 'pending' };
  }
}

export interface CopilotSession {
  /** Bearer token for api.individual.githubcopilot.com */
  token: string;
  /** Unix seconds */
  expiresAt: number;
  /** Base URL for chat completions, e.g. https://api.individual.githubcopilot.com */
  endpoint: string;
}

interface CopilotTokenResponse {
  token: string;
  expires_at: number;
  refresh_in: number;
  endpoints: { api: string };
}

const sessionCache = new Map<string, CopilotSession>();

export async function getCopilotSession(ghToken: string): Promise<CopilotSession> {
  const cached = sessionCache.get(ghToken);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > now) return cached;

  const res = await fetch(COPILOT_TOKEN_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/json',
      'Editor-Version': EDITOR_VERSION,
      'Editor-Plugin-Version': EDITOR_PLUGIN_VERSION,
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    sessionCache.delete(ghToken);
    const body = await res.text();
    throw new Error(`copilot token exchange failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as CopilotTokenResponse;
  const session: CopilotSession = {
    token: data.token,
    expiresAt: data.expires_at,
    endpoint: data.endpoints?.api ?? 'https://api.individual.githubcopilot.com',
  };
  sessionCache.set(ghToken, session);
  return session;
}

export const COPILOT_HEADERS = {
  'Editor-Version': EDITOR_VERSION,
  'Editor-Plugin-Version': EDITOR_PLUGIN_VERSION,
  'Copilot-Integration-Id': 'vscode-chat',
  'User-Agent': USER_AGENT,
} as const;

/**
 * Build a fetch wrapper that injects a fresh Copilot session token + required
 * headers into every outbound request. Used by createOpenAI's `fetch` option
 * so streaming calls always carry a non-expired bearer.
 *
 * Also normalizes non-streaming chat-completion responses: Copilot omits the
 * `index` field on `choices[]`, which @ai-sdk/openai's Zod schema requires.
 * Without this patch every call fails with `AI_TypeValidationError` →
 * "Invalid JSON response".
 */
export function copilotFetch(ghToken: string): typeof fetch {
  return async (input, init) => {
    const session = await getCopilotSession(ghToken);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${session.token}`);
    for (const [k, v] of Object.entries(COPILOT_HEADERS)) headers.set(k, v);
    const res = await fetch(input, { ...init, headers });

    // Only normalize non-streaming JSON chat-completion responses.
    const ct = res.headers.get('content-type') ?? '';
    if (!res.ok || !ct.includes('application/json')) return res;
    const url = typeof input === 'string' ? input : ((input as Request).url ?? '');
    if (!url.includes('/chat/completions')) return res;

    const text = await res.text();
    try {
      const body = JSON.parse(text) as {
        choices?: Array<{ index?: number } & Record<string, unknown>>;
      };
      if (Array.isArray(body.choices)) {
        body.choices.forEach((c, i) => {
          if (typeof c.index !== 'number') c.index = i;
        });
      }
      const fixed = JSON.stringify(body);
      return new Response(fixed, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch {
      return new Response(text, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
  };
}

// ─── Models catalog (live from Copilot /models) ────────────────────────────

export interface CopilotModel {
  id: string;
  name: string;
  vendor: string;
  family: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Capabilities surfaced by Copilot — used to filter by intent. */
  supportsToolCalls: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
  /** Marked enabled/preview by the API. Disabled ones are hidden by default. */
  enabled: boolean;
  preview: boolean;
}

interface CopilotModelsRaw {
  data: Array<{
    id: string;
    name?: string;
    vendor?: string;
    model_picker_enabled?: boolean;
    preview?: boolean;
    capabilities?: {
      family?: string;
      type?: string; // 'chat' | 'embeddings' | ...
      limits?: { max_context_window_tokens?: number; max_output_tokens?: number };
      supports?: {
        tool_calls?: boolean;
        vision?: boolean;
        streaming?: boolean;
      };
    };
  }>;
}

interface ModelsCacheEntry {
  fetchedAt: number;
  models: CopilotModel[];
}

const MODELS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const modelsCache = new Map<string, ModelsCacheEntry>();

/**
 * Fetch the list of models exposed to this Copilot subscription. Cached for
 * 5 minutes per GitHub token; pass `force` to bypass the cache.
 */
export async function listCopilotModels(ghToken: string, force = false): Promise<CopilotModel[]> {
  const cached = modelsCache.get(ghToken);
  if (!force && cached && Date.now() - cached.fetchedAt < MODELS_TTL_MS) {
    return cached.models;
  }
  const session = await getCopilotSession(ghToken);
  const url = `${session.endpoint.replace(/\/$/, '')}/models`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/json',
      ...COPILOT_HEADERS,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`copilot /models failed: ${res.status} ${body}`);
  }
  const raw = (await res.json()) as CopilotModelsRaw;
  const models: CopilotModel[] = (raw.data ?? []).map((m) => {
    const caps = m.capabilities ?? {};
    const isEmbed = caps.type === 'embeddings';
    return {
      id: m.id,
      name: m.name ?? m.id,
      vendor: m.vendor ?? 'unknown',
      family: caps.family ?? m.id,
      contextWindow: caps.limits?.max_context_window_tokens,
      maxOutputTokens: caps.limits?.max_output_tokens,
      supportsToolCalls: !!caps.supports?.tool_calls,
      supportsVision: !!caps.supports?.vision,
      supportsStreaming: !!caps.supports?.streaming,
      supportsEmbeddings: isEmbed,
      enabled: m.model_picker_enabled !== false,
      preview: !!m.preview,
    };
  });
  modelsCache.set(ghToken, { fetchedAt: Date.now(), models });
  return models;
}

// ─── GitHub identity ───────────────────────────────────────────────────────

export interface CopilotUser {
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  htmlUrl?: string;
}

interface UserCacheEntry {
  fetchedAt: number;
  user: CopilotUser;
}

const USER_TTL_MS = 60 * 60 * 1000; // 1 hour
const userCache = new Map<string, UserCacheEntry>();

/**
 * Resolve the GitHub account that owns a Copilot OAuth token. Cached for an
 * hour per token; pass `force` to bypass.
 */
export async function getCopilotUser(ghToken: string, force = false): Promise<CopilotUser> {
  const cached = userCache.get(ghToken);
  if (!force && cached && Date.now() - cached.fetchedAt < USER_TTL_MS) {
    return cached.user;
  }
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`github /user failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    login: string;
    name?: string | null;
    email?: string | null;
    avatar_url?: string;
    html_url?: string;
  };
  const user: CopilotUser = {
    login: data.login,
    name: data.name ?? undefined,
    email: data.email ?? undefined,
    avatarUrl: data.avatar_url,
    htmlUrl: data.html_url,
  };
  userCache.set(ghToken, { fetchedAt: Date.now(), user });
  return user;
}
