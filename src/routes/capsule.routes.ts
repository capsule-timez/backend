import { Router } from 'express';

import { capsuleController } from '../controllers/capsule.controller';
import { authMiddleware } from '../middlewares/authMiddleware';

export const capsuleRoutes = Router();

// Todas as rotas de capsulas exigem Bearer token.
capsuleRoutes.use(authMiddleware);

capsuleRoutes.get('/', capsuleController.list);
capsuleRoutes.post('/', capsuleController.create);
capsuleRoutes.get('/:id', capsuleController.detail);
capsuleRoutes.post('/:id/files', capsuleController.addFile);
capsuleRoutes.delete('/:id', capsuleController.remove);
