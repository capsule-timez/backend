import type { z } from 'zod';

import { AppError, type ValidationDetail } from './AppError';

function toDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.flatMap((issue) => {
    // Campos desconhecidos (.strict) chegam num unico issue com a lista de chaves.
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({ field: key, message: 'Campo nao permitido' }));
    }

    return [{ field: issue.path.join('.') || 'body', message: issue.message }];
  });
}

/**
 * Valida `data` com o schema e devolve o valor tipado. Em caso de falha lanca
 * 422 VALIDATION_ERROR com um item em `details` por campo invalido.
 */
export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw AppError.validation(toDetails(result.error));
  }

  return result.data;
}
