import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';

test('GET /auth/me returns only the authenticated user fields and requires a valid session', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');
  const user = { id: '3f1e2d4c-5b6a-4789-9abc-def012345678', name: 'Maria', email: 'maria@example.com', createdAt: new Date('2026-10-09T12:00:00Z') };
  let exists = true;
  prisma.user.findUnique = (async (args: unknown) => {
    assert.deepEqual(args, { where: { id: user.id }, select: { id: true, name: true, email: true, createdAt: true } });
    return exists ? user : null;
  }) as typeof prisma.user.findUnique;
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await prisma.$disconnect(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/auth/me`;
  const headers = { Authorization: `Bearer ${generateToken(user.id)}` };
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...user, createdAt: user.createdAt.toISOString() });
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
  exists = false;
  assert.equal((await fetch(url, { headers })).status, 401);
});

