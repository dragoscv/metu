/**
 * SDK v1 — POST /api/sdk/v1/companion/vision
 *
 * True vision lane (Jarvis v5): the companion captures a screenshot
 * natively (device_screenshot, capability-gated on device) and sends the
 * PNG base64 here with a question. We run the workspace's `vision` intent
 * model and stream the answer back as plain text.
 *
 * This sees what OCR can't: layouts, designs, charts, images, video
 * frames, visual bugs, color issues.
 *
 * Caps: ~2.5MB base64 (≈1.8MB PNG — the device already downscales to
 * 1600px longest edge). Screenshot is NOT persisted server-side.
 */
import { z } from 'zod';
import { type NextRequest } from 'next/server';
import { streamText } from 'ai';
import { getModel } from '@metu/ai';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { assertVoiceCap } from '@/lib/voice-billing';

export const runtime = 'nodejs';
export const maxDuration = 45;

const IDENTITY = `You ARE metu — the user's personal AI operating system, looking at their screen through your own eyes (a screenshot you just took). Speak in first person. Be concrete about what you SEE: layout, visuals, charts, images, states — not just text.`;

const Body = z.object({
  /** PNG screenshot, base64 (no data: prefix). */
  imageBase64: z.string().min(100).max(2_500_000),
  /** What the user wants to know. */
  question: z.string().min(1).max(1_000),
  personaSlug: z.string().min(1).max(80).default('atlas'),
  language: z.enum(['en', 'ro']).optional(),
});

export async function POST(req: NextRequest) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('companion-skill', session.userId);
  if (limited) return limited;

  const cap = await assertVoiceCap(session.workspaceId);
  if (!cap.ok) return new Response('Budget reached.', { status: 402 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? 'invalid', { status: 400 });
  }

  const { model } = await getModel({ workspaceId: session.workspaceId, intent: 'vision' });

  const langDirective =
    parsed.data.language === 'ro' ? '\n\nReply ONLY in Romanian (limba română).' : '';
  const chipsDirective = `\n\nAfter your answer, on a NEW final line: CHIPS: ["…","…"] — 2-3 short follow-up actions grounded in what you saw.`;

  const result = streamText({
    model: model as Parameters<typeof streamText>[0]['model'],
    system: IDENTITY + langDirective + chipsDirective,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: parsed.data.question },
          {
            type: 'image',
            image: parsed.data.imageBase64,
            mediaType: 'image/png',
          },
        ],
      },
    ],
    maxOutputTokens: 450,
  });

  return result.toTextStreamResponse();
}
