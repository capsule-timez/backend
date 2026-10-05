import type { Request, Response } from 'express';

import { AppError } from '../lib/AppError';
import { parseOrThrow } from '../lib/validate';
import { createCapsuleSchema } from '../schemas/capsule.schema';
import { capsuleService } from '../services/capsule.service';

export const capsuleController = {
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
