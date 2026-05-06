'use server';
import { revalidatePath } from 'next/cache';
import { Inngest } from 'inngest';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import {
  parseConversations,
  renderConversation,
  type ConversationFormat,
} from '@/lib/conversation-import/parse';

const inngest = new Inngest({ id: 'metu' });

const MAX_CAPTURE_CONTENT = 200_000; // ~50k tokens worst-case; chunker splits further

export interface ImportConversationsInput {
  raw: string;
  format?: ConversationFormat;
  projectId?: string | null;
}

export interface ImportConversationsResult {
  imported: number;
  skipped: number;
  format: ConversationFormat;
  titles: string[];
}

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function importConversationsAction(
  input: ImportConversationsInput,
): Promise<ActionResult<ImportConversationsResult>> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };

  if (!input.raw || typeof input.raw !== 'string') {
    return { ok: false, error: 'Empty input' };
  }
  if (input.raw.length > 25_000_000) {
    return { ok: false, error: 'Input too large (max 25 MB)' };
  }

  let parsed;
  try {
    parsed = parseConversations(input.raw, input.format);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to parse',
    };
  }

  if (parsed.conversations.length === 0) {
    return {
      ok: false,
      error:
        parsed.format === 'unknown'
          ? 'Unrecognized format. Paste a ChatGPT or Claude export, or markdown with User:/Assistant: markers.'
          : 'No conversations found in input.',
    };
  }

  const db = getDb();
  const titles: string[] = [];
  let imported = 0;
  let skipped = 0;

  for (const conv of parsed.conversations) {
    const rendered = renderConversation(conv);
    if (!rendered || rendered.length < 8) {
      skipped++;
      continue;
    }
    const content =
      rendered.length > MAX_CAPTURE_CONTENT ? rendered.slice(0, MAX_CAPTURE_CONTENT) : rendered;

    try {
      const [row] = await db
        .insert(capture)
        .values({
          workspaceId: session.user.workspaceId,
          userId: session.user.id,
          projectId: input.projectId ?? null,
          kind: 'message',
          status: 'ready',
          content,
          source: 'web',
          metadata: {
            imported: true,
            format: parsed.format,
            externalId: conv.externalId,
            messageCount: conv.messages.length,
            title: conv.title,
            conversationCreatedAt: conv.createdAt,
            conversationUpdatedAt: conv.updatedAt,
            ...conv.metadata,
          },
          capturedAt: conv.updatedAt
            ? new Date(conv.updatedAt)
            : conv.createdAt
              ? new Date(conv.createdAt)
              : new Date(),
        })
        .returning();

      if (!row) {
        skipped++;
        continue;
      }

      await db.insert(timelineEvent).values({
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
        projectId: input.projectId ?? null,
        kind: 'conversation.imported',
        title: `Imported: ${conv.title}`,
        body: `${conv.messages.length} messages from ${parsed.format}`,
        payload: {
          captureId: row.id,
          format: parsed.format,
          messageCount: conv.messages.length,
        },
        importance: 0.5,
      });

      // Fire pipeline (chunk + embed + focus recompute) — same path as
      // a regular text capture.
      try {
        await inngest.send({
          name: 'capture/created',
          data: {
            workspaceId: session.user.workspaceId,
            userId: session.user.id,
            captureId: row.id,
          },
        });
      } catch (err) {
        console.warn('inngest dispatch failed', err);
      }

      titles.push(conv.title);
      imported++;
    } catch (err) {
      console.error('import conversation failed', err);
      skipped++;
    }
  }

  revalidatePath('/inbox');
  revalidatePath('/timeline');
  if (input.projectId) revalidatePath(`/projects/${input.projectId}`);

  return {
    ok: true,
    data: { imported, skipped, format: parsed.format, titles },
  };
}
