import bcrypt from 'bcrypt';

import { AppError } from '../lib/AppError';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { generateToken } from '../lib/token';

const SALT_ROUNDS = 10;

export const authService = {
  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (!user) throw AppError.unauthorized('Sessão inválida. Entre novamente.');
    return user;
  },

  async register(name: string, email: string, password: string) {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw new AppError('E-mail já cadastrado.', 409);
    }

    const passhash = await bcrypt.hash(password, SALT_ROUNDS);

    try {
      const user = await prisma.user.create({
        data: { name, email, passhash },
        select: { id: true, name: true, email: true, createdAt: true },
      });

      return user;
    } catch (error) {
      // Cadastros simultaneos com o mesmo e-mail: a constraint unique decide.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('E-mail já cadastrado.', 409);
      }
      throw error;
    }
  },

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
