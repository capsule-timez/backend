import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';

test('capsule list is scoped to the authenticated user, filterable, ordered and paginated', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');
  const owner = 'a82e2d4c-5b6a-4789-9abc-def012345678';
  const date = new Date('2026-10-09T12:00:00Z');
  const row = {
    id: '3f1e2d4c-5b6a-4789-9abc-def012345678',
    titleContent: 'Carta',
    recipientEmail: 'user@example.com',
    scheduleDate: date,
    status: 'SCHEDULED',
    sentAt: null,
    createdAt: date,
    token: 'secret-hash',
    _count: { files: 2 },
  };
  let rows = [row];
  let total = 1;
  const calls: { where: Record<string, unknown>; args: Record<string, unknown> }[] = [];

  prisma.capsule.count = (async (args: { where: Record<string, unknown> }) => {
    void args;
    return total;
  }) as unknown as typeof prisma.capsule.count;
  prisma.capsule.findMany = (async (args: { where: Record<string, unknown> }) => {
    calls.push({ where: args.where, args: args as unknown as Record<string, unknown> });
    return rows;
  }) as unknown as typeof prisma.capsule.findMany;
  prisma.$transaction = (async (ops: Promise<unknown>[]) =>
    Promise.all(ops)) as unknown as typeof prisma.$transaction;

  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
    await prisma.$disconnect();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/capsules`;
  const get = (query = '') =>
    fetch(`${base}${query}`, { headers: { Authorization: `Bearer ${generateToken(owner)}` } });

  // Lista o usuario autenticado, com contagem de arquivos e sem vazar o token.
  const ok = await get();
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {
    data: [
      {
        id: row.id,
        title: 'Carta',
        recipientEmail: 'user@example.com',
        scheduleDate: date.toISOString(),
        status: 'SCHEDULED',
        sentAt: null,
        createdAt: date.toISOString(),
        fileCount: 2,
      },
    ],
    meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  });
  assert.deepEqual(calls[0].where, { creatorId: owner });
  assert.deepEqual(calls[0].args.orderBy, [{ scheduleDate: 'asc' }, { id: 'asc' }]);

  // creatorId vem do token, mesmo que a query tente sobrescrever.
  await get(`?creatorId=${'b82e2d4c-5b6a-4789-9abc-def012345678'}`);
  assert.deepEqual(calls[1].where, { creatorId: owner });

  // Filtro por status e paginacao.
  total = 45;
  const filtered = await get('?status=SENT&page=2&pageSize=10');
  assert.equal(filtered.status, 200);
  assert.deepEqual(calls[2].where, { creatorId: owner, status: 'SENT' });
  assert.equal(calls[2].args.skip, 10);
  assert.equal(calls[2].args.take, 10);
  assert.deepEqual((await filtered.json()).meta, { page: 2, pageSize: 10, total: 45, totalPages: 5 });

  // Sem capsulas: lista vazia, nao erro.
  rows = [];
  total = 0;
  const empty = await get();
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {
    data: [],
    meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  });

  // Parametros invalidos: 400 sem consultar o banco.
  const before = calls.length;
  for (const query of ['?status=INVALID', '?page=0', '?pageSize=101', '?page=abc']) {
    assert.equal((await get(query)).status, 400, query);
  }
  assert.equal(calls.length, before);

  // Sem token ou com token invalido: 401.
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await fetch(base, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
});
