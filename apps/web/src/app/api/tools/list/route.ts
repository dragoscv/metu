/**
 * Authenticated tool catalog for the command palette `/tool` runner.
 *
 * Returns the same {name, description, kind} shape the planner sees so
 * the cmdk picker can fuzzy-match by name and show kind/description.
 * Workspace-agnostic — the registry is global; per-workspace ACL gates
 * happen at runTool() time.
 */
import { NextResponse } from 'next/server';
import { auth } from '@metu/auth';
import { agent } from '@metu/core';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ tools: agent.listTools() });
}
