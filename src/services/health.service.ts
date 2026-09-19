import { env } from '../config/env';

export interface HealthStatus {
  status: 'ok';
  environment: string;
  version: string;
  uptime: number;
  timestamp: string;
}

const version = process.env.npm_package_version ?? '0.0.0';

export const healthService = {
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      environment: env.NODE_ENV,
      version,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  },
};
