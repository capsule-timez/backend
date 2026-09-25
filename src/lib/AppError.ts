/**
 * Erro de aplicacao com status HTTP associado. Erros lancados com esta classe
 * sao considerados esperados e tem a mensagem repassada ao cliente.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
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
}
