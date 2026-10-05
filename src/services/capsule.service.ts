import type { Capsule } from '../generated/prisma/client';
import { CapsuleStatus } from '../generated/prisma/enums';
import { generateAccessToken } from '../lib/accessToken';
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
  files: [];
}

/**
 * Monta a resposta campo a campo (lista branca), para que nem o hash do token
 * nem campos internos novos vazem para a API por engano.
 */
function toCapsuleResponse(capsule: Capsule): CapsuleResponse {
  return {
    id: capsule.id,
    title: capsule.titleContent,
    text: capsule.textContent,
    recipientEmail: capsule.recipientEmail,
    scheduleDate: capsule.scheduleDate,
    status: capsule.status,
    sentAt: capsule.sentAt,
    createdAt: capsule.createdAt,
    // A capsula nasce sem anexos; eles entram depois em POST /capsules/{id}/files.
    files: [],
  };
}

export const capsuleService = {
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
