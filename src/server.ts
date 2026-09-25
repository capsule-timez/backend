import { app } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';

const server = app.listen(env.PORT, () => {
  logger.info(`Servidor iniciado em http://localhost:${env.PORT} (${env.NODE_ENV})`);
  logger.info(`Health check: http://localhost:${env.PORT}/health`);
});

function shutdown(signal: string): void {
  logger.info(`${signal} recebido, encerrando servidor...`);

  server.close((error) => {
    if (error) {
      logger.error('Falha ao encerrar o servidor', error);
      process.exit(1);
    }

    logger.info('Servidor encerrado.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
