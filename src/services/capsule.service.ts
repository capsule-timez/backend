import type { Capsule, CapsuleFile } from '../generated/prisma/client';
import { CapsuleStatus } from '../generated/prisma/enums';
import { generateAccessToken } from '../lib/accessToken';
import { AppError } from '../lib/AppError';
import { prisma } from '../lib/prisma';
import type { CreateCapsuleInput } from '../schemas/capsule.schema';

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
};
