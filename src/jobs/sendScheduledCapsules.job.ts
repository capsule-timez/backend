import cron, { type ScheduledTask } from 'node-cron';

import { CapsuleStatus } from '../generated/prisma/enums';
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
      try {
        await sendEmail({
          to: capsule.recipientEmail,
          subject: capsule.titleContent,
          text: `${capsule.titleContent}\n\n${capsule.textContent}`,
        });
      } catch (error) {
        logger.error(`Falha ao enviar a capsula ${capsule.id}`, error);
        await markAs(capsule.id, { status: CapsuleStatus.FAILED });
        continue;
      }

      logger.info(`Capsula ${capsule.id} enviada`);
      await markAs(capsule.id, { status: CapsuleStatus.SENT, sentAt: new Date() });
    }
  } catch (error) {
    logger.error('Erro no job de envio de capsulas', error);
  } finally {
    running = false;
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
