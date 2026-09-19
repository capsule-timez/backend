import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../lib/AppError';

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Rota nao encontrada: ${req.method} ${req.originalUrl}`));
}
