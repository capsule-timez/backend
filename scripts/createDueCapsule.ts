import bcrypt from 'bcrypt';

import { CapsuleStatus } from '../src/generated/prisma/enums';
import { generateAccessToken } from '../src/lib/accessToken';
import { prisma } from '../src/lib/prisma';


async function main() {
  const [recipientEmail, minutesArg = '2'] = process.argv.slice(2);
  const minutes = Number(minutesArg);

  if (!recipientEmail || !recipientEmail.includes('@') || !Number.isFinite(minutes) || minutes < 0) {
    console.error('Uso: npx tsx scripts/createDueCapsule.ts <email-destinatario> [minutos]');
    process.exitCode = 1;
    return;
  }

  const email = 'teste@capsuletimez.com';
  const creator = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: 'Usuário de Teste', email, passhash: await bcrypt.hash('senha123', 10) },
  });

  const scheduleDate = new Date(Date.now() + minutes * 60_000);
  const { hash } = generateAccessToken();

  const capsule = await prisma.capsule.create({
    data: {
      creatorId: creator.id,
      titleContent: `Capsula de teste (${scheduleDate.toLocaleTimeString('pt-BR')})`,
      textContent: 'Mensagem de teste do e-mail de entrega com o link de abertura.',
      recipientEmail,
      scheduleDate,
      status: CapsuleStatus.SCHEDULED,
      token: hash,
    },
  });

  console.log('Capsula criada:', { id: capsule.id, recipientEmail, scheduleDate: scheduleDate.toISOString() });
  console.log(`Com a API rodando (npm run dev), o job envia em ate ${minutes + 1} minuto(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
