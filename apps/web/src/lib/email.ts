/**
 * Email sender with provider fallback.
 *
 *   1. RESEND_API_KEY set → Resend HTTP API (prod default).
 *   2. else SMTP_URL set → nodemailer (local Mailpit / generic SMTP).
 *   3. else no-op (returns false) so callers degrade gracefully.
 *
 * From address: RESEND_FROM / EMAIL_FROM / a safe default.
 */
import 'server-only';
import { log } from './logger';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function fromAddress(): string {
  return (
    process.env.RESEND_FROM ??
    process.env.EMAIL_FROM ??
    'metu <noreply@metu.ro>'
  );
}

async function sendViaResend(input: SendEmailInput): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  return true;
}

async function sendViaSmtp(input: SendEmailInput): Promise<boolean> {
  // Dynamic import keeps nodemailer out of the bundle unless SMTP is used.
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({
    from: fromAddress(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
  return true;
}

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  try {
    if (process.env.RESEND_API_KEY) return await sendViaResend(input);
    if (process.env.SMTP_URL) return await sendViaSmtp(input);
    return false;
  } catch (err) {
    log.error('email.send.failed', { to: input.to, subject: input.subject }, err);
    return false;
  }
}

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY || process.env.SMTP_URL);
}
