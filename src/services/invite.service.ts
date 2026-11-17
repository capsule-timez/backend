import { env } from '../config/env';
import { CapsuleInviteStatus, CapsuleMemberRole, CapsuleStatus, CapsuleType } from '../generated/prisma/enums';
import { generateAccessToken, hashAccessToken } from '../lib/accessToken';
import { AppError } from '../lib/AppError';
import { isEmailConfigured, sendEmail } from '../lib/email';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import type { CreateInvitesInput } from '../schemas/capsule.schema';
import { type CapsuleResponse, capsuleService } from './capsule.service';

/** Resultado do convite para cada e-mail enviado na requisicao. */
export type InviteDelivery = 'SENT' | 'EMAIL_FAILED' | 'ALREADY_MEMBER';

export interface InviteResult {
  email: string;
  result: InviteDelivery;
}

export interface InviteResponse {
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED';
  sentAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
}

export function buildInviteUrl(token: string): string {
  return `${env.WEB_URL}/convite/${encodeURIComponent(token)}`;
}

function deadlinePassed(): AppError {
  return new AppError(
    'O prazo de contribuição desta cápsula já passou.',
    409,
    undefined,
    'CONTRIBUTION_DEADLINE_PASSED',
  );
}

function isOpen(capsule: { status: CapsuleStatus; contributionDeadline: Date | null }): capsule is {
  status: CapsuleStatus;
  contributionDeadline: Date;
} {
  return (
    capsule.status === CapsuleStatus.SCHEDULED &&
    capsule.contributionDeadline !== null &&
    capsule.contributionDeadline.getTime() > Date.now()
  );
}

function formatDeadline(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * Carrega a capsula em grupo do ponto de vista do usuario. Quem nao participa
 * recebe 404 (sem revelar que a capsula existe) e MEMBER recebe 403.
 */
async function findOwnedGroupCapsule(userId: string, capsuleId: string) {
  const capsule = await prisma.capsule.findFirst({
    where: { id: capsuleId, type: CapsuleType.GROUP, members: { some: { userId } } },
    select: {
      titleContent: true,
      status: true,
      contributionDeadline: true,
      members: { where: { userId }, select: { role: true, user: { select: { name: true } } } },
    },
  });
  if (!capsule) throw AppError.notFound('Capsula nao encontrada.');
  const [membership] = capsule.members;
  if (!membership || membership.role !== CapsuleMemberRole.OWNER) {
    throw AppError.forbidden('Apenas o criador da cápsula pode gerenciar convites.');
  }
  return { ...capsule, inviterName: membership.user.name };
}

export const inviteService = {
  async create(userId: string, capsuleId: string, input: CreateInvitesInput): Promise<InviteResult[]> {
    const capsule = await findOwnedGroupCapsule(userId, capsuleId);
    if (!isOpen(capsule)) throw deadlinePassed();
    const deadline = capsule.contributionDeadline;

    // Quem ja participa (pelo e-mail da conta) nao recebe convite.
    const members = await prisma.capsuleMember.findMany({
      where: { capsuleId, user: { email: { in: input.emails, mode: 'insensitive' } } },
      select: { user: { select: { email: true } } },
    });
    const memberEmails = new Set(members.map(({ user }) => user.email.toLowerCase()));

    return Promise.all(
      input.emails.map(async (email): Promise<InviteResult> => {
        if (memberEmails.has(email)) return { email, result: 'ALREADY_MEMBER' };

        // So o hash e gravado; o texto puro vai apenas no link do e-mail.
        const { token, hash } = generateAccessToken();
        const sentAt = new Date();
        await prisma.capsuleInvite.upsert({
          where: { capsuleId_email: { capsuleId, email } },
          create: { capsuleId, email, tokenHash: hash, expiresAt: deadline, invitedById: userId, sentAt },
          update: {
            tokenHash: hash,
            status: CapsuleInviteStatus.PENDING,
            expiresAt: deadline,
            invitedById: userId,
            acceptedById: null,
            acceptedAt: null,
            sentAt,
          },
        });

        if (!isEmailConfigured()) {
          logger.warn(`RESEND_API_KEY nao configurada: convite da capsula ${capsuleId} nao foi enviado`);
          return { email, result: 'EMAIL_FAILED' };
        }
        try {
          await sendEmail({
            to: email,
            subject: `Convite para a cápsula "${capsule.titleContent}"`,
            text:
              `${capsule.inviterName} convidou você para contribuir com a cápsula do tempo ` +
              `"${capsule.titleContent}".\n\n` +
              `Você pode enviar textos e imagens até ${formatDeadline(deadline)} (horário de Brasília).`,
            link: { label: 'Aceitar convite', url: buildInviteUrl(token) },
          });
          return { email, result: 'SENT' };
        } catch (error) {
          logger.error(`Falha ao enviar convite da capsula ${capsuleId}`, error);
          return { email, result: 'EMAIL_FAILED' };
        }
      }),
    );
  },

  async list(userId: string, capsuleId: string): Promise<InviteResponse[]> {
    await findOwnedGroupCapsule(userId, capsuleId);
    const invites = await prisma.capsuleInvite.findMany({
      where: { capsuleId },
      orderBy: [{ sentAt: 'desc' }, { email: 'asc' }],
      select: { email: true, status: true, sentAt: true, expiresAt: true, acceptedAt: true },
    });
    const now = Date.now();
    return invites.map((invite) => ({
      ...invite,
      status:
        invite.status === CapsuleInviteStatus.PENDING && invite.expiresAt.getTime() <= now
          ? 'EXPIRED'
          : invite.status,
    }));
  },

  async accept(userId: string, token: string): Promise<CapsuleResponse> {
    const notFound = () => AppError.notFound('Convite não encontrado.');
    const invite = await prisma.capsuleInvite.findUnique({
      where: { tokenHash: hashAccessToken(token) },
      select: {
        id: true,
        capsuleId: true,
        status: true,
        expiresAt: true,
        capsule: { select: { status: true, contributionDeadline: true } },
      },
    });
    if (!invite || invite.status !== CapsuleInviteStatus.PENDING || invite.expiresAt.getTime() <= Date.now()) {
      throw notFound();
    }
    if (!isOpen(invite.capsule)) throw deadlinePassed();

    await prisma.$transaction(async (tx) => {
      // Condicional em PENDING: dois aceites simultaneos nao usam o mesmo convite.
      const { count } = await tx.capsuleInvite.updateMany({
        where: { id: invite.id, status: CapsuleInviteStatus.PENDING },
        data: { status: CapsuleInviteStatus.ACCEPTED, acceptedById: userId, acceptedAt: new Date() },
      });
      if (count === 0) throw notFound();
      await tx.capsuleMember.createMany({
        data: { capsuleId: invite.capsuleId, userId, role: CapsuleMemberRole.MEMBER },
        skipDuplicates: true,
      });
    });

    return capsuleService.detail(userId, invite.capsuleId);
  },
};
