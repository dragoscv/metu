import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { safeEqual } from '@/lib/safe-equal';
import { getDb } from '@metu/db';
import { telegramChatLink } from '@metu/db/schema';
import { companionAgent } from '@metu/core';
import { bot, extractCapture } from '@metu/integrations/telegram';
import type { Context } from 'telegraf';
import { loadPromptContext } from '@/lib/prompt-context';
import { claimTelegramLinkCode } from '@/app/actions/telegram';
import { transcribeRemoteAudio } from '@/lib/transcribe';
import { inngest } from '@/inngest/client';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';

const START_CMD_RE = /^\/start(?:@\w+)?\s+(\d{6})\b/;

/**
 * Telegram inbound webhook.
 *
 * Three paths:
 *   1. `/start <6-digit code>` — claim the code, write a chat→workspace
 *      link, reply with success.
 *   2. Linked chat, text utterance — run the companion-agent and reply.
 *   3. Unlinked chat, anything else — print onboarding instructions.
 *
 * Voice/photo capture is deferred (slice DD); attachments are acked.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const expected = process.env.TELEGRAM_BOT_TOKEN?.replace(/[^a-zA-Z0-9]/g, '');
  const provided = url.pathname.split('/').pop();
  if (!expected || !safeEqual(provided, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  if (!update) return NextResponse.json({ ok: true });

  const fakeCtx = { message: update.message } as unknown as Context;
  const capture = extractCapture(fakeCtx);
  if (!capture) return NextResponse.json({ ok: true });

  const chatId = capture.externalChatId;
  const text = capture.text?.trim();
  const voiceFileId = capture.voiceFileId;
  const photoFileId = capture.photoFileId;
  const photoCaption = capture.caption?.trim();
  const db = getDb();

  // /help works in any chat, linked or not.
  if (text && /^\/help(\s|@|$)/.test(text)) {
    await bot()
      .telegram.sendMessage(
        chatId,
        [
          '*metu bot \u2014 quick reference*',
          '',
          '/start <code> \u2014 link this chat to a workspace',
          '/help \u2014 this message',
          '',
          'Send me text, a voice note, or a photo with a caption.',
          'Voice notes are transcribed via your OpenAI key.',
          'Photos: include a caption \u2014 I save it as a capture.',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      )
      .catch(() => {});
    return NextResponse.json({ ok: true, help: true });
  }

  if (text) {
    const m = text.match(START_CMD_RE);
    if (m) {
      const code = m[1]!;
      const claim = await claimTelegramLinkCode(code);
      if (!claim) {
        await bot()
          .telegram.sendMessage(
            chatId,
            'That code is invalid or has expired. Issue a new one in metu \u2192 Settings \u2192 Integrations \u2192 Telegram.',
          )
          .catch(() => {});
        return NextResponse.json({ ok: true, claimed: false });
      }
      await db
        .insert(telegramChatLink)
        .values({
          chatId,
          workspaceId: claim.workspaceId,
          personaSlug: claim.personaSlug,
          linkedByUserId: claim.issuedByUserId,
          fromUserName: capture.fromUserName ?? null,
        })
        .onConflictDoUpdate({
          target: telegramChatLink.chatId,
          set: {
            workspaceId: claim.workspaceId,
            personaSlug: claim.personaSlug,
            linkedByUserId: claim.issuedByUserId,
            fromUserName: capture.fromUserName ?? null,
          },
        });
      await bot()
        .telegram.sendMessage(
          chatId,
          `Linked. Talk to me anytime \u2014 I\u2019m running as *${claim.personaSlug}*.`,
          { parse_mode: 'Markdown' },
        )
        .catch(() => {});
      return NextResponse.json({ ok: true, linked: true });
    }
  }

  const link = await db
    .select()
    .from(telegramChatLink)
    .where(eq(telegramChatLink.chatId, chatId))
    .limit(1);

  if (link.length === 0) {
    await bot()
      .telegram.sendMessage(
        chatId,
        'This chat isn\u2019t linked to a metu workspace yet. Open metu \u2192 Settings \u2192 Integrations \u2192 Telegram, copy your link code, and send `/start <code>` here.',
        { parse_mode: 'Markdown' },
      )
      .catch((err) => log.error('telegram.reply.failed', { chatId }, err));
    return NextResponse.json({ ok: true, unlinked: true });
  }

  const row = link[0]!;
  await db
    .update(telegramChatLink)
    .set({ lastInboundAt: sql`now()` })
    .where(eq(telegramChatLink.chatId, chatId));

  if (!text) {
    if (voiceFileId) {
      // Lazy-import to avoid pulling telegraf into route TS evaluation cost
      // when there's no voice — and so we can fail-soft without breaking text.
      try {
        const { getFileLink } = await import('@metu/integrations/telegram');
        const link = await getFileLink(voiceFileId);
        const audioUrl = typeof link === 'string' ? link : link.toString();
        const stt = await transcribeRemoteAudio(row.workspaceId, audioUrl);
        if (!stt?.text) {
          await bot()
            .telegram.sendMessage(
              chatId,
              'Couldn\u2019t transcribe that voice note. Make sure an OpenAI key is set up in metu.',
            )
            .catch(() => {});
          return NextResponse.json({ ok: true, voice: 'failed' });
        }
        return await runCompanion({
          db,
          row,
          chatId,
          utterance: stt.text,
          notice: `_(Heard: \u201c${stt.text.slice(0, 140)}\u201d)_`,
        });
      } catch (err) {
        log.error('telegram.voice.failed', { chatId }, err);
        await bot()
          .telegram.sendMessage(
            chatId,
            'Voice messages aren\u2019t set up yet \u2014 try sending text.',
          )
          .catch(() => {});
        return NextResponse.json({ ok: true, voice: 'error' });
      }
    }
    if (photoFileId) {
      // No vision pipeline yet \u2014 if the user added a caption, treat
      // the caption as the utterance. Otherwise, prompt them.
      if (photoCaption) {
        return await runCompanion({
          db,
          row,
          chatId,
          utterance: photoCaption,
          notice: '_(Got your photo \u2014 using the caption as context.)_',
        });
      }
      await bot()
        .telegram.sendMessage(
          chatId,
          'I saw the photo, but I can\u2019t read images yet \u2014 add a caption next time so I have something to work with.',
        )
        .catch(() => {});
      return NextResponse.json({ ok: true, photo: 'no_caption' });
    }
    await bot()
      .telegram.sendMessage(
        chatId,
        'Got it \u2014 photos and other attachments are queued but I only reply to text or voice right now.',
      )
      .catch(() => {});
    return NextResponse.json({ ok: true, capturedOnly: true });
  }

  return await runCompanion({ db, row, chatId, utterance: text });
}

type LinkRow = {
  chatId: string;
  workspaceId: string;
  personaSlug: string;
  linkedByUserId: string;
};

async function runCompanion(args: {
  db: ReturnType<typeof getDb>;
  row: LinkRow;
  chatId: string;
  utterance: string;
  notice?: string;
}): Promise<Response> {
  const { row, chatId, utterance, notice } = args;
  const promptContext = await loadPromptContext({
    workspaceId: row.workspaceId,
    userId: row.linkedByUserId,
    personaSlug: row.personaSlug,
  });

  try {
    const result = await companionAgent.runCompanionTurn(
      {
        workspaceId: row.workspaceId,
        userId: row.linkedByUserId,
        personaSlug: row.personaSlug,
        utterance: utterance,
        history: [],
        eagerness: 50,
        surface: 'telegram',
        promptContext,
      },
      {
        onEscalate: async (input, reason) => {
          const sent = await inngest.send({
            name: 'conductor/tick',
            data: {
              workspaceId: input.workspaceId,
              reason: `companion-agent escalate (telegram): ${reason} | utterance="${input.utterance.slice(0, 200)}"`,
            },
          });
          return sent.ids[0];
        },
      },
    );

    const body =
      result.kind === 'local'
        ? result.text
        : `${result.ack}\n\n_(Working on it \u2014 I\u2019ll ping you when it\u2019s done.)_`;
    const reply = notice ? `${notice}\n\n${body}` : body;
    await bot()
      .telegram.sendMessage(chatId, reply, { parse_mode: 'Markdown' })
      .catch((err) => log.error('telegram.reply.failed', { chatId }, err));
  } catch (err) {
    log.error('telegram.companion.failed', { chatId }, err);
    await bot()
      .telegram.sendMessage(
        chatId,
        'Hmm, something went sideways on my end. Try again in a moment?',
      )
      .catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
