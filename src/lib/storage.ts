import { Client } from 'minio';

import { env } from '../config/env';
import { AppError } from './AppError';
import { logger } from './logger';

/** Validade das URLs pre-assinadas de download, em segundos. */
export const DOWNLOAD_URL_TTL_SECONDS = env.MINIO_PRESIGNED_URL_TTL_SECONDS;

let client: Client | undefined;
let bucketReady: Promise<void> | undefined;

function getClient(): Client {
  if (client) return client;
  if (!env.MINIO_ROOT_USER || !env.MINIO_ROOT_PASSWORD) {
    logger.error('MINIO_ROOT_USER e MINIO_ROOT_PASSWORD nao configurados');
    throw new AppError('Armazenamento de arquivos indisponivel', 500);
  }
  client = new Client({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_API_PORT ?? 9000,
    useSSL: env.MINIO_USE_SSL,
    region: env.MINIO_REGION,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
  });
  return client;
}

/** Cria o bucket se nao existir. A promise e reaproveitada, e descartada em caso de falha. */
export function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    const minio = getClient();
    if (!(await minio.bucketExists(env.MINIO_BUCKET))) {
      await minio.makeBucket(env.MINIO_BUCKET);
      logger.info(`Bucket "${env.MINIO_BUCKET}" criado no MinIO`);
    }
  })().catch((error: unknown) => {
    bucketReady = undefined;
    throw error;
  });
  return bucketReady;
}

export const storage = {
  async putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    await ensureBucket();
    await getClient().putObject(env.MINIO_BUCKET, objectKey, body, body.length, {
      'Content-Type': contentType,
    });
  },

  async removeObject(objectKey: string): Promise<void> {
    await getClient().removeObject(env.MINIO_BUCKET, objectKey);
  },

  async downloadUrl(objectKey: string): Promise<{ url: string; expiresAt: Date }> {
    const issuedAt = new Date();
    const url = await getClient().presignedGetObject(
      env.MINIO_BUCKET,
      objectKey,
      DOWNLOAD_URL_TTL_SECONDS,
      {},
      issuedAt,
    );
    return { url, expiresAt: new Date(Math.floor(issuedAt.getTime() / 1000) * 1000 + DOWNLOAD_URL_TTL_SECONDS * 1000) };
  },
};
