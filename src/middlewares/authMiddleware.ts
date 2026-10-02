import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../lib/AppError';
import { verifyToken } from '../lib/token';

/**
 * Uso em rotas protegidas:
 *   apiRoutes.get('/perfil', authMiddleware, perfilController.get);
 * O id do usuário fica em req.userId dentro do controller seguinte.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const [scheme, token] = authHeader?.split(' ') ?? [];

  // Depois deste if, o TypeScript sabe que "token" é string (não mais
  // string | undefined) — isso se chama "type narrowing".
  if (scheme !== 'Bearer' || !token) {
    throw AppError.unauthorized('Token não fornecido.');
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    throw AppError.unauthorized('Token inválido ou expirado.');
  }
}