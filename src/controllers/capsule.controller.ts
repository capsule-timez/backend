import type { Request, Response } from 'express';
import { z } from 'zod';

import { AppError } from '../lib/AppError';
import { receiveFile, receiveFiles } from '../lib/upload';
import { parseOrThrow } from '../lib/validate';
import {
  createCapsuleSchema,
  createContributionSchema,
  joinCapsuleSchema,
  listCapsulesQuerySchema,
  MAX_IMAGES_PER_CONTRIBUTION,
  updateCapsuleSchema,
} from '../schemas/capsule.schema';
import { capsuleService } from '../services/capsule.service';
import { contributionService } from '../services/contribution.service';

export const capsuleController = {
  async join(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token nao fornecido.');
    const { inviteCode } = parseOrThrow(joinCapsuleSchema, req.body);
    res.status(200).json(await capsuleService.join(req.userId, inviteCode));
  },

  async update(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw AppError.notFound('Capsula nao encontrada.');
    const input = parseOrThrow(updateCapsuleSchema, req.body);
    res.status(200).json(await capsuleService.update(id.data, req.userId, input));
  },

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

  async addContribution(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    const id = z.uuid().safeParse(req.params.id);
    if (!id.success) throw AppError.notFound('Capsula nao encontrada.');

    // Texto puro pode vir em JSON; com imagens, o corpo e multipart/form-data.
    const { fields, files } = req.is('multipart/form-data')
      ? await receiveFiles(req, res, 'files', MAX_IMAGES_PER_CONTRIBUTION)
      : { fields: req.body as unknown, files: [] };
    const input = parseOrThrow(createContributionSchema, fields);
    if (!input.text && files.length === 0) {
      throw AppError.validation([{ field: 'text', message: 'Envie um texto ou ao menos uma imagem' }]);
    }

    res.status(201).json(await contributionService.create(req.userId, id.data, input, files));
  },

  async remove(req: Request, res: Response): Promise<void> {
    if (!req.userId) throw AppError.unauthorized('Token não fornecido.');
    const result = z.uuid().safeParse(req.params.id);
    if (!result.success) throw AppError.notFound('Capsula nao encontrada.');
    await capsuleService.remove(req.userId, result.data);
    res.status(204).end();
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
