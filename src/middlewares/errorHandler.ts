import type { NextFunction, Request, Response } from 'express';

import { isProduction } from '../config/env';
import { AppError, type ErrorCode } from '../lib/AppError';
import { logger } from '../lib/logger';

interface ErrorBody {
  status: 'error';
  code: ErrorCode;
  message: string;
  details?: unknown;
  stack?: string;
}

/**
 * O express.json() rejeita corpo malformado com um SyntaxError marcado com
 * type 'entity.parse.failed'. Pelo contrato isso e 400, nao 500.
 */
function isMalformedJson(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    (error as SyntaxError & { type?: string }).type === 'entity.parse.failed'
  );
}

function toAppError(error: unknown): AppError | undefined {
  if (error instanceof AppError) return error;
  if (isMalformedJson(error)) return new AppError('JSON malformado', 400);
  return undefined;
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
  const appError = toAppError(error);
  const statusCode = appError ? appError.statusCode : 500;
  const code: ErrorCode = appError ? appError.code : 'INTERNAL_ERROR';
  const message = appError ? appError.message : 'Erro interno do servidor';

  const logMessage = `${req.method} ${req.originalUrl} -> ${statusCode}`;

  if (statusCode >= 500) {
    logger.error(logMessage, error);
  } else {
    logger.warn(logMessage, message);
  }

  const body: ErrorBody = { status: 'error', code, message };

  if (appError && appError.details !== undefined) {
    body.details = appError.details;
  }

  if (!isProduction && error instanceof Error && error.stack) {
    body.stack = error.stack;
  }

  res.status(statusCode).json(body);
}
