import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/AppError';
import { parseOrThrow } from '../lib/validate';
import { createInvitesSchema } from '../schemas/capsule.schema';
import { inviteService } from '../services/invite.service';

function capsuleId(req: Request): string {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success) throw AppError.notFound('Capsula nao encontrada.');
  return id.data;
}

export const inviteController = {
  async create(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    const id = capsuleId(req);
    const input = parseOrThrow(createInvitesSchema, req.body);
    res.status(201).json({ invites: await inviteService.create(req.userId, id, input) });
  },

  async list(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    res.status(200).json({ data: await inviteService.list(req.userId, capsuleId(req)) });
  },

  async accept(req: Request<{ token: string }>, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await inviteService.accept(req.userId, req.params.token));
  },
};
