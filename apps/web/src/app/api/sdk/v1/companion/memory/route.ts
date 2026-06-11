/**
 * SDK v1 — POST /api/sdk/v1/companion/memory
 *
 * Agent v2 Slice D — preference/correction memory. When the companion
 * detects the user stating a durable preference ("always answer in
 * Romanian", "call me Dragos", "never suggest X") or correcting the
 * assistant, it persists the statement here. Stored as a workspace
 * memory chunk (sourceKind 'manual', metadata.kind 'preference') so the
 * existing `recall` tool surfaces it in future turns — the learning loop
 * closes with zero new read paths.
 *
 * Scope: `capture:write` (same trust domain as activity summaries).
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { indexMemory, recall } from '@metu/core/memory';
import { getDb } from '@metu/db';
import { memoryChunk } from '@metu/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Body = z.object({
  kind: z.enum(['preference', 'correction', 'continuity']),
  /** The user's own words — stored verbatim for faithful recall. */
  statement: z.string().min(3).max(2_000),
  /** Where it was said (companion chat, voice, …). */
  surface: z.enum(['companion', 'mobile', 'web', 'vscode', 'browser']).default('companion'),
});

export async function POST(req: NextRequest) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { kind, statement, surface } = parsed.data;

  // Supersession (Jarvis v3.1): a NEW preference/correction replaces any
  // strongly-similar older one — otherwise recall surfaces both "always
  // answer in English" and the later "always answer in Romanian" and the
  // model has to guess. Semantic match ≥ 0.55 on existing learning chunks
  // → delete the old rows before indexing the new statement.
  if (kind === 'preference' || kind === 'correction') {
    try {
      const result = await recall({
        workspaceId: session.workspaceId,
        query: statement,
        kinds: ['manual'],
        minScore: 0.55,
        mode: 'semantic',
        dedupe: false,
        limit: 5,
      });
      const rows =
        ((result as { rows?: Array<{ id: string; content: string }> }).rows ??
          (result as unknown as Array<{ id: string; content: string }>)) ||
        [];
      const superseded = rows
        .filter((r) => /^User (preference|correction):/.test(r.content))
        .map((r) => r.id);
      if (superseded.length > 0) {
        const db = getDb();
        await db
          .delete(memoryChunk)
          .where(
            and(
              eq(memoryChunk.workspaceId, session.workspaceId),
              inArray(memoryChunk.id, superseded),
            ),
          );
      }
    } catch {
      // Supersession is best-effort — never block storing the new statement.
    }
  }

  const { chunkCount } = await indexMemory({
    workspaceId: session.workspaceId,
    sourceKind: 'manual',
    content:
      kind === 'continuity'
        ? `End-of-day wrap (${new Date().toISOString().slice(0, 10)}): ${statement}`
        : `User ${kind === 'preference' ? 'preference' : 'correction'}: ${statement}`,
    metadata: {
      origin: 'companion-learning',
      kind,
      surface,
      userId: session.userId,
      statedAt: Date.now(),
    },
  });

  return NextResponse.json({ ok: true, chunkCount });
}
