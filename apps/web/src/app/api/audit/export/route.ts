/**
 * GET /api/audit/export?tools=…&statuses=…&since=7d&q=…
 *
 * Streams a CSV of `tool_call` rows for the current workspace using the
 * same filters as `/audit`. Cookie-authenticated (the proxy.ts allowlist
 * does NOT include this path, so the session check below is enforced).
 *
 * Caps at 50,000 rows (see exportToolCalls) — anything bigger should be
 * paginated through the SDK or grabbed directly from the warehouse.
 */
import { auth } from '@metu/auth';
import { exportToolCalls, type ToolCallStatusFilter } from '@metu/db/queries';
import { requireTier } from '@/lib/tier-gate';
import { NextResponse, type NextRequest } from 'next/server';

const VALID_STATUSES: ToolCallStatusFilter[] = [
  'pending',
  'awaiting_approval',
  'approved',
  'rejected',
  'running',
  'success',
  'failed',
  'undone',
  'cancelled',
];

const DEFAULT_SINCE_DAYS = 7;
const MAX_SINCE_DAYS = 365;

function parseSince(since: string | null): Date {
  const m = since?.match(/^(\d+)d$/);
  const raw = m ? Number(m[1]) : DEFAULT_SINCE_DAYS;
  const days = Math.min(Math.max(raw, 1), MAX_SINCE_DAYS);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// CSV escape per RFC 4180: wrap in double quotes when the field contains
// comma, quote, CR, or LF. Double up embedded quotes. JSON columns get
// stringified first so the entire payload sits in a single cell.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const COLUMNS = [
  'id',
  'requested_at',
  'decided_at',
  'finished_at',
  'tool',
  'status',
  'acl_mode',
  'estimated_cost_usd',
  'actual_cost_usd',
  'error',
  'agent_run_id',
  'agent_run_kind',
  'conversation_id',
  'conversation_title',
] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const wsId = session.user.workspaceId;
  if (!wsId) {
    return NextResponse.json({ error: 'No workspace' }, { status: 403 });
  }
  // CSV export is a paid feature — basic in-app /audit view stays free.
  const gate = await requireTier(wsId, 'pro');
  if (!gate.ok) {
    return NextResponse.json(
      { error: 'plan_required', tier: gate.tier, minTier: gate.minTier },
      { status: 402 },
    );
  }

  const sp = req.nextUrl.searchParams;
  const since = parseSince(sp.get('since'));
  const tools = (sp.get('tools') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const statuses = (sp.get('statuses') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ToolCallStatusFilter => (VALID_STATUSES as string[]).includes(s));
  const search = sp.get('q');

  const rows = await exportToolCalls({
    workspaceId: wsId,
    tools: tools.length > 0 ? tools : undefined,
    statuses: statuses.length > 0 ? statuses : undefined,
    since,
    search: search || null,
  });

  const lines: string[] = [COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.id),
        csvCell(r.requestedAt),
        csvCell(r.decidedAt),
        csvCell(r.finishedAt),
        csvCell(r.tool),
        csvCell(r.status),
        csvCell(r.aclMode),
        csvCell(r.estimatedCostUsd),
        csvCell(r.actualCostUsd),
        csvCell(r.error),
        csvCell(r.agentRunId),
        csvCell(r.agentRunKind),
        csvCell(r.conversationId),
        csvCell(r.conversationTitle),
      ].join(','),
    );
  }
  // Trailing newline keeps `wc -l` and Excel happy.
  const body = lines.join('\r\n') + '\r\n';

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `metu-audit-${stamp}.csv`;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
