import cron, { type ScheduledTask } from 'node-cron';

import { env } from '../config/env';
import { CapsuleStatus } from '../generated/prisma/enums';
import { generateAccessToken } from '../lib/accessToken';
import { isEmailConfigured, sendEmail } from '../lib/email';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

const BATCH_SIZE = 50;

let task: ScheduledTask | undefined;
let running = false;

export async function sendScheduledCapsules(): Promise<void> {
  if (running) {
    logger.warn('Job de envio ainda em execucao, ignorando este ciclo');
    return;
  }

  running = true;

  try {
    const capsules = await prisma.capsule.findMany({
      where: { status: CapsuleStatus.SCHEDULED, scheduleDate: { lte: new Date() } },
      orderBy: { scheduleDate: 'asc' },
      take: BATCH_SIZE,
    });

    for (const capsule of capsules) {

      const { token, hash } = generateAccessToken();

      if (!(await claim(capsule.id, hash))) {
        logger.warn(`Capsula ${capsule.id} nao esta mais agendada, ignorando`);
        continue;
      }

      try {
        await sendEmail({
          to: capsule.recipientEmail,
          subject: capsule.titleContent,
          text: `${capsule.titleContent}\n\n${capsule.textContent}`,
          link: { label: 'Abrir capsula', url: buildOpenUrl(token) },
        });
      } catch (error) {
        logger.error(`Falha ao enviar a capsula ${capsule.id}`, error);
        await markAs(capsule.id, { status: CapsuleStatus.FAILED });
        continue;
      }

      logger.info(`Capsula ${capsule.id} enviada`);
    }
  } catch (error) {
    logger.error('Erro no job de envio de capsulas', error);
  } finally {
    running = false;
  }
}

export function buildOpenUrl(token: string): string {
  return `${env.WEB_URL}/c/${encodeURIComponent(token)}`;
}


async function claim(id: string, tokenHash: string): Promise<boolean> {
  try {
    const { count } = await prisma.capsule.updateMany({
      where: { id, status: CapsuleStatus.SCHEDULED },
      data: { status: CapsuleStatus.SENT, sentAt: new Date(), token: tokenHash },
    });
    return count === 1;
  } catch (error) {
    logger.error(`Falha ao reservar a capsula ${id} para envio`, error);
    return false;
  }
}

async function markAs(
  id: string,
  data: { status: CapsuleStatus; sentAt?: Date },
): Promise<void> {
  try {
    await prisma.capsule.update({ where: { id }, data });
  } catch (error) {
    logger.error(`Falha ao atualizar o status da capsula ${id} para ${data.status}`, error);
  }
}

export function startSendScheduledCapsulesJob(): void {
  if (!isEmailConfigured()) {
    logger.warn('RESEND_API_KEY nao configurada: job de envio de capsulas nao sera iniciado');
    return;
  }

  task = cron.schedule('* * * * *', () => void sendScheduledCapsules());
  logger.info('Job de envio de capsulas agendado (a cada minuto)');
}

export async function stopSendScheduledCapsulesJob(): Promise<void> {
  await task?.destroy();
  task = undefined;
}
