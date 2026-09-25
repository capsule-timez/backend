import { Router } from 'express';

import { healthRoutes } from './health.routes';

/**
 * Rotas publicas registradas na raiz, fora do API_PREFIX.
 * Usado por health probes de orquestradores.
 */
export const rootRoutes = Router();
rootRoutes.use(healthRoutes);

/**
 * Rotas de negocio, montadas sob o API_PREFIX (ex.: /api).
 * Novos modulos devem ser registrados aqui.
 */
export const apiRoutes = Router();
