import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { env } from './config/env';
import { errorHandler } from './middlewares/errorHandler';
import { notFound } from './middlewares/notFound';
import { apiRoutes, rootRoutes } from './routes';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(rootRoutes);
  app.use(env.API_PREFIX, apiRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
