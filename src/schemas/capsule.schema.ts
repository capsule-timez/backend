import { z } from 'zod';

/** Antecedencia minima entre a criacao e a entrega da capsula. */
export const MIN_SCHEDULE_LEAD_MS = 60_000;

const SCHEDULE_DATE_MESSAGE = 'Deve ser uma data em UTC (sufixo Z) pelo menos 1 minuto no futuro';

/** Diferencia campo ausente de campo com tipo/formato errado. */
function fieldError(message: string) {
  return (issue: { input?: unknown }) =>
    issue.input === undefined ? 'Campo obrigatorio' : message;
}

export const createCapsuleSchema = z.strictObject(
  {
    title: z
      .string({ error: fieldError('Deve ser um texto') })
      .min(1, 'Deve ter pelo menos 1 caractere')
      .max(120, 'Deve ter no maximo 120 caracteres'),
    text: z
      .string({ error: fieldError('Deve ser um texto') })
      .min(1, 'Deve ter pelo menos 1 caractere')
      .max(10_000, 'Deve ter no maximo 10.000 caracteres'),
    recipientEmail: z
      .email({ error: fieldError('Deve ser um e-mail valido') })
      .max(254, 'Deve ter no maximo 254 caracteres'),
    // z.iso.datetime() so aceita o sufixo Z: outro fuso ou data sem fuso falham.
    scheduleDate: z
      .iso.datetime({ error: fieldError(SCHEDULE_DATE_MESSAGE) })
      .refine((value) => Date.parse(value) >= Date.now() + MIN_SCHEDULE_LEAD_MS, {
        error: SCHEDULE_DATE_MESSAGE,
      })
      .transform((value) => new Date(value)),
  },
  { error: 'O corpo da requisicao deve ser um objeto JSON' },
);

export type CreateCapsuleInput = z.infer<typeof createCapsuleSchema>;
