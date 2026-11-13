import { hashAccessToken } from '../lib/accessToken';

import { CapsuleType } from '../generated/prisma/enums';
import { AppError } from '../lib/AppError';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { contributionSelection, toContributionResponses } from './contribution.service';

export const publicCapsuleService = {
  async open(token: string) {
    const tokenHash = hashAccessToken(token);
    const capsule = await prisma.capsule.findFirst({
      where: { token: tokenHash, status: 'SENT' },
      select: {
        titleContent: true, textContent: true, sentAt: true,
        type: true,
        creator: { select: { name: true } },
        contributions: contributionSelection,
        files: {
          where: { contributionId: null },
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
      files: await Promise.all(capsule.files.map(async ({ objectKey, ...file }) => ({
        ...file, ...await storage.downloadUrl(objectKey).then(({ url, expiresAt }) => ({
          downloadUrl: url, downloadUrlExpiresAt: expiresAt,
        })),
      }))),
      ...(capsule.type === CapsuleType.GROUP && {
        contributions: await toContributionResponses(capsule.contributions),
      }),
    };
  },
};
