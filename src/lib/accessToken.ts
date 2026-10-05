import { createHash, randomBytes } from 'node:crypto';

/**
 * Token de acesso do destinatario: 256 bits aleatorios, enviados apenas no
 * link do e-mail. O banco guarda somente o hash SHA-256, entao o texto puro
 * nunca deve ser persistido, logado ou devolvido pela API.
 */
export interface AccessToken {
  /** Texto puro (base64url). Vai so no corpo do e-mail. */
  token: string;
  /** SHA-256 em hex (64 caracteres). E o que fica na coluna `token`. */
  hash: string;
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateAccessToken(): AccessToken {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAccessToken(token) };
}
