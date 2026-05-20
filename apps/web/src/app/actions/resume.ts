'use server';
/**
 * Server actions for the Resume / Restore surfaces.
 *
 * `regenerateWorkspaceBriefingAction` calls the `briefing_generate` tool
 * (workspace scope) through the policy gate. Returns the produced briefing
 * synchronously so the calling page can render it inline.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { agent } from '@metu/core';

const ProjectBriefingInput = z.object({ projectId: z.uuid() });

export async function regenerateWorkspaceBriefingAction(): Promise<
  { ok: true; briefing: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };

  const result = await agent.runTool({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    tool: 'briefing_generate',
    args: {},
  });

  if (result.status === 'awaiting_approval') {
    return { ok: false, error: 'awaiting_approval' };
  }
  if (result.status !== 'success' || !result.result) {
    return { ok: false, error: result.error ?? 'briefing_failed' };
  }

  const r = result.result as { briefing?: string };
  revalidatePath('/resume');
  revalidatePath('/restore');
  return { ok: true, briefing: r.briefing ?? '' };
}

export async function regenerateProjectBriefingAction(input: {
  projectId: string;
}): Promise<{ ok: true; briefing: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = ProjectBriefingInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid_input' };
  }

  const result = await agent.runTool({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    tool: 'briefing_generate',
    args: { projectId: parsed.data.projectId },
  });

  if (result.status === 'awaiting_approval') {
    return { ok: false, error: 'awaiting_approval' };
  }
  if (result.status !== 'success' || !result.result) {
    return { ok: false, error: result.error ?? 'briefing_failed' };
  }

  const r = result.result as { briefing?: string };
  revalidatePath('/resume');
  revalidatePath(`/projects/${parsed.data.projectId}`);
  return { ok: true, briefing: r.briefing ?? '' };
}
