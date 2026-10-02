import jwt, { type SignOptions } from 'jsonwebtoken';

import { env } from '../config/env';

export interface TokenPayload {
  sub: string; // id do usuário (UUID)
  iat: number;
  exp: number;
}

const signOptions: SignOptions = {
  expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
};

export function generateToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, signOptions);
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);

  if (typeof decoded === 'string' || decoded.sub === undefined) {
    throw new Error('Token payload inválido.');
  }

  return {
    sub: decoded.sub,
    iat: decoded.iat as number,
    exp: decoded.exp as number,
  };
}