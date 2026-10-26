import { hashAccessToken } from '../lib/accessToken';

import { AppError } from '../lib/AppError';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';

export const publicCapsuleService = {
  async open(token: string) {
    const tokenHash = hashAccessToken(token);
    const capsule = await prisma.capsule.findFirst({
      where: { token: tokenHash, status: 'SENT' },
      select: {
        titleContent: true, textContent: true, sentAt: true,
        creator: { select: { name: true } },
        files: {
          select: {
            id: true, fileName: true, mimeType: true, fileSize: true,
            createdAt: true, objectKey: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!capsule) throw AppError.notFound('Cápsula não encontrada.');

    return {
      title: capsule.titleContent,
      text: capsule.textContent,
      creatorName: capsule.creator.name,
      sentAt: capsule.sentAt,
      files: await Promise.all(capsule.files.map(async ({ objectKey, ...file }) => {
        const { url, expiresAt } = await storage.downloadUrl(objectKey);
        return { ...file, downloadUrl: url, downloadUrlExpiresAt: expiresAt };
      })),
    };
  },
};
