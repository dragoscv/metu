/**
 * Discord integration page — connect your own private Discord bot to chat
 * with the METU Conductor and receive proactive messages via DM.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, CardTitle, Page, PageHeader, PageSection } from '@metu/ui';
import { DiscordBotPanel } from '@/components/discord-bot-panel';
import { getDiscordBotStatusAction } from '@/app/actions/discord-bot';
import { TelegramLinkPanel } from '@/components/telegram-link-panel';

export default async function DiscordIntegrationPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const status = await getDiscordBotStatusAction();
  const webhookBase = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metu.ro'}/api/webhooks/discord`;

  return (
    <Page>
      <PageHeader
        title="Discord"
        description="Connect your own private Discord bot to talk to the METU Conductor and receive smart, proactive messages by DM."
      />

      <PageSection title="1 · Connect your bot">
        <Card>
          <CardTitle>Your private bot</CardTitle>
          <p className="text-sm text-[var(--color-fg-subtle)]">
            Create a Discord application + bot and paste its credentials. Only you
            will be able to use it.
          </p>
          <DiscordBotPanel initial={status} webhookBase={webhookBase} />
        </Card>
      </PageSection>

      {status.connected && (
        <PageSection title="2 · Bind your account">
          <Card>
            <CardTitle>One-time code</CardTitle>
            <p className="text-sm text-[var(--color-fg-subtle)]">
              Generate a six-digit code and run <code>/link &lt;code&gt;</code> in
              Discord within 15 minutes. The first account to do this becomes the
              only one allowed.
            </p>
            <TelegramLinkPanel botUsername={status.botUsername} />
          </Card>
        </PageSection>
      )}
    </Page>
  );
}
