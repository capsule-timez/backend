import { env } from '../config/env';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

type Level = (typeof LEVELS)[number];

const minLevel: Level = env.NODE_ENV === 'development' ? 'debug' : 'info';

function shouldLog(level: Level): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(minLevel);
}

function write(level: Level, message: string, meta?: unknown): void {
  if (!shouldLog(level)) return;

  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;

  if (level === 'error') {
    console.error(line, meta ?? '');
    return;
  }

  console.log(line, meta ?? '');
}

export const logger = {
  debug: (message: string, meta?: unknown) => write('debug', message, meta),
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta),
};
