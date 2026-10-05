/**
 * Codigos estaveis do contrato da API (docs/api/README.md#formato-de-erro).
 * O cliente decide o tratamento pelo `code`; a `message` e so informativa.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_ALREADY_IN_USE'
  | 'CAPSULE_NOT_EDITABLE'
  | 'FILE_LIMIT_REACHED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR';

export interface ValidationDetail {
  field: string;
  message: string;
}

const DEFAULT_CODES: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Erro de aplicacao com status HTTP associado. Erros lancados com esta classe
 * sao considerados esperados e tem a mensagem repassada ao cliente.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown, code?: ErrorCode) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code ?? DEFAULT_CODES[statusCode] ?? 'INTERNAL_ERROR';
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static notFound(message = 'Recurso nao encontrado'): AppError {
    return new AppError(message, 404);
  }

  static unauthorized(message = 'Nao autorizado'): AppError {
    return new AppError(message, 401);
  }

  static forbidden(message = 'Acesso negado'): AppError {
    return new AppError(message, 403);
  }

  static validation(details: ValidationDetail[], message = 'Dados invalidos'): AppError {
    return new AppError(message, 422, details);
  }
}
