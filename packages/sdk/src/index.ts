/**
 * @metu/sdk — the client every app and device uses to talk to METU.
 *
 * Usage (Node / browser / Tauri / Expo):
 *
 *   import { createClient } from '@metu/sdk';
 *   const metu = createClient({
 *     baseUrl: 'https://app.metu.ro',
 *     hubUrl: 'wss://hub.metu.ro',
 *     // OAuth — bring an access_token, or use the device flow:
 *     auth: { kind: 'token', accessToken: '...' },
 *   });
 *
 *   await metu.capture({ kind: 'text', content: 'idea: ship the conductor' });
 *   await metu.notify({ title: 'Build green', urgency: 'normal' });
 *   const hits = await metu.recall({ query: 'pricing decision' });
 *
 *   // Live channel:
 *   const ws = await metu.connect({
 *     kind: 'external_app',
 *     platform: 'node',
 *     name: 'notai-server',
 *     fingerprint: 'notai-server-1',
 *   });
 *   ws.on('event.notification', (n) => console.log(n.title));
 *
 * V0 covers the REST surface + a thin WS wrapper; auth flows arrive in slice 2.
 */
import {
  CaptureCreateSchema,
  ClientEventSchema,
  HelloSchema,
  IntentCreateSchema,
  NotifyCreateSchema,
  PROTOCOL_VERSION,
  RecallQuerySchema,
  ServerEventSchema,
  type CaptureCreate,
  type ClientEvent,
  type Hello,
  type IntentCreate,
  type NotifyCreate,
  type RecallQuery,
  type ServerEvent,
} from '@metu/protocol';

export type AuthMode =
  | { kind: 'token'; accessToken: string }
  | { kind: 'oauth_device_flow'; clientId: string }
  | { kind: 'api_key'; apiKey: string };

export interface ClientOptions {
  baseUrl: string;
  hubUrl?: string;
  auth: AuthMode;
  fetch?: typeof fetch;
  /** Default request timeout in ms. */
  timeoutMs?: number;
}

export class MetuApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = 'MetuApiError';
  }
}

function authHeader(auth: AuthMode): Record<string, string> {
  switch (auth.kind) {
    case 'token':
      return { authorization: `Bearer ${auth.accessToken}` };
    case 'api_key':
      return { 'x-metu-api-key': auth.apiKey };
    case 'oauth_device_flow':
      return {}; // resolved at runtime once flow completes
  }
}

export interface MetuClient {
  capture(input: CaptureCreate): Promise<{ id: string }>;
  recall(input: RecallQuery): Promise<Array<{ id: string; content: string; score: number }>>;
  notify(input: NotifyCreate): Promise<{ id: string }>;
  intent(input: IntentCreate): Promise<{ id: string }>;
  borrow(input: BorrowInput): Promise<BorrowResult>;
  event(kind: string, payload: Record<string, unknown>): Promise<void>;
  /** Pull a snapshot of audit aggregates (requires `audit:read` scope). */
  auditSummary(input?: AuditSummaryInput): Promise<AuditSummary>;
  /** Fetch a page of timeline events (requires `event:read` scope). */
  timeline(input?: TimelineInput): Promise<TimelinePage>;
  connect(hello: Omit<Hello, 'v' | 'type' | 'accessToken'>): Promise<MetuSocket>;
}

export interface AuditSummaryInput {
  /** Window expressed as `Nd`, default `7d`. Server caps to 1–365. */
  since?: string;
  /** How many entries to return for `topByCost` (1–50, default 5). */
  top?: number;
}

export interface AuditSummary {
  ok: true;
  window: { sinceDays: number; sinceIso: string };
  summary: { calls: number; failed: number; awaiting: number; costUsd: number };
  dailyCost: Array<{ day: string; cost: number; calls: number }>;
  topByCost: Array<{ tool: string; total: number; calls: number }>;
  byAclMode: Array<{
    tool: string;
    aclMode: string | null;
    calls: number;
    successCalls: number;
    failedCalls: number;
    rejectedCalls: number;
    totalCost: number;
    avgCost: number;
    maxCost: number;
  }>;
}

export interface TimelineInput {
  /** Filter by one or more event kinds. */
  kinds?: string[];
  /** Project id to scope to. */
  projectId?: string;
  /** Window expressed as `Nd`, default `7d`. Server caps to 1–365. */
  since?: string;
  /** Case-insensitive substring on title + body. */
  q?: string;
  /** Page size, 1–100 (default 40). */
  limit?: number;
  /** Opaque cursor returned from the previous page. */
  cursor?: string;
}

export interface TimelineEvent {
  id: string;
  kind: string;
  title: string | null;
  body: string | null;
  payload: unknown;
  importance: number;
  projectId: string | null;
  userId: string | null;
  occurredAt: string;
}

export interface TimelinePage {
  ok: true;
  window: { sinceDays: number; sinceIso: string };
  items: TimelineEvent[];
  nextCursor: string | null;
}

export interface BorrowInput {
  integrationId: string;
  purpose: string;
  ttlSec?: number;
}

export interface BorrowResult {
  ok: true;
  integrationId: string;
  kind: string;
  accessToken: string;
  expiresAt: string;
}

export interface MetuSocket {
  send(event: ClientEvent): void;
  on<T extends ServerEvent['type']>(
    type: T,
    handler: (event: Extract<ServerEvent, { type: T }>) => void,
  ): () => void;
  close(): void;
}

export function createClient(opts: ClientOptions): MetuClient {
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await f(`${opts.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-metu-protocol': String(PROTOCOL_VERSION),
          ...authHeader(opts.auth),
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (!res.ok) {
        throw new MetuApiError(
          res.status,
          (json && (json as { code?: string }).code) ?? 'http_error',
          (json && (json as { error?: string }).error) ?? `HTTP ${res.status}`,
          json,
        );
      }
      return json as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async capture(input) {
      const parsed = CaptureCreateSchema.parse(input);
      return request<{ id: string }>('POST', '/api/sdk/v1/capture', parsed);
    },
    async recall(input) {
      const parsed = RecallQuerySchema.parse(input);
      return request<Array<{ id: string; content: string; score: number }>>(
        'POST',
        '/api/sdk/v1/recall',
        parsed,
      );
    },
    async notify(input) {
      const parsed = NotifyCreateSchema.parse(input);
      return request<{ id: string }>('POST', '/api/sdk/v1/notify', parsed);
    },
    async intent(input) {
      const parsed = IntentCreateSchema.parse(input);
      return request<{ id: string }>('POST', '/api/sdk/v1/intent', parsed);
    },
    async borrow(input) {
      return request<BorrowResult>('POST', '/api/sdk/v1/credentials/borrow', input);
    },
    async event(kind, payload) {
      await request<void>('POST', '/api/sdk/v1/events', { kind, payload });
    },
    async auditSummary(input) {
      const qs = new URLSearchParams();
      if (input?.since) qs.set('since', input.since);
      if (typeof input?.top === 'number') qs.set('top', String(input.top));
      const path = qs.toString()
        ? `/api/sdk/v1/audit/summary?${qs.toString()}`
        : '/api/sdk/v1/audit/summary';
      return request<AuditSummary>('GET', path);
    },
    async timeline(input) {
      const qs = new URLSearchParams();
      if (input?.kinds) for (const k of input.kinds) qs.append('kind', k);
      if (input?.projectId) qs.set('project', input.projectId);
      if (input?.since) qs.set('since', input.since);
      if (input?.q) qs.set('q', input.q);
      if (typeof input?.limit === 'number') qs.set('limit', String(input.limit));
      if (input?.cursor) qs.set('cursor', input.cursor);
      const path = qs.toString() ? `/api/sdk/v1/timeline?${qs.toString()}` : '/api/sdk/v1/timeline';
      return request<TimelinePage>('GET', path);
    },
    async connect(hello) {
      if (!opts.hubUrl) throw new Error('hubUrl required for connect()');
      if (opts.auth.kind !== 'token') {
        throw new Error('connect() requires kind=token auth (resolve OAuth first)');
      }
      const accessToken = opts.auth.accessToken;
      const ws = new WebSocket(opts.hubUrl);
      const handlers = new Map<string, Set<(e: ServerEvent) => void>>();
      ws.addEventListener('open', () => {
        const helloMsg: Hello = HelloSchema.parse({
          v: PROTOCOL_VERSION,
          type: 'hello',
          accessToken,
          ...hello,
        });
        ws.send(JSON.stringify(helloMsg));
      });
      ws.addEventListener('message', (ev) => {
        try {
          const data = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
          const parsed = ServerEventSchema.safeParse(data);
          if (!parsed.success) return;
          const set = handlers.get(parsed.data.type);
          if (set) for (const h of set) h(parsed.data);
        } catch {
          /* ignore malformed */
        }
      });
      return {
        send(event) {
          const parsed = ClientEventSchema.parse(event);
          ws.send(JSON.stringify(parsed));
        },
        on(type, handler) {
          let set = handlers.get(type);
          if (!set) {
            set = new Set();
            handlers.set(type, set);
          }
          set.add(handler as (e: ServerEvent) => void);
          return () => set!.delete(handler as (e: ServerEvent) => void);
        },
        close() {
          ws.close();
        },
      };
    },
  };
}

export type {
  CaptureCreate,
  RecallQuery,
  NotifyCreate,
  ServerEvent,
  ClientEvent,
} from '@metu/protocol';

export {
  buildAuthorizationUrl,
  createPkceChallenge,
  exchangeCode,
  refreshToken,
  requestDeviceCode,
  pollDeviceToken,
  OAuthError,
  type DeviceAuthorizationResponse,
  type ExchangeCodeInput,
  type PkceChallenge,
  type PollDeviceTokenInput,
  type RefreshTokenInput,
  type TokenResponse,
} from './oauth';
