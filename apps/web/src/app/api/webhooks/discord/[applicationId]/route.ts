/**
 * Discord interactions webhook (BYO per-workspace bot).
 *
 * Discord posts every slash command / button to this URL. We:
 *   1. Verify the Ed25519 signature with the app's public key.
 *   2. Reply to PING (type 1) with PONG.
 *   3. For commands (type 2): DEFER (type 5) immediately, then process the
 *      Conductor turn in the background and edit the original response.
 *   4. For components (type 3): apply approve/reject and UPDATE the message.
 *
 * The raw body is required for signature verification, so we read text().
 */
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { log } from '@metu/logger';
import { verifyInteractionSignature } from '@metu/integrations/discord/api';
import {
  getDiscordBotByApplicationId,
} from '@/lib/discord-bot';
import {
  processDiscordCommand,
  processDiscordComponent,
  type DiscordInteraction,
} from '@/lib/discord-commands';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ applicationId: string }> },
): Promise<NextResponse> {
  const { applicationId } = await params;
  const bot = await getDiscordBotByApplicationId(applicationId);
  if (!bot) return NextResponse.json({ error: 'unknown app' }, { status: 401 });

  const signature = req.headers.get('x-signature-ed25519') ?? '';
  const timestamp = req.headers.get('x-signature-timestamp') ?? '';
  const raw = await req.text();

  if (!verifyInteractionSignature(bot.publicKey, signature, timestamp, raw)) {
    return new NextResponse('invalid request signature', { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(raw) as DiscordInteraction;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  // 1) PING → PONG
  if (interaction.type === 1) {
    return NextResponse.json({ type: 1 });
  }

  // 3) Component (button) → apply and UPDATE_MESSAGE (type 7)
  if (interaction.type === 3) {
    let message = 'Done.';
    try {
      message = await processDiscordComponent(bot, interaction);
    } catch (err) {
      log.error('discord.component.failed', { applicationId }, err);
    }
    return NextResponse.json({
      type: 7, // UPDATE_MESSAGE
      data: { content: message, components: [] },
    });
  }

  // 2) Slash command → DEFER (type 5), process in background, edit original.
  if (interaction.type === 2) {
    after(async () => {
      try {
        await processDiscordCommand(bot, interaction);
      } catch (err) {
        log.error('discord.command.failed', { applicationId }, err);
      }
    });
    return NextResponse.json({ type: 5 }); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  }

  return NextResponse.json({ type: 4, data: { content: 'Unsupported interaction.' } });
}
