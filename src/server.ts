import type { Server } from 'node:http';

import { app } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import {
  startSendScheduledCapsulesJob,
  stopSendScheduledCapsulesJob,
} from './jobs/sendScheduledCapsules.job';
import { connectDatabase, disconnectDatabase } from './lib/prisma';
import { ensureBucket } from './lib/storage';

let server: Server | undefined;

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
  } catch (error) {
    logger.error('Falha ao conectar ao banco de dados', error);
    process.exit(1);
  }

  try {
    await ensureBucket();
  } catch (error) {
    // Nao derruba a API: o upload tenta de novo (e cria o bucket) na proxima requisicao.
    logger.warn('MinIO indisponivel; o bucket sera verificado no primeiro upload', error);
  }

  server = app.listen(env.PORT, () => {
    logger.info(`Servidor iniciado em http://localhost:${env.PORT} (${env.NODE_ENV})`);
    logger.info(`Health check: http://localhost:${env.PORT}/health`);
  });

  startSendScheduledCapsulesJob();
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} recebido, encerrando servidor...`);

  let exitCode = 0;

  await stopSendScheduledCapsulesJob();

  if (server) {
    const httpServer = server;

    await new Promise<void>((resolve) => {
      httpServer.close((error) => {
        if (error) {
          logger.error('Falha ao encerrar o servidor', error);
          exitCode = 1;
        } else {
          logger.info('Servidor encerrado.');
        }
        resolve();
      });
    });
  }

  try {
    await disconnectDatabase();
  } catch (error) {
    logger.error('Falha ao encerrar a conexao com o banco de dados', error);
    exitCode = 1;
  }

  process.exit(exitCode);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

void bootstrap();
