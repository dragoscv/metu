/** Google APIs — Gmail + Calendar read-only ingestion. */
import { google } from 'googleapis';

export function authedClient(accessToken: string, refreshToken?: string | null) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken ?? undefined,
  });
  return oauth2;
}

export async function listRecentEmails(accessToken: string, refreshToken?: string | null) {
  const auth = authedClient(accessToken, refreshToken);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 25,
    q: 'is:unread newer_than:7d',
  });
  return data.messages ?? [];
}

export async function getEmail(
  accessToken: string,
  messageId: string,
  refreshToken?: string | null,
) {
  const auth = authedClient(accessToken, refreshToken);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return data;
}

export async function listUpcomingEvents(accessToken: string, refreshToken?: string | null) {
  const auth = authedClient(accessToken, refreshToken);
  const cal = google.calendar({ version: 'v3', auth });
  const { data } = await cal.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults: 25,
    singleEvents: true,
    orderBy: 'startTime',
  });
  return data.items ?? [];
}
