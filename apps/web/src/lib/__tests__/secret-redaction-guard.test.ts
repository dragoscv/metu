/**
 * Architectural regression guard for secret leakage.
 *
 * Searches every file under `apps/web/src/app/actions/**` and
 * `apps/web/src/app/api/**` for code that decrypts a Sealed token
 * (`open(...)`, `openSealed(...)`) or reads a known credential field
 * (`apiKeyCiphertext`, `accessToken`, `refreshToken`, `webhookSecret`,
 * `tokenCiphertext`, `tokenSealed.ciphertext`) and then either:
 *   - logs it (`console.*(...secret...)`)
 *   - returns it from a Server Action (`return { ...secret... }`)
 *
 * This catches the bug class: "I'm debugging this oauth flow, let me
 * just log the token" — which is a security incident if shipped.
 *
 * Heuristic, not perfect — the EXEMPT set lists call sites where the
 * value really IS supposed to leave the function (e.g. the OAuth token
 * endpoint that returns `access_token` to the SDK consumer).
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Dirent } from 'node:fs';

const ROOTS = [
  path.resolve(__dirname, '../../app/actions'),
  path.resolve(__dirname, '../../app/api'),
];

/** Names that, when surrounded by `console.*(...)` or `return ...`, raise the alarm. */
const SECRET_TOKENS = [
  'accessToken',
  'refreshToken',
  'webhookSecret',
  'apiKeyCiphertext',
  'tokenCiphertext',
  'plaintextToken',
  'rawToken',
  'sealedToken',
  'clientSecret',
  'apiKey',
];

/**
 * Files where returning a secret is the documented contract. Each entry
 * is the path-relative file plus a comment.
 */
const EXEMPT_FILES = new Set<string>([
  // OAuth token endpoint — RFC 6749 mandates returning access_token in the response body.
  'oauth/token/route.ts',
  // OAuth device endpoint — same, returns device_code + user_code.
  'oauth/device/route.ts',
  // OAuth authorize / callback — issues access_token to the consumer's redirect URI.
  'oauth/authorize/route.ts',
  'oauth/[appId]/callback/route.ts',
  // Internal worker / hub routes — return access_token for inter-service auth.
  'internal/worker/token/route.ts',
  // App registration shows the secret ONCE (per spec); UI-side copy.
  'apps.ts',
  'oauth-apps.ts',
  // Copilot returns userCode + deviceCode to the UI for the device flow.
  'copilot.ts',
  // Telegram link code is a short-lived 6-digit code — not really a secret.
  'telegram.ts',
  // Companion device pairing returns code by design.
  'devices/pair/route.ts',
]);

async function walkTs(dir: string, out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walkTs(full, out);
    } else if (e.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) {
      out.push(full);
    }
  }
}

function relName(file: string, root: string): string {
  return path.relative(root, file).replace(/\\/g, '/');
}

describe('secret redaction guard', () => {
  it('no console.* logs include a secret-named identifier', async () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      const files: string[] = [];
      await walkTs(root, files);
      for (const file of files) {
        const rel = relName(file, root);
        if (EXEMPT_FILES.has(rel)) continue;
        const src = await fs.readFile(file, 'utf8');
        // Match `console.<method>(... <secretName> ...)` on one logical line.
        // We use a tolerant regex over a single line; multi-line console
        // calls are rare in this codebase.
        const lines = src.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!/console\s*\.\s*(log|info|warn|error|debug|trace)/.test(line)) continue;
          for (const t of SECRET_TOKENS) {
            // Word-boundary match; ignore comments.
            const codeOnly = line.replace(/\/\/.*$/, '');
            const re = new RegExp(`\\b${t}\\b`);
            if (re.test(codeOnly)) {
              offenders.push(`${rel}:${i + 1}  → ${line.trim().slice(0, 120)}`);
            }
          }
        }
      }
    }
    expect(
      offenders,
      `console.* calls referencing secret-named identifiers:\n${offenders.join('\n')}\n\nIf intentional (e.g. logging only the length), refactor to log a redacted form like \`{ tokenLen: token.length }\`.`,
    ).toEqual([]);
  });
});
