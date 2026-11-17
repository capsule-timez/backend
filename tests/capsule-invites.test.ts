import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';
process.env.RESEND_API_KEY = 're_test_key';
process.env.WEB_URL = 'https://capsula.example.com';

interface InviteRow {
  id: string;
  capsuleId: string;
  email: string;
  tokenHash: string;
  status: 'PENDING' | 'ACCEPTED';
  expiresAt: Date;
  invitedById: string;
  acceptedById: string | null;
  acceptedAt: Date | null;
  sentAt: Date;
}

test('group capsule invites: owner sends by e-mail, invitee accepts once, tokens stay hashed', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { storage } = await import('../src/lib/storage');
  const { logger } = await import('../src/lib/logger');
  const { hashAccessToken } = await import('../src/lib/accessToken');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');

  const owner = 'a82e2d4c-5b6a-4789-9abc-def012345678';
  const member = 'b82e2d4c-5b6a-4789-9abc-def012345678';
  const outsider = 'c82e2d4c-5b6a-4789-9abc-def012345678';
  const invitee = 'd82e2d4c-5b6a-4789-9abc-def012345678';
  const capsuleId = '3f1e2d4c-5b6a-4789-9abc-def012345678';
  const users: Record<string, { name: string; email: string }> = {
    [owner]: { name: 'Owner', email: 'owner@example.com' },
    [member]: { name: 'Member', email: 'Member@Example.com' },
    [outsider]: { name: 'Outsider', email: 'outsider@example.com' },
    [invitee]: { name: 'Invitee', email: 'invitee@example.com' },
  };
  const members = new Map<string, 'OWNER' | 'MEMBER'>([[owner, 'OWNER'], [member, 'MEMBER']]);
  const capsule = { titleContent: 'Aniversário', status: 'SCHEDULED', contributionDeadline: new Date(Date.now() + 3_600_000) };
  const invites = new Map<string, InviteRow>();
  let nextId = 0;

  prisma.capsule.findFirst = (async (args: {
    where: { id: string; type?: string; members?: { some: { userId: string } }; OR?: [{ creatorId: string }, { members: { some: { userId: string } } }] };
  }) => {
    if (args.where.id !== capsuleId) return null;
    if (args.where.OR) {
      // Detalhe devolvido pelo aceite do convite.
      const userId = args.where.OR[1].members.some.userId;
      if (!members.has(userId)) return null;
      return {
        id: capsuleId, titleContent: capsule.titleContent, textContent: 'Mensagem', recipientEmail: 'dest@example.com',
        scheduleDate: new Date(Date.now() + 7_200_000), status: capsule.status, sentAt: null, createdAt: new Date(),
        type: 'GROUP', inviteCode: 'code', files: [], contributions: [],
        members: [...members].map(([id, role]) => ({ userId: id, role, user: { name: users[id]!.name } })),
      };
    }
    assert.equal(args.where.type, 'GROUP');
    const userId = args.where.members!.some.userId;
    const role = members.get(userId);
    if (!role) return null;
    return { ...capsule, members: [{ role, user: { name: users[userId]!.name } }] };
  }) as unknown as typeof prisma.capsule.findFirst;

  prisma.capsuleMember.findMany = (async (args: { where: { user: { email: { in: string[] } } } }) =>
    [...members.keys()]
      .filter((id) => args.where.user.email.in.includes(users[id]!.email.toLowerCase()))
      .map((id) => ({ user: { email: users[id]!.email } }))) as unknown as typeof prisma.capsuleMember.findMany;

  prisma.capsuleInvite.upsert = (async (args: {
    where: { capsuleId_email: { capsuleId: string; email: string } };
    create: Omit<InviteRow, 'id' | 'status' | 'acceptedById' | 'acceptedAt'>;
    update: Partial<InviteRow>;
  }) => {
    const key = `${args.where.capsuleId_email.capsuleId}:${args.where.capsuleId_email.email}`;
    const existing = invites.get(key);
    const row: InviteRow = existing
      ? { ...existing, ...args.update }
      : { id: `invite-${nextId++}`, status: 'PENDING', acceptedById: null, acceptedAt: null, ...args.create };
    invites.set(key, row);
    return row;
  }) as unknown as typeof prisma.capsuleInvite.upsert;

  prisma.capsuleInvite.findMany = (async () =>
    [...invites.values()].map(({ email, status, sentAt, expiresAt, acceptedAt }) => ({
      email, status, sentAt, expiresAt, acceptedAt,
    }))) as unknown as typeof prisma.capsuleInvite.findMany;

  prisma.capsuleInvite.findUnique = (async (args: { where: { tokenHash: string } }) => {
    const row = [...invites.values()].find((invite) => invite.tokenHash === args.where.tokenHash);
    return row && { ...row, capsule: { status: capsule.status, contributionDeadline: capsule.contributionDeadline } };
  }) as unknown as typeof prisma.capsuleInvite.findUnique;

  prisma.capsuleInvite.updateMany = (async (args: { where: { id: string; status: string }; data: Partial<InviteRow> }) => {
    const row = [...invites.values()].find((invite) => invite.id === args.where.id);
    if (!row || row.status !== args.where.status) return { count: 0 };
    Object.assign(row, args.data);
    return { count: 1 };
  }) as unknown as typeof prisma.capsuleInvite.updateMany;

  prisma.capsuleMember.createMany = (async (args: { data: { userId: string; role: 'MEMBER' } }) => {
    if (members.has(args.data.userId)) return { count: 0 };
    members.set(args.data.userId, args.data.role);
    return { count: 1 };
  }) as unknown as typeof prisma.capsuleMember.createMany;

  prisma.$transaction = (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as unknown as typeof prisma.$transaction;
  storage.downloadUrl = async (key) => ({ url: `http://minio/${key}`, expiresAt: new Date() });

  // E-mails do Resend sao capturados; o resto das chamadas vai para o servidor de teste.
  const emails: { to: string; subject: string; text: string; html: string }[] = [];
  let failTo = '';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes('resend.com')) return originalFetch(url, init);
    const body = JSON.parse(String(init?.body)) as { to: string; subject: string; text: string; html: string };
    if (body.to === failTo) {
      return new Response(JSON.stringify({ name: 'validation_error', message: 'invalid' }), { status: 422, headers: { 'content-type': 'application/json' } });
    }
    emails.push(body);
    return new Response(JSON.stringify({ id: 'email-id' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const logs: string[] = [];
  const capture = (message: string) => { logs.push(message); };
  t.mock.method(logger, 'warn', capture);
  t.mock.method(logger, 'error', capture);

  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    globalThis.fetch = originalFetch;
    server.close();
    await once(server, 'close');
    await prisma.$disconnect();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const api = `http://127.0.0.1:${address.port}/api`;
  const call = (method: string, path: string, userId: string | null, body?: unknown) =>
    fetch(`${api}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(userId && { Authorization: `Bearer ${generateToken(userId)}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const invite = (emails: unknown, userId = owner) => call('POST', `/capsules/${capsuleId}/invites`, userId, { emails });
  const accept = (token: string, userId = invitee) => call('POST', `/invites/${encodeURIComponent(token)}/accept`, userId);
  const tokenOf = (email: string) => {
    const message = emails.findLast((item) => item.to === email);
    assert.ok(message, `nenhum e-mail para ${email}`);
    const match = /https:\/\/capsula\.example\.com\/convite\/([^\s"<]+)/.exec(message.text);
    assert.ok(match);
    return decodeURIComponent(match[1]!);
  };

  // Validacao do corpo.
  assert.equal((await invite([])).status, 422);
  assert.equal((await invite(['nao-e-email'])).status, 422);
  assert.equal((await invite(Array.from({ length: 21 }, (_, index) => `u${index}@example.com`))).status, 422);

  // Permissoes: MEMBER recebe 403; quem nao participa, 404; sem login, 401.
  const forbidden = await invite(['x@example.com'], member);
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, 'FORBIDDEN');
  assert.equal((await invite(['x@example.com'], outsider)).status, 404);
  assert.equal((await call('POST', `/capsules/${capsuleId}/invites`, null, { emails: ['x@example.com'] })).status, 401);
  assert.equal((await call('GET', `/capsules/${capsuleId}/invites`, member)).status, 403);
  assert.equal((await call('GET', `/capsules/${capsuleId}/invites`, outsider)).status, 404);
  assert.equal(emails.length, 0);

  // Convite com sucesso: e-mails normalizados e sem repeticao; participante atual e ignorado.
  const created = await invite([' Invitee@Example.com ', 'invitee@example.com', 'member@example.com', 'friend@example.com']);
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json()).invites, [
    { email: 'invitee@example.com', result: 'SENT' },
    { email: 'member@example.com', result: 'ALREADY_MEMBER' },
    { email: 'friend@example.com', result: 'SENT' },
  ]);
  assert.equal(emails.length, 2);
  assert.match(emails[0]!.subject, /Aniversário/);
  assert.match(emails[0]!.text, /Owner convidou você/);
  assert.match(emails[0]!.html, /Aceitar convite/);

  // So o hash do token e persistido.
  const inviteeToken = tokenOf('invitee@example.com');
  const stored = invites.get(`${capsuleId}:invitee@example.com`)!;
  assert.equal(stored.tokenHash, hashAccessToken(inviteeToken));
  assert.equal(JSON.stringify([...invites.values()]).includes(inviteeToken), false);
  assert.equal(stored.expiresAt.getTime(), capsule.contributionDeadline.getTime());

  // Falha no envio nao derruba os outros convites.
  failTo = 'broken@example.com';
  const partial = await invite(['broken@example.com', 'other@example.com']);
  assert.equal(partial.status, 201);
  assert.deepEqual((await partial.json()).invites, [
    { email: 'broken@example.com', result: 'EMAIL_FAILED' },
    { email: 'other@example.com', result: 'SENT' },
  ]);

  // Reenviar para o mesmo e-mail troca o token: o link antigo deixa de valer.
  const friendOld = tokenOf('friend@example.com');
  await invite(['friend@example.com']);
  const friendNew = tokenOf('friend@example.com');
  assert.notEqual(friendOld, friendNew);
  assert.equal((await accept(friendOld, outsider)).status, 404);

  // Aceite: token invalido e 404; valido adiciona como MEMBER e devolve o detalhe.
  const unknown = await accept('token-que-nao-existe');
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).code, 'NOT_FOUND');
  assert.equal((await call('POST', `/invites/${inviteeToken}/accept`, null)).status, 401);
  const accepted = await accept(inviteeToken);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('cache-control'), 'no-store');
  const detail = await accepted.json();
  assert.equal(detail.id, capsuleId);
  assert.deepEqual(detail.participants.at(-1), { name: 'Invitee', role: 'MEMBER' });
  assert.equal('inviteCode' in detail, false);
  assert.equal(members.get(invitee), 'MEMBER');

  // Convite ja usado: 404, inclusive para outra pessoa.
  assert.equal((await accept(inviteeToken)).status, 404);
  assert.equal((await accept(inviteeToken, outsider)).status, 404);
  assert.equal(members.has(outsider), false);

  // Listagem para o OWNER, com status calculado.
  const friendRow = invites.get(`${capsuleId}:friend@example.com`)!;
  friendRow.expiresAt = new Date(Date.now() - 1000);
  const list = await call('GET', `/capsules/${capsuleId}/invites`, owner);
  assert.equal(list.status, 200);
  const statuses = Object.fromEntries((await list.json()).data.map((item: { email: string; status: string }) => [item.email, item.status]));
  assert.deepEqual(statuses, {
    'invitee@example.com': 'ACCEPTED',
    'friend@example.com': 'EXPIRED',
    'broken@example.com': 'PENDING',
    'other@example.com': 'PENDING',
  });
  assert.equal(JSON.stringify(statuses).includes('tokenHash'), false);

  // Convite expirado nao pode ser aceito.
  assert.equal((await accept(friendNew, outsider)).status, 404);

  // Prazo de contribuicao encerrado: convidar retorna 409.
  capsule.contributionDeadline = new Date(Date.now() - 1000);
  const late = await invite(['late@example.com']);
  assert.equal(late.status, 409);
  assert.equal((await late.json()).code, 'CONTRIBUTION_DEADLINE_PASSED');

  // Os tokens nunca aparecem nos logs.
  for (const token of [inviteeToken, friendOld, friendNew]) {
    assert.equal(logs.some((line) => line.includes(token)), false);
  }
  assert.ok(logs.some((line) => line.includes('/api/invites/[redacted]/accept')));
});
