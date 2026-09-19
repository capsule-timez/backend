import type { NextFunction, Request, Response } from 'express';

import { isProduction } from '../config/env';
import { AppError } from '../lib/AppError';
import { logger } from '../lib/logger';

interface ErrorBody {
  status: 'error';
  message: string;
  details?: unknown;
  stack?: string;
}

/**
 * Tratamento centralizado de erros. O Express 5 encaminha rejeicoes de
 * handlers assincronos para ca automaticamente.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isAppError = error instanceof AppError;
  const statusCode = isAppError ? error.statusCode : 500;
  const message = isAppError ? error.message : 'Erro interno do servidor';

  const logMessage = `${req.method} ${req.originalUrl} -> ${statusCode}`;

  if (statusCode >= 500) {
    logger.error(logMessage, error);
  } else {
    logger.warn(logMessage, message);
  }

  const body: ErrorBody = { status: 'error', message };

  if (isAppError && error.details !== undefined) {
    body.details = error.details;
  }

  if (!isProduction && error instanceof Error && error.stack) {
    body.stack = error.stack;
  }

  res.status(statusCode).json(body);
}
