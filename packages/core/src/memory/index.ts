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
  limit?: number;
}) {
  const { model } = await getModel({
    workspaceId: params.workspaceId,
    intent: 'embed',
  });
  const { embedding } = await embed({
    model: model as Parameters<typeof embed>[0]['model'],
    value: params.query,
  });

  return recallByEmbedding({
    workspaceId: params.workspaceId,
    embedding,
    projectId: params.projectId,
    limit: params.limit ?? 10,
  });
}
