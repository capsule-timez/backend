import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().startsWith('/').default('/api'),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('1h'),

  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'deve comecar com postgresql:// ou postgres://'),

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
  MINIO_ENDPOINT: z.string().min(1).default('localhost'),
  MINIO_REGION: z.string().min(1).default('us-east-1'),
  MINIO_PRESIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(1).max(604800).default(900),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MINIO_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'nome de bucket invalido')
    .default('capsula'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().min(1).default('Capsula do Tempo <onboarding@resend.dev>'),
  WEB_URL: z
    .url({ protocol: /^https?$/, message: 'deve ser uma URL http(s)' })
    .default('http://localhost:5173')
    .transform((value) => value.replace(/\/+$/, '')),
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
