/**
 * Memory Engine — chunk + embed + recall.
 *
 * Chunking is intentionally simple: split by paragraphs, then merge so each
 * chunk is ≤ ~512 tokens. Good enough for V1; can swap to semantic splitter.
 */
import { embed, embedMany } from 'ai';
import { getDb } from '@metu/db';
import { memoryChunk } from '@metu/db/schema';
import { recallByEmbedding } from '@metu/db/queries';
import { getModel } from '@metu/ai';

const TARGET_TOKENS = 512;
const APPROX_CHARS_PER_TOKEN = 4;

export function chunkText(content: string): string[] {
  if (!content?.trim()) return [];
  const target = TARGET_TOKENS * APPROX_CHARS_PER_TOKEN;
  const paragraphs = content
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = '';
  for (const p of paragraphs) {
    if ((buf + '\n\n' + p).length > target && buf) {
      chunks.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  if (buf) chunks.push(buf);

  // Hard split anything still oversized.
  return chunks.flatMap((c) => {
    if (c.length <= target) return [c];
    const parts: string[] = [];
    for (let i = 0; i < c.length; i += target) parts.push(c.slice(i, i + target));
    return parts;
  });
}

export interface IndexInput {
  workspaceId: string;
  projectId?: string | null;
  sourceKind:
    | 'capture'
    | 'task'
    | 'decision'
    | 'project_summary'
    | 'repo_file'
    | 'commit'
    | 'email'
    | 'message'
    | 'agent_run'
    | 'manual';
  sourceId?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
}

export async function indexMemory(input: IndexInput) {
  const chunks = chunkText(input.content);
  if (chunks.length === 0) return { chunkCount: 0 };

  const { model } = await getModel({
    workspaceId: input.workspaceId,
    intent: 'embed',
  });

  const { embeddings } = await embedMany({
    model: model as Parameters<typeof embedMany>[0]['model'],
    values: chunks,
  });

  const db = getDb();
  await db.insert(memoryChunk).values(
    chunks.map((content, i) => ({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId ?? null,
      content,
      embedding: embeddings[i],
      metadata: { position: i, ...input.metadata },
    })),
  );

  return { chunkCount: chunks.length };
}

export async function recall(params: {
  workspaceId: string;
  query: string;
  projectId?: string;
  kinds?: string[];
  since?: Date | null;
  until?: Date | null;
  minScore?: number;
  mode?: 'hybrid' | 'semantic' | 'keyword';
  dedupe?: boolean;
  limit?: number;
}) {
  const mode = params.mode ?? 'hybrid';
  const dedupe = params.dedupe ?? true;
  // Over-fetch a bit so post-dedupe still has limit results.
  const fetchLimit = dedupe ? Math.min((params.limit ?? 10) * 3, 50) : (params.limit ?? 10);

  // Keyword-only avoids the embed call entirely — saves tokens, useful
  // for exact-phrase searches over recent captures.
  if (mode === 'keyword') {
    const result = await recallByEmbedding({
      workspaceId: params.workspaceId,
      embedding: [],
      projectId: params.projectId,
      kinds: params.kinds,
      since: params.since,
      until: params.until,
      mode,
      query: params.query,
      limit: fetchLimit,
    });
    return dedupe ? dedupeRecallResult(result, params.limit ?? 10) : result;
  }

  const { model } = await getModel({
    workspaceId: params.workspaceId,
    intent: 'embed',
  });
  const { embedding } = await embed({
    model: model as Parameters<typeof embed>[0]['model'],
    value: params.query,
  });

  const result = await recallByEmbedding({
    workspaceId: params.workspaceId,
    embedding,
    projectId: params.projectId,
    kinds: params.kinds,
    since: params.since,
    until: params.until,
    minScore: params.minScore,
    mode,
    query: params.query,
    limit: fetchLimit,
  });
  return dedupe ? dedupeRecallResult(result, params.limit ?? 10) : result;
}

/**
 * Collapse near-identical hits — same sourceId always wins the highest-
 * scoring chunk; otherwise we hash a normalized prefix (lowercased,
 * collapsed whitespace, first 120 chars) and keep one row per hash.
 * Preserves the original result envelope shape (`{rows: ...}` or array).
 */
function dedupeRecallResult<T>(result: T, limit: number): T {
  const rows =
    ((result as { rows?: unknown[] }).rows as Array<{
      id: string;
      content: string;
      similarity: number;
      source_id: string | null;
    }>) ??
    (result as unknown as Array<{
      id: string;
      content: string;
      similarity: number;
      source_id: string | null;
    }>);
  if (!Array.isArray(rows)) return result;

  const bySource = new Map<string, (typeof rows)[number]>();
  const byPrefix = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.source_id) {
      const prev = bySource.get(row.source_id);
      if (!prev || (row.similarity ?? 0) > (prev.similarity ?? 0)) {
        bySource.set(row.source_id, row);
      }
      continue;
    }
    const key = (row.content ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!key) continue;
    const prev = byPrefix.get(key);
    if (!prev || (row.similarity ?? 0) > (prev.similarity ?? 0)) {
      byPrefix.set(key, row);
    }
  }

  const merged = [...bySource.values(), ...byPrefix.values()]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);

  if ((result as { rows?: unknown[] }).rows) {
    return { ...(result as object), rows: merged } as T;
  }
  return merged as unknown as T;
}
