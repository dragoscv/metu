/**
 * Workspace queries — always tenant-scoped.
 * Every function here is the boundary that enforces multi-tenant isolation.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../client';
import { workspace, workspaceMember } from '../schema';

export async function getUserWorkspaces(userId: string) {
  const db = getDb();
  return db
    .select({
      workspace: workspace,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(and(eq(workspaceMember.userId, userId)));
}

export async function getWorkspaceForUser(workspaceId: string, userId: string) {
  const db = getDb();
  const rows = await db
    .select({ workspace, role: workspaceMember.role })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensurePersonalWorkspace(userId: string, name: string, slug: string) {
  const db = getDb();
  const existing = await getUserWorkspaces(userId);
  if (existing.length > 0) return existing[0]!.workspace;

  const [ws] = await db.insert(workspace).values({ name, slug }).returning();
  if (!ws) throw new Error('Failed to create workspace');

  await db.insert(workspaceMember).values({
    workspaceId: ws.id,
    userId,
    role: 'owner',
  });
  return ws;
}
