import type { Request, Response } from 'express';

import { AppError } from '../lib/AppError';
import { authService } from '../services/auth.service';

export const authController = {
  async login(req: Request, res: Response): Promise<void> {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      throw new AppError('E-mail e senha são obrigatórios.');
    }

    const { token, user } = await authService.login(email, password);

    res.status(200).json({ token, user });
  },

  // Rota de teste do authMiddleware: só responde se o token for válido.
  // req.userId é preenchido pelo authMiddleware antes de chegar aqui.
  me(req: Request, res: Response): void {
    res.status(200).json({ userId: req.userId });
  },
};