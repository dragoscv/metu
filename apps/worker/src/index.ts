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
import { transcribeFromUrl } from './handlers/transcribe';

const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.WORKER_AUTH_TOKEN ?? '';

function authorized(req: http.IncomingMessage): boolean {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) return false;
  const provided = h.slice(7);
  // In prod, prefer GCP ID-token verification; for V1 we use a shared token.
  return TOKEN.length > 0 && provided === TOKEN;
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
