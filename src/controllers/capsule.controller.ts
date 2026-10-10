import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/AppError';
import { parseOrThrow } from '../lib/validate';
import { createCapsuleSchema } from '../schemas/capsule.schema';
import { capsuleService } from '../services/capsule.service';

export const capsuleController = {
  async detail(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    const result = z.uuid().safeParse(req.params.id);
    if (!result.success) throw AppError.notFound('Capsula nao encontrada.');
    const capsule = await capsuleService.detail(req.userId, result.data);
    res.status(200).json(capsule);
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
