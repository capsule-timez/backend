import { Router } from 'express';

import { authController } from '../controllers/auth.controller';
import { authMiddleware } from '../middlewares/authMiddleware';

export const authRoutes = Router();

authRoutes.post('/register', authController.register);
authRoutes.post('/login', authController.login);

// Rota de teste: exige um token válido no header Authorization.
authRoutes.get('/me', authMiddleware, authController.me);