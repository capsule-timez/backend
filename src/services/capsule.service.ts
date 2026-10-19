import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { Capsule, CapsuleFile } from '../generated/prisma/client';
import { CapsuleStatus } from '../generated/prisma/enums';
import { generateAccessToken } from '../lib/accessToken';
import { AppError } from '../lib/AppError';
import { prisma } from '../lib/prisma';
import { storage } from '../lib/storage';
import { EXTENSIONS } from '../lib/upload';
import type { CreateCapsuleInput, ListCapsulesQuery } from '../schemas/capsule.schema';

export interface CapsuleResponse {
  id: string;
  title: string;
  text: string;
  recipientEmail: string;
  scheduleDate: Date;
  status: CapsuleStatus;
  sentAt: Date | null;
  createdAt: Date;
  files: Pick<CapsuleFile, 'id' | 'fileName' | 'mimeType' | 'fileSize' | 'createdAt'>[];
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

/** Multer entrega o nome em latin1; reinterpreta como UTF-8 e descarta qualquer caminho. */
function sanitizeFileName(originalName: string): string {
  const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
  return path.posix.basename(decoded.replaceAll('\\', '/')).slice(0, 255) || 'arquivo';
}

export interface CapsuleSummary {
  id: string;
  title: string;
  recipientEmail: string;
  scheduleDate: Date;
  status: CapsuleStatus;
  sentAt: Date | null;
  createdAt: Date;
  fileCount: number;
}

export interface CapsuleListResponse {
  data: CapsuleSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/**
 * Monta a resposta campo a campo (lista branca), para que nem o hash do token
 * nem campos internos novos vazem para a API por engano.
 */
function toCapsuleResponse(capsule: Omit<Capsule, 'token' | 'creatorId'>, files: CapsuleResponse['files'] = []): CapsuleResponse {
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
  async list(userId: string, query: ListCapsulesQuery): Promise<CapsuleListResponse> {
    const { status, page, pageSize } = query;
    // O filtro por creatorId vem sempre do token, nunca da query string.
    const where = { creatorId: userId, ...(status ? { status } : {}) };

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
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  async detail(userId: string, id: string): Promise<CapsuleResponse> {
    const capsule = await prisma.capsule.findFirst({
      where: { id, creatorId: userId },
      select: {
        id: true,
        titleContent: true,
        textContent: true,
        recipientEmail: true,
        scheduleDate: true,
        status: true,
        sentAt: true,
        createdAt: true,
        files: {
          select: { id: true, fileName: true, mimeType: true, fileSize: true, createdAt: true },
        },
      },
    });
    if (!capsule) throw AppError.notFound('Capsula nao encontrada.');
    return toCapsuleResponse(capsule, capsule.files);
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

  async create(userId: string, input: CreateCapsuleInput): Promise<CapsuleResponse> {
    // So o hash e persistido. O texto puro e descartado aqui: o e-mail sai
    // apenas na data de entrega, entao o job de envio deve gerar um token novo
    // com generateAccessToken(), gravar o hash dele e usar o texto puro so no
    // corpo do e-mail.
    const { hash } = generateAccessToken();

    const capsule = await prisma.capsule.create({
      data: {
        creatorId: userId,
        titleContent: input.title,
        textContent: input.text,
        recipientEmail: input.recipientEmail,
        scheduleDate: input.scheduleDate,
        status: CapsuleStatus.SCHEDULED,
        token: hash,
      },
    });

    return toCapsuleResponse(capsule);
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
