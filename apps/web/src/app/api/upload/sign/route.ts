import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { gcs } from '@metu/integrations';

const schema = z.object({
  contentType: z.string().min(1).max(120),
  kind: z.enum(['voice', 'screenshot', 'file', 'image']),
  ext: z.string().max(8).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ ok: false, error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' },
      { status: 400 },
    );
  }

  const ext = parsed.data.ext ?? guessExt(parsed.data.contentType);
  const storageKey = gcs.newStorageKey(`ws/${session.user.workspaceId}/${parsed.data.kind}`, ext);
  const url = await gcs.getSignedUploadUrl({
    storageKey,
    contentType: parsed.data.contentType,
  });
  return NextResponse.json({ ok: true, url, storageKey });
}

function guessExt(ct: string) {
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mp3') || ct.includes('mpeg')) return 'mp3';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('pdf')) return 'pdf';
  return 'bin';
}
