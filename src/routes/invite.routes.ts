import { Router } from 'express';

import { inviteController } from '../controllers/invite.controller';
import { authMiddleware } from '../middlewares/authMiddleware';

export const inviteRoutes = Router();

inviteRoutes.use(authMiddleware);

inviteRoutes.post('/:token/accept', inviteController.accept);
