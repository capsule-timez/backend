import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().startsWith('/').default('/api'),

  // Infraestrutura local (docker-compose). Opcionais enquanto a API ainda nao
  // se conecta a esses servicos.
  POSTGRES_DB: z.string().optional(),
  POSTGRES_USER: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_PORT: z.coerce.number().int().positive().optional(),
  MINIO_ROOT_USER: z.string().optional(),
  MINIO_ROOT_PASSWORD: z.string().optional(),
  MINIO_API_PORT: z.coerce.number().int().positive().optional(),
  MINIO_CONSOLE_PORT: z.coerce.number().int().positive().optional(),
  RESEND_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Variaveis de ambiente invalidas:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export type Env = z.infer<typeof envSchema>;

export const env: Readonly<Env> = Object.freeze(parsed.data);

export const isProduction = env.NODE_ENV === 'production';
