/**
 * metu worker — Cloud Run service.
 *
 * Routes:
 *  POST /transcribe      — { url, language? } → { text }
 *  POST /agent           — { workspaceId, kind, input } → agent run
 *  GET  /health
 *
 * Auth: Bearer token must equal WORKER_AUTH_TOKEN (dev) OR a valid GCP ID
 * token whose audience matches the service URL (prod, automatic via Cloud Run
 * IAM when invoker is the web service account).
 */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { transcribeFromUrl } from './handlers/transcribe';

const PORT = Number(process.env.PORT ?? 24892);
const TOKEN = process.env.WORKER_AUTH_TOKEN ?? '';

if (process.env.NODE_ENV === 'production' && TOKEN.length < 32) {
  throw new Error('WORKER_AUTH_TOKEN must be set to at least 32 characters in production');
}

function authorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return false;
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) return false;
  const provided = Buffer.from(h.slice(7));
  const expected = Buffer.from(TOKEN);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
      return;
    }
    if (!authorized(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/transcribe') {
      const body = (await readBody(req)) as { url: string; language?: string };
      const result = await transcribeFromUrl(body);
      res.end(JSON.stringify(result));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  } catch (err) {
    console.error('[worker]', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'error' }));
  }
});

server.listen(PORT, () => {
  console.info(`[worker] listening on :${PORT}`);
});
