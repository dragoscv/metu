/**
 * Telegram integration page — issue a one-time link code, list linked
 * chats, and unlink. The bot consumes the code via `/start <code>`
 * inside Telegram itself (handled server-side in the webhook).
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, CardTitle, Page, PageHeader, PageSection } from '@metu/ui';
import { listTelegramLinksAction } from '@/app/actions/telegram';
import { TelegramLinkPanel } from '@/components/telegram-link-panel';
import { TelegramBotPanel } from '@/components/telegram-bot-panel';
import { getTelegramBotStatusAction } from '@/app/actions/telegram-bot';

export default async function TelegramIntegrationPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const [links, botStatus] = await Promise.all([
    listTelegramLinksAction(),
    getTelegramBotStatusAction(),
  ]);

  return (
    <Page>
      <PageHeader
        title="Telegram"
        description="Connect your own private Telegram bot to talk to the METU Conductor and receive smart, proactive messages."
      />

      <PageSection title="1 · Connect your bot">
        <Card>
          <CardTitle>Your private bot</CardTitle>
          <p className="text-sm text-[var(--color-fg-subtle)]">
            Create a bot with @BotFather and paste its token. Only you will be able to use it.
          </p>
          <TelegramBotPanel initial={botStatus} />
        </Card>
      </PageSection>

      {botStatus.connected && (
        <PageSection title="2 · Bind your account">
          <Card>
            <CardTitle>One-time code</CardTitle>
            <p className="text-sm text-[var(--color-fg-subtle)]">
              Generate a six-digit code and send <code>/start &lt;code&gt;</code> to{' '}
              <strong>@{botStatus.botUsername ?? 'your_bot'}</strong> within 15 minutes. The first
              account to do this becomes the only one allowed.
            </p>
            <TelegramLinkPanel botUsername={botStatus.botUsername} />
          </Card>
        </PageSection>
      )}

      <PageSection title="Linked chats">
        {links.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-fg-subtle)]">No chats linked yet.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {links.map((l) => (
              <Card key={l.chatId}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">
                      Chat {l.chatId} {l.fromUserName ? `\u2014 ${l.fromUserName}` : ''}
                    </div>
                    <div className="text-xs text-[var(--color-fg-subtle)]">
                      Persona: <code>{l.personaSlug}</code>
                      {l.lastInboundAt
                        ? ` \u2022 last message ${new Date(l.lastInboundAt).toLocaleString()}`
                        : ' \u2022 no messages yet'}
                    </div>
                  </div>
                  <UnlinkButton chatId={l.chatId} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageSection>
    </Page>
  );
}

function UnlinkButton({ chatId }: { chatId: string }) {
  // Server-action form for a single button — keeps the page server-only.
  return (
    <form
      action={async () => {
        'use server';
        const { unlinkTelegramChatAction } = await import('@/app/actions/telegram');
        await unlinkTelegramChatAction(chatId);
      }}
    >
      <button
        type="submit"
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-xs hover:bg-[var(--color-bg-elevated)]"
      >
        Unlink
      </button>
    </form>
  );
}
