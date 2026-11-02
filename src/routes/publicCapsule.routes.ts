import { Router } from 'express';

import { publicCapsuleController } from '../controllers/publicCapsule.controller';

export const publicCapsuleRoutes = Router();

publicCapsuleRoutes.get('/capsules/:token', publicCapsuleController.open);
