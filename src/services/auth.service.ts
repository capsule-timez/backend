import bcrypt from 'bcrypt';

import { AppError } from '../lib/AppError';
import { prisma } from '../lib/prisma';
import { generateToken } from '../lib/token';

export const authService = {
  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    // Mesmo erro (AppError.unauthorized) para "não existe" e "senha errada":
    // não revelamos qual dos dois casos aconteceu.
    if (!user) {
      throw AppError.unauthorized('E-mail ou senha inválidos.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passhash);

    if (!passwordMatches) {
      throw AppError.unauthorized('E-mail ou senha inválidos.');
    }

    const token = generateToken(user.id);

    // Nunca devolve o passhash na resposta da API.
    const { passhash: _passhash, ...userWithoutPassword } = user;

    return { token, user: userWithoutPassword };
  },
};