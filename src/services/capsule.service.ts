import { randomBytes, randomUUID } from 'node:crypto';

import type { Capsule, CapsuleFile, Prisma } from '../generated/prisma/client';
import { CapsuleMemberRole, CapsuleStatus, CapsuleType } from '../generated/prisma/enums';
import { generateAccessToken } from '../lib/accessToken';
import { AppError } from '../lib/AppError';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { EXTENSIONS, sanitizeFileName } from '../lib/upload';
import type { CreateCapsuleInput, ListCapsulesQuery, UpdateCapsuleInput } from '../schemas/capsule.schema';

export interface CapsuleResponse {
  id: string;
  title: string;
  text: string;
  recipientEmail: string;
  scheduleDate: Date;
  status: CapsuleStatus;
  sentAt: Date | null;
  createdAt: Date;
  files: CapsuleFileResponse[];
  participants?: CapsuleParticipant[];
  inviteCode?: string;
}

interface CapsuleParticipant {
  name: string;
  role: CapsuleMemberRole;
}

const participantSelection = {
  select: { userId: true, role: true, user: { select: { name: true } } },
  orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
} satisfies Prisma.CapsuleMemberFindManyArgs;

function participants(members: { role: CapsuleMemberRole; user: { name: string } }[]): CapsuleParticipant[] {
  return members.map(({ role, user }) => ({ name: user.name, role }));
}

function accessibleCapsules(userId: string) {
  return { OR: [{ creatorId: userId }, { members: { some: { userId } } }] };
}

export interface CapsuleFileResponse {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
  downloadUrl: string;
  downloadUrlExpiresAt: Date;
}

export const MAX_FILES_PER_CAPSULE = 5;

export interface CapsuleSummary {
  id: string;
  title: string;
  recipientEmail: string;
  scheduleDate: Date;
  status: CapsuleStatus;
  sentAt: Date | null;
  createdAt: Date;
  fileCount: number;
  participants?: CapsuleParticipant[];
}

export interface CapsuleListResponse {
  data: CapsuleSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/**
 * Monta a resposta campo a campo (lista branca), para que nem o hash do token
 * nem campos internos novos vazem para a API por engano.
 */
function toCapsuleResponse(
  capsule: Omit<Capsule, 'token' | 'creatorId' | 'type' | 'contributionDeadline' | 'inviteCode'>,
  files: CapsuleResponse['files'] = [],
): CapsuleResponse {
  return {
    id: capsule.id,
    title: capsule.titleContent,
    text: capsule.textContent,
    recipientEmail: capsule.recipientEmail,
    scheduleDate: capsule.scheduleDate,
    status: capsule.status,
    sentAt: capsule.sentAt,
    createdAt: capsule.createdAt,
    files,
  };
}

export const capsuleService = {
  async join(userId: string, inviteCode: string): Promise<CapsuleResponse> {
    const capsule = await prisma.capsule.findUnique({
      where: { inviteCode, type: CapsuleType.GROUP },
      select: { id: true, contributionDeadline: true },
    });
    if (!capsule) throw AppError.notFound('Código de convite não encontrado.');
    if (!capsule.contributionDeadline || capsule.contributionDeadline.getTime() <= Date.now()) {
      throw new AppError(
        'O prazo de contribuição desta cápsula já passou.',
        409,
        undefined,
        'CONTRIBUTION_DEADLINE_PASSED',
      );
    }
    await prisma.capsuleMember.createMany({
      data: { capsuleId: capsule.id, userId, role: CapsuleMemberRole.MEMBER },
      skipDuplicates: true,
    });
    return capsuleService.detail(userId, capsule.id);
  },

  async update(id: string, creatorId: string, input: UpdateCapsuleInput) {
    // Ownership and status are checked by the write itself to avoid a status race.
    const [capsule] = await prisma.capsule.updateManyAndReturn({
      where: { id, creatorId, status: 'SCHEDULED' },
      data: {
        ...(input.title !== undefined && { titleContent: input.title }),
        ...(input.text !== undefined && { textContent: input.text }),
        ...(input.recipientEmail !== undefined && { recipientEmail: input.recipientEmail }),
        ...(input.scheduleDate !== undefined && { scheduleDate: input.scheduleDate }),
      },
      select: {
        id: true, titleContent: true, textContent: true, recipientEmail: true,
        scheduleDate: true, status: true, sentAt: true, createdAt: true,
        files: {
          select: { id: true, fileName: true, mimeType: true, fileSize: true,
            createdAt: true, objectKey: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!capsule) {
      const existing = await prisma.capsule.findFirst({
        where: { id, creatorId }, select: { status: true },
      });
      if (!existing) throw new AppError('Cápsula não encontrada.', 404, undefined, 'NOT_FOUND');
      throw new AppError(
        'A cápsula não pode ser editada: já foi enviada ou está com falha.',
        409, undefined, 'CAPSULE_NOT_EDITABLE',
      );
    }
    const { titleContent, textContent, files, ...rest } = capsule;
    return {
      ...rest, title: titleContent, text: textContent,
      files: await Promise.all(files.map(async ({ objectKey, ...file }) => ({
        ...file, ...await storage.downloadUrl(objectKey).then(({ url, expiresAt }) => ({
          downloadUrl: url, downloadUrlExpiresAt: expiresAt,
        })),
      }))),
    };
  },

  async list(userId: string, query: ListCapsulesQuery): Promise<CapsuleListResponse> {
    const { status, page, pageSize } = query;
    const where = { ...accessibleCapsules(userId), ...(status ? { status } : {}) };

    const [total, capsules] = await prisma.$transaction([
      prisma.capsule.count({ where }),
      prisma.capsule.findMany({
        where,
        // id desempata datas iguais para a paginacao ser estavel.
        orderBy: [{ scheduleDate: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          titleContent: true,
          recipientEmail: true,
          scheduleDate: true,
          status: true,
          sentAt: true,
          createdAt: true,
          type: true,
          members: participantSelection,
          _count: { select: { files: true } },
        },
      }),
    ]);

    return {
      data: capsules.map((capsule) => ({
        id: capsule.id,
        title: capsule.titleContent,
        recipientEmail: capsule.recipientEmail,
        scheduleDate: capsule.scheduleDate,
        status: capsule.status,
        sentAt: capsule.sentAt,
        createdAt: capsule.createdAt,
        fileCount: capsule._count.files,
        ...(capsule.type === CapsuleType.GROUP && { participants: participants(capsule.members) }),
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  async detail(userId: string, id: string): Promise<CapsuleResponse> {
    const capsule = await prisma.capsule.findFirst({
      where: { id, ...accessibleCapsules(userId) },
      select: {
        id: true,
        titleContent: true,
        textContent: true,
        recipientEmail: true,
        scheduleDate: true,
        status: true,
        sentAt: true,
        createdAt: true,
        type: true,
        inviteCode: true,
        members: participantSelection,
        files: {
          select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true, objectKey: true },
        },
      },
    });
    if (!capsule) throw AppError.notFound('Capsula nao encontrada.');
    // objectKey fica so no servidor; o cliente recebe uma URL assinada temporaria.
    const files = await Promise.all(
      capsule.files.map(async ({ objectKey, ...file }) => {
        const { url, expiresAt } = await storage.downloadUrl(objectKey);
        return { ...file, downloadUrl: url, downloadUrlExpiresAt: expiresAt };
      }),
    );
    const group = capsule.type === CapsuleType.GROUP;
    const owner = group && capsule.members.some(
      (member) => member.userId === userId && member.role === CapsuleMemberRole.OWNER,
    );
    return {
      ...toCapsuleResponse(capsule, files),
      ...(group && { participants: participants(capsule.members) }),
      ...(owner && capsule.inviteCode && { inviteCode: capsule.inviteCode }),
    };
  },

  async addFile(userId: string, id: string, file: Express.Multer.File): Promise<CapsuleFileResponse> {
    const capsule = await prisma.capsule.findFirst({
      where: { id, creatorId: userId },
      select: { status: true, _count: { select: { files: true } } },
    });
    if (!capsule) throw AppError.notFound('Capsula nao encontrada.');
    if (capsule.status !== CapsuleStatus.SCHEDULED) {
      throw new AppError(
        'Apenas capsulas agendadas aceitam anexos.',
        409,
        undefined,
        'CAPSULE_NOT_EDITABLE',
      );
    }
    if (capsule._count.files >= MAX_FILES_PER_CAPSULE) {
      throw new AppError(
        `A capsula ja possui o limite de ${MAX_FILES_PER_CAPSULE} arquivos`,
        409,
        undefined,
        'FILE_LIMIT_REACHED',
      );
    }

    const objectKey = `capsules/${id}/${randomUUID()}${EXTENSIONS[file.mimetype] ?? ''}`;
    await storage.putObject(objectKey, file.buffer, file.mimetype);

    let record: CapsuleFile;
    try {
      record = await prisma.capsuleFile.create({
        data: {
          capsuleId: id,
          mimeType: file.mimetype,
          fileName: sanitizeFileName(file.originalname),
          fileSize: file.size,
          objectKey,
        },
      });
    } catch (error) {
      // Nao deixa objeto orfao no bucket se o registro nao foi gravado.
      await storage.removeObject(objectKey).catch(() => undefined);
      throw error;
    }

    const { url, expiresAt } = await storage.downloadUrl(objectKey);
    return {
      id: record.id,
      fileName: record.fileName,
      mimeType: record.mimeType,
      fileSize: record.fileSize,
      createdAt: record.createdAt,
      downloadUrl: url,
      downloadUrlExpiresAt: expiresAt,
    };
  },

  async create(userId: string, input: CreateCapsuleInput) {
    // So o hash e persistido. O texto puro e descartado aqui: o e-mail sai
    // apenas na data de entrega, entao o job de envio deve gerar um token novo
    // com generateAccessToken(), gravar o hash dele e usar o texto puro so no
    // corpo do e-mail.
    const { hash } = generateAccessToken();
    const group = input.type === CapsuleType.GROUP;

    const capsule = await prisma.capsule.create({
      data: {
        creatorId: userId,
        titleContent: input.title,
        textContent: input.text,
        recipientEmail: input.recipientEmail,
        scheduleDate: input.scheduleDate,
        status: CapsuleStatus.SCHEDULED,
        token: hash,
        type: input.type,
        ...(group && {
          contributionDeadline: input.contributionDeadline,
          inviteCode: randomBytes(16).toString('hex'),
          members: { create: { userId, role: CapsuleMemberRole.OWNER } },
        }),
      },
    });

    return {
      ...toCapsuleResponse(capsule),
      type: capsule.type,
      ...(group && {
        contributionDeadline: capsule.contributionDeadline,
        inviteCode: capsule.inviteCode,
      }),
    };
  },

  async remove(userId: string, id: string): Promise<void> {
    // Delete condicional e atomico: evita excluir uma capsula que o job de envio
    // marcou como SENT entre a checagem e a exclusao. Os CapsuleFile saem junto
    // por onDelete: Cascade.
    const { count } = await prisma.capsule.deleteMany({
      where: { id, creatorId: userId, status: CapsuleStatus.SCHEDULED },
    });
    if (count > 0) return;

    // Nada removido: distingue inexistente/de outro usuario (404) de ja enviada (409).
    const exists = await prisma.capsule.findFirst({
      where: { id, creatorId: userId },
      select: { id: true },
    });
    if (!exists) throw AppError.notFound('Capsula nao encontrada.');
    throw new AppError(
      'Apenas capsulas agendadas podem ser excluidas. Esta capsula ja foi processada.',
      409,
      undefined,
      'CAPSULE_NOT_EDITABLE',
    );
  },
};
