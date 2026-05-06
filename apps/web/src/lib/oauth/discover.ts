/**
 * OIDC / OAuth 2 discovery + capability probing.
 *
 * Two helpers:
 *  - `discoverOidc(url)` — fetches `/.well-known/openid-configuration` and
 *    extracts the standard endpoints + scopes_supported + grant_types.
 *  - `probeCapabilities(accessToken, app)` — best-effort: hits userinfo +
 *    parses granted scopes to surface "what this connection can do".
 */

const TIMEOUT_MS = 8000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export interface DiscoveredEndpoints {
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  revocationEndpoint?: string;
  introspectionEndpoint?: string;
  jwksUri?: string;
  scopesSupported?: string[];
  responseTypesSupported?: string[];
  grantTypesSupported?: string[];
  codeChallengeMethodsSupported?: string[];
  raw?: Record<string, unknown>;
}

/**
 * Accepts either:
 *  - the full discovery URL, or
 *  - an issuer base URL — we'll try `/.well-known/openid-configuration` and
 *    `/.well-known/oauth-authorization-server`.
 */
export async function discoverOidc(input: string): Promise<DiscoveredEndpoints> {
  const candidates = buildDiscoveryCandidates(input);
  let lastError: unknown;
  for (const url of candidates) {
    try {
      const json = await fetchJson<Record<string, unknown>>(url);
      return {
        issuer: str(json.issuer),
        authorizationEndpoint: str(json.authorization_endpoint),
        tokenEndpoint: str(json.token_endpoint),
        userinfoEndpoint: str(json.userinfo_endpoint),
        revocationEndpoint: str(json.revocation_endpoint),
        introspectionEndpoint: str(json.introspection_endpoint),
        jwksUri: str(json.jwks_uri),
        scopesSupported: strArr(json.scopes_supported),
        responseTypesSupported: strArr(json.response_types_supported),
        grantTypesSupported: strArr(json.grant_types_supported),
        codeChallengeMethodsSupported: strArr(json.code_challenge_methods_supported),
        raw: json,
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Discovery failed for ${input}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function buildDiscoveryCandidates(input: string): string[] {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (trimmed.includes('/.well-known/')) return [trimmed];
  return [
    `${trimmed}/.well-known/openid-configuration`,
    `${trimmed}/.well-known/oauth-authorization-server`,
  ];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function strArr(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

export interface ProbeResult {
  externalId: string;
  label: string;
  identity: Record<string, unknown>;
}

/**
 * Hit the userinfo endpoint with the access token and pick a stable identity.
 * Falls back to a best-effort label if userinfo is unavailable.
 */
export async function probeUserinfo(
  accessToken: string,
  userinfoUrl: string | null | undefined,
): Promise<ProbeResult> {
  if (!userinfoUrl) {
    const id = `${Date.now()}`;
    return { externalId: id, label: `Account ${id.slice(-6)}`, identity: {} };
  }
  const json = await fetchJson<Record<string, unknown>>(userinfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const externalId =
    str(json.sub) ??
    str(json.id) ??
    str(json.user_id) ??
    str(json.email) ??
    str(json.login) ??
    `${Date.now()}`;
  const label =
    str(json.name) ??
    str(json.email) ??
    str(json.login) ??
    str(json.preferred_username) ??
    `Account ${externalId.slice(-6)}`;
  return { externalId, label, identity: json };
}
