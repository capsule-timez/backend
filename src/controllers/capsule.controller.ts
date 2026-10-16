import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/AppError';
import { receiveFile } from '../lib/upload';
import { parseOrThrow } from '../lib/validate';
import { createCapsuleSchema, listCapsulesQuerySchema } from '../schemas/capsule.schema';
import { capsuleService } from '../services/capsule.service';

export const capsuleController = {
  async list(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');

    const query = listCapsulesQuerySchema.safeParse(req.query);
    if (!query.success) {
      // Parametro com formato invalido e 400 no contrato (diferente do 422 do corpo).
      const details = query.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      throw new AppError('Parametros de consulta invalidos', 400, details);
    }

    res.status(200).json(await capsuleService.list(req.userId, query.data));
  },

  async detail(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    const result = z.uuid().safeParse(req.params.id);
    if (!result.success) throw AppError.notFound('Capsula nao encontrada.');
    const capsule = await capsuleService.detail(req.userId, result.data);
    res.status(200).json(capsule);
  },

  async addFile(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    const result = z.uuid().safeParse(req.params.id);
    if (!result.success) throw AppError.notFound('Capsula nao encontrada.');
    const file = await receiveFile(req, res);
    res.status(201).json(await capsuleService.addFile(req.userId, result.data, file));
  },

  async create(req: Request, res: Response): Promise<void> {
    // Preenchido pelo authMiddleware; a checagem so estreita o tipo.
    if (!req.userId) {
      throw AppError.unauthorized('Token não fornecido.');
    }

    const input = parseOrThrow(createCapsuleSchema, req.body);
    const capsule = await capsuleService.create(req.userId, input);

    res.status(201).json(capsule);
  },
};
