import jwt, { type SignOptions } from 'jsonwebtoken';

import { env } from '../config/env';

export interface TokenPayload {
  sub: number; // id do usuário
  iat: number;
  exp: number;
}

const signOptions: SignOptions = {
  // O tipo exportado pela lib (StringValue) é mais restrito que "string".
  // O valor já é validado no schema de env (formato "1h", "7d" etc.), então
  // o cast aqui é seguro.
  expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
};

export function generateToken(userId: number): string {
  // A claim "sub" é definida pelo JWT como string — por isso convertemos
  // o id (number) para string ao assinar.
  return jwt.sign({ sub: String(userId) }, env.JWT_SECRET, signOptions);
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);

  // jwt.verify pode devolver uma string "crua" (não é o nosso caso, mas o
  // tipo da lib permite) ou um payload sem "sub". Os dois casos viram erro.
  if (typeof decoded === 'string' || decoded.sub === undefined) {
    throw new Error('Token payload inválido.');
  }

  return {
    sub: Number(decoded.sub),
    iat: decoded.iat as number,
    exp: decoded.exp as number,
  };
}