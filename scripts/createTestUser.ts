import bcrypt from 'bcrypt';

import { prisma } from '../src/lib/prisma';

/**
 * Script de uso único para criar um usuário de teste.
 * Rode com: npx tsx scripts/createTestUser.ts
 * (ou ts-node, se for o que o projeto já usa — veja o README/package.json)
 *
 * Depois de testar o login, pode apagar este arquivo e este usuário.
 */
async function main() {
  const email = 'teste@capsuletimez.com';
  const plainPassword = 'senha123';

  const passhash = await bcrypt.hash(plainPassword, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passhash },
    create: { name: 'Usuário de Teste', email, passhash },
  });

  console.log('Usuário criado/atualizado:', { id: user.id, email: user.email });
  console.log('Senha em texto puro para teste:', plainPassword);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());