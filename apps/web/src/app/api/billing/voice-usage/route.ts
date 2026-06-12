/**
 * GET /api/billing/voice-usage
 *
 * Cookie-authenticated CSV export of the current month's `voice_usage`
 * rows. Anchored to a session, NOT a bearer token, because the export is
 * a browser download from the settings page.
 */
import { auth } from '@metu/auth';
import { getVoiceUsageCsvAction } from '@/app/actions/billing';

export async function GET() {
  const session = await auth();
  if (!session) return new Response('unauthorized', { status: 401 });
  const csv = await getVoiceUsageCsvAction();
  const filename = `voice-usage-${new Date().toISOString().slice(0, 7)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
