import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';

test('capsule delete removes only own SCHEDULED capsules and explains conflicts', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');
  const owner = 'a82e2d4c-5b6a-4789-9abc-def012345678';
  const other = 'b82e2d4c-5b6a-4789-9abc-def012345678';
  const scheduled = '3f1e2d4c-5b6a-4789-9abc-def012345678';
  const sent = '4f1e2d4c-5b6a-4789-9abc-def012345678';
  const rows = new Map([
    [scheduled, { creatorId: owner, status: 'SCHEDULED' }],
    [sent, { creatorId: owner, status: 'SENT' }],
  ]);
  prisma.capsule.deleteMany = (async (args: { where: { id: string; creatorId: string; status: string } }) => {
    const row = rows.get(args.where.id);
    if (!row || row.creatorId !== args.where.creatorId || row.status !== args.where.status) return { count: 0 };
    rows.delete(args.where.id);
    return { count: 1 };
  }) as unknown as typeof prisma.capsule.deleteMany;
  prisma.capsule.findFirst = (async (args: { where: { id: string; creatorId: string } }) => {
    const row = rows.get(args.where.id);
    return row && row.creatorId === args.where.creatorId ? { id: args.where.id } : null;
  }) as unknown as typeof prisma.capsule.findFirst;
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await prisma.$disconnect(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/capsules`;
  const del = (id: string, userId = owner) => fetch(`${base}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${generateToken(userId)}` } });

  assert.equal((await del(scheduled, other)).status, 404);
  assert.equal(rows.has(scheduled), true);

  const conflict = await del(sent);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'CAPSULE_NOT_EDITABLE');
  assert.equal(rows.has(sent), true);

  const ok = await del(scheduled);
  assert.equal(ok.status, 204);
  assert.equal(rows.has(scheduled), false);
  assert.equal((await del(scheduled)).status, 404);
  assert.equal((await del('invalid-id')).status, 404);
  assert.equal((await fetch(`${base}/${sent}`, { method: 'DELETE' })).status, 401);
});
