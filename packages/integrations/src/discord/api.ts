/**
 * Raw Discord Bot/HTTP API client — token-based, no global state.
 *
 * Covers what the BYO per-workspace Discord bot needs:
 *   - getCurrentUser (validate token + identity)
 *   - registerGlobalCommands (slash command menu)
 *   - createDM + sendMessage (proactive DMs + interaction follow-ups)
 *   - verifyInteractionSignature (Ed25519, for the interactions webhook)
 *
 * Discord REST base + version pinned. Errors throw with the Discord message.
 */
import { verify as edVerify, createPublicKey } from 'node:crypto';

const API_BASE = 'https://discord.com/api/v10';

async function call<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bot ${token}`,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const raw = await res.text();
    const json = raw ? JSON.parse(raw) : {};
    if (!res.ok) {
      const msg = (json as { message?: string }).message ?? `Discord ${path} failed (HTTP ${res.status})`;
      throw new Error(msg);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string;
}

/** Validate the bot token + return the bot user. */
export function getCurrentUser(token: string): Promise<DiscordUser> {
  return call<DiscordUser>(token, 'GET', '/users/@me');
}

export interface DiscordCommand {
  name: string;
  description: string;
  type?: number; // 1 = CHAT_INPUT
  options?: {
    name: string;
    description: string;
    type: number; // 3 = STRING
    required?: boolean;
  }[];
}

/** Bulk-overwrite the app's global slash commands. */
export function registerGlobalCommands(
  token: string,
  applicationId: string,
  commands: DiscordCommand[],
): Promise<unknown> {
  return call(token, 'PUT', `/applications/${applicationId}/commands`, commands);
}

/** Open (or fetch) a DM channel with a user. Returns the channel id. */
export async function createDM(token: string, recipientId: string): Promise<string> {
  const ch = await call<{ id: string }>(token, 'POST', '/users/@me/channels', {
    recipient_id: recipientId,
  });
  return ch.id;
}

export interface DiscordComponent {
  type: number;
  components?: DiscordComponent[];
  style?: number;
  label?: string;
  custom_id?: string;
}

/** Send a message to a channel (DM or guild). Returns the message id. */
export async function sendChannelMessage(
  token: string,
  channelId: string,
  content: string,
  components?: DiscordComponent[],
): Promise<string> {
  const msg = await call<{ id: string }>(token, 'POST', `/channels/${channelId}/messages`, {
    content,
    components,
  });
  return msg.id;
}

/**
 * Verify a Discord interaction request signature (Ed25519).
 * `publicKeyHex` is the app's public key from the Developer Portal.
 */
export function verifyInteractionSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        // SPKI prefix for Ed25519 public keys + the 32-byte raw key.
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyHex, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });
    return edVerify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}

/** Inline button rows for approve/reject. */
export function approveRejectRow(toolCallId: string): DiscordComponent[] {
  return [
    {
      type: 1, // action row
      components: [
        { type: 2, style: 3, label: '✅ Approve', custom_id: `approve:${toolCallId}` },
        { type: 2, style: 4, label: '🚫 Reject', custom_id: `reject:${toolCallId}` },
      ],
    },
  ];
}
