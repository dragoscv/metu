/**
 * Connect-method capabilities per integration kind.
 *
 * Source of truth for which providers expose 1-click OAuth flows
 * (web redirect or device flow) and which env vars must be set.
 */
import type { IntegrationKind } from '@metu/types';
import { WEB_OAUTH } from './web-oauth-config';

export type ConnectMethod = 'web-oauth' | 'device-flow' | 'token';

export interface DeviceFlowSpec {
  clientIdEnv: string;
  scope: string;
}

interface ProviderCapabilities {
  /** Methods the provider can use, in preferred order. */
  methods: ConnectMethod[];
  deviceFlow?: DeviceFlowSpec;
}

const CAPS: Partial<Record<IntegrationKind, ProviderCapabilities>> = {
  github: {
    methods: ['web-oauth', 'device-flow', 'token'],
    deviceFlow: {
      clientIdEnv: 'GITHUB_OAUTH_CLIENT_ID',
      scope: 'repo read:user read:org',
    },
  },
};

export interface ConnectAvailability {
  kind: IntegrationKind;
  /** Methods actually usable right now (env-gated). */
  available: ConnectMethod[];
}

/**
 * For a given kind, return the methods the user can actually use given
 * current env config. `'token'` is always available for token-paste kinds.
 */
export function availabilityFor(kind: IntegrationKind): ConnectAvailability {
  const declared = CAPS[kind]?.methods ?? ['token'];
  const available: ConnectMethod[] = [];

  // web-oauth: surface whenever a config exists. Effective credentials may
  // come from env OR from per-workspace DB-stored OAuth apps; the start
  // route resolves them lazily and surfaces a clear error if neither is set.
  const webCfg = WEB_OAUTH[kind];
  if (webCfg) available.push('web-oauth');

  // device-flow: env-gated by client_id only (no secret)
  if (declared.includes('device-flow')) {
    const spec = CAPS[kind]?.deviceFlow;
    if (spec && process.env[spec.clientIdEnv]) {
      available.push('device-flow');
    }
  }

  // token paste fallback
  available.push('token');
  return { kind, available };
}

/** Server-only: get the device-flow spec + resolved client_id. */
export function deviceFlowConfig(
  kind: IntegrationKind,
): { clientId: string; scope: string } | null {
  const spec = CAPS[kind]?.deviceFlow;
  if (!spec) return null;
  const clientId = process.env[spec.clientIdEnv];
  if (!clientId) return null;
  return { clientId, scope: spec.scope };
}
