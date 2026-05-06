import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { memory } from '@metu/core';
import { gcs } from '@metu/integrations';
import { inngest } from '../client';

/** capture.created → transcribe (if voice) → embed → focus.recompute */
export const onCaptureCreated = inngest.createFunction(
  { id: 'capture-pipeline', name: 'Capture pipeline' },
  { event: 'capture/created' },
  async ({ event, step }) => {
    const { captureId, workspaceId, userId } = event.data;
    const db = getDb();

    const [row] = await db.select().from(capture).where(eq(capture.id, captureId)).limit(1);
    if (!row) return { skipped: 'not found' };

    let content = row.content;

    // 1. transcribe voice via worker
    if (row.kind === 'voice' && row.storageKey) {
      content = await step.run('transcribe', async () => {
        const url = await gcs.getSignedReadUrl(row.storageKey!, 600);
        const res = await fetch(`${process.env.WORKER_URL}/transcribe`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${process.env.WORKER_AUTH_TOKEN}`,
          },
          body: JSON.stringify({ url, language: 'en' }),
        });
        if (!res.ok) throw new Error(`Worker transcribe ${res.status}`);
        const json = (await res.json()) as { text: string };
        return json.text;
      });
      await db.update(capture).set({ content, status: 'ready' }).where(eq(capture.id, captureId));
    }

    if (!content || content.trim().length < 4) {
      await db.update(capture).set({ status: 'ready' }).where(eq(capture.id, captureId));
      return { indexed: 0 };
    }

    // 2. embed + index
    const { chunkCount } = await step.run('embed', () =>
      memory.indexMemory({
        workspaceId,
        projectId: row.projectId,
        sourceKind: 'capture',
        sourceId: captureId,
        content,
      }),
    );

    await db.update(capture).set({ status: 'ready' }).where(eq(capture.id, captureId));

    await db.insert(timelineEvent).values({
      workspaceId,
      userId,
      projectId: row.projectId,
      kind: 'memory.indexed',
      title: `Indexed ${chunkCount} chunks`,
      importance: 0.3,
    });

    // 3. trigger focus recompute (debounced inside the focus function if needed)
    await step.sendEvent('focus-recompute', {
      name: 'focus/recompute',
      data: { workspaceId, userId, reason: 'capture' },
    });

    return { indexed: chunkCount };
  },
);
