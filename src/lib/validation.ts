import { z } from 'zod';

import { AppError } from './AppError';

/**
 * Valida `data` com o schema e, em caso de falha, lanca um AppError 400 com a
 * lista de campos problematicos em `details` ([{ field, message }]).
 */
export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppError('Dados inválidos.', 400, details);
  }

  return result.data;
}
