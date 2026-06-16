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
import { z } from 'zod';
import { initNodeSentry, log } from '@metu/logger';
import { transcribeFromUrl } from './handlers/transcribe';

await initNodeSentry({ service: 'worker' });

// Initialize the DB before serving when the Cloud SQL Connector is configured
// (Cloud Run prod) so DB-touching jobs don't fail reaching a public IP.
if (process.env.INSTANCE_CONNECTION_NAME) {
  const { initDb } = await import('@metu/db');
  await initDb();
}

const PORT = Number(process.env.PORT ?? 24892);
const TOKEN = process.env.WORKER_AUTH_TOKEN ?? '';
/** Cap incoming bodies at 1 MB — transcribe payloads are tiny (URL + lang). */
const MAX_BODY_BYTES = Number(process.env.WORKER_MAX_BODY_BYTES ?? 1 * 1024 * 1024);

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
  let total = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) {
      throw new Error('payload too large');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const TranscribeBodySchema = z.object({
  url: z.string().url(),
  language: z.string().min(2).max(10).optional(),
});

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
      const raw = await readBody(req);
      const parsed = TranscribeBodySchema.safeParse(raw);
      if (!parsed.success) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'invalid_body' }));
        return;
      }
      const result = await transcribeFromUrl(parsed.data);
      res.end(JSON.stringify(result));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  } catch (err) {
    log.error('worker.request.error', { url: req.url, method: req.method }, err);
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'error' }));
  }
});

server.listen(PORT, () => {
  log.info('worker.http.listening', { port: PORT });
});
