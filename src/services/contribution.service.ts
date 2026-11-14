import { randomUUID } from 'node:crypto';

import type { Prisma } from '../generated/prisma/client';
import { CapsuleStatus, CapsuleType } from '../generated/prisma/enums';
import { AppError } from '../lib/AppError';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { EXTENSIONS, sanitizeFileName } from '../lib/upload';
import type { CreateContributionInput } from '../schemas/capsule.schema';
import type { CapsuleFileResponse } from './capsule.service';

export interface ContributionResponse {
  id: string;
  author: { name: string };
  text: string | null;
  createdAt: Date;
  files: CapsuleFileResponse[];
}

/** Select reaproveitado pelo detalhe da capsula e pela abertura publica. */
export const contributionSelection = {
  select: {
    id: true,
    text: true,
    createdAt: true,
    author: { select: { name: true } },
    files: {
      select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true, objectKey: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
  },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
} satisfies Prisma.CapsuleContributionFindManyArgs;

type SelectedContribution = Prisma.CapsuleContributionGetPayload<typeof contributionSelection>;

/** Troca o objectKey (so do servidor) por uma URL assinada temporaria. */
export function toContributionResponses(
  contributions: SelectedContribution[],
): Promise<ContributionResponse[]> {
  return Promise.all(
    contributions.map(async ({ files, ...contribution }) => ({
      ...contribution,
      files: await Promise.all(
        files.map(async ({ objectKey, ...file }) => {
          const { url, expiresAt } = await storage.downloadUrl(objectKey);
          return { ...file, downloadUrl: url, downloadUrlExpiresAt: expiresAt };
        }),
      ),
    })),
  );
}

export const contributionService = {
  async create(
    userId: string,
    capsuleId: string,
    input: CreateContributionInput,
    images: Express.Multer.File[],
  ): Promise<ContributionResponse> {
    // Quem nao participa (ou capsula individual) recebe 404, sem revelar que a capsula existe.
    const capsule = await prisma.capsule.findFirst({
      where: { id: capsuleId, type: CapsuleType.GROUP, members: { some: { userId } } },
      select: { status: true, contributionDeadline: true },
    });
    if (!capsule) throw AppError.notFound('Capsula nao encontrada.');
    if (
      capsule.status !== CapsuleStatus.SCHEDULED ||
      !capsule.contributionDeadline ||
      capsule.contributionDeadline.getTime() <= Date.now()
    ) {
      throw new AppError(
        'O prazo de contribuição desta cápsula já passou.',
        409,
        undefined,
        'CONTRIBUTION_DEADLINE_PASSED',
      );
    }

    const contributionId = randomUUID();
    const uploads = images.map((image) => ({
      buffer: image.buffer,
      record: {
        capsuleId,
        mimeType: image.mimetype,
        fileName: sanitizeFileName(image.originalname),
        fileSize: image.size,
        objectKey: `capsules/${capsuleId}/contributions/${contributionId}/${randomUUID()}${EXTENSIONS[image.mimetype] ?? ''}`,
      },
    }));
    const files = uploads.map(({ record }) => record);

    const uploaded: string[] = [];
    // Nao deixa objeto orfao no bucket se algum upload ou o registro falhar.
    const cleanup = () =>
      Promise.all(uploaded.map((key) => storage.removeObject(key).catch(() => undefined)));

    let contribution: SelectedContribution;
    try {
      for (const { buffer, record } of uploads) {
        await storage.putObject(record.objectKey, buffer, record.mimeType);
        uploaded.push(record.objectKey);
      }
      contribution = await prisma.capsuleContribution.create({
        data: {
          id: contributionId,
          capsuleId,
          authorId: userId,
          text: input.text ?? null,
          files: { create: files },
        },
        select: contributionSelection.select,
      });
    } catch (error) {
      await cleanup();
      throw error;
    }

    const [response] = await toContributionResponses([contribution]);
    if (!response) throw new Error('Contribuicao criada sem resposta');
    return response;
  },
};
