import { Resend } from 'resend';

import { env } from '../config/env';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

let client: Resend | undefined;

function getClient(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY nao configurada');
  }
  client ??= new Resend(env.RESEND_API_KEY);
  return client;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<void> {
  const { error } = await getClient().emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject,
    text,
    html: `<div style="white-space: pre-wrap">${escapeHtml(text)}</div>`,
  });

  if (error) {
    throw new Error(`Resend: ${error.name} - ${error.message}`);
  }
}