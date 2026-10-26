import { Resend } from 'resend';

import { env } from '../config/env';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  link?: { label: string; url: string };
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

export function buildEmailBody({ text, link }: Pick<SendEmailInput, 'text' | 'link'>): {
  text: string;
  html: string;
} {
  let html = `<div style="white-space: pre-wrap">${escapeHtml(text)}</div>`;

  if (!link) return { text, html };

  const url = escapeHtml(link.url);
  html +=
    `<p style="margin-top: 24px"><a href="${url}" style="display: inline-block; padding: 12px 20px; ` +
    `background: #4f46e5; color: #ffffff; border-radius: 8px; text-decoration: none">` +
    `${escapeHtml(link.label)}</a></p>` +
    `<p style="color: #6b7280; font-size: 12px">Se o botao nao funcionar, copie este endereco: ${url}</p>`;

  return { text: `${text}\n\n${link.label}: ${link.url}`, html };
}

export async function sendEmail({ to, subject, text, link }: SendEmailInput): Promise<void> {
  const body = buildEmailBody({ text, link });
  const { error } = await getClient().emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject,
    ...body,
  });

  if (error) {
    throw new Error(`Resend: ${error.name} - ${error.message}`);
  }
}