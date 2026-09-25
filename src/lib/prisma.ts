import { PrismaPg } from '@prisma/adapter-pg';

import { env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { logger } from './logger';

/**
 * Instancia unica do Prisma Client. O cache de modulos do Node garante que todo
 * o codigo compartilhe o mesmo client (e o mesmo pool de conexoes).
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

/**
 * Valida a conexao com o banco executando uma consulta simples. Lanca o erro
 * original do driver se o banco estiver inacessivel.
 */
export async function connectDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Conexao com o banco de dados estabelecida');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Conexao com o banco de dados encerrada');
}
