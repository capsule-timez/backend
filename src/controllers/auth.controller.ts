import type { Request, Response } from 'express';

import { z } from 'zod';

import { AppError } from '../lib/AppError';
import { parseOrThrow } from '../lib/validation';
import { authService } from '../services/auth.service';

const registerSchema = z.object({
  name: z.string('Nome é obrigatório').trim().min(1, 'Nome é obrigatório').max(100, 'Nome deve ter no máximo 100 caracteres'),
  email: z
    .string('E-mail é obrigatório')
    .trim()
    .toLowerCase()
    .max(254, 'E-mail deve ter no máximo 254 caracteres')
    .pipe(z.email('E-mail inválido')),
  password: z
    .string('Senha é obrigatória')
    .min(8, 'A senha deve ter no mínimo 8 caracteres')
    .max(72, 'A senha deve ter no máximo 72 caracteres'),
});

export const authController = {
  async register(req: Request, res: Response): Promise<void> {
    const { name, email, password } = parseOrThrow(registerSchema, req.body);

    const user = await authService.register(name, email, password);

    res.status(201).json(user);
  },

  async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      throw new AppError('E-mail e senha são obrigatórios.');
    }

    const { token, user } = await authService.login(email, password);

    res.status(200).json({ token, user });
  },

  async me(req: Request, res: Response): Promise<void> {
    const user = await authService.me(req.userId!);
    res.status(200).json(user);
  },
};
