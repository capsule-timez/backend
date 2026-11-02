import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';

test('PATCH capsule: partial updates, ownership, status, auth and contract validation', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');
  const id = '3f1e2d4c-5b6a-4789-9abc-def012345678';
  const owner = '3f1e2d4c-5b6a-4789-9abc-def012345679';
  let exists = true;
  let writes = 0;
  const capsule = { id, titleContent: 'Original', textContent: 'Texto original',
    recipientEmail: 'old@example.com', scheduleDate: new Date(Date.now() + 86400000),
    status: 'SCHEDULED', sentAt: null, createdAt: new Date(), files: [] };
  prisma.capsule.updateManyAndReturn = (async ({ where, data, select }: {
    where: { id: string; creatorId: string; status: string }; data: object; select: Record<string, unknown>;
  }) => {
    writes++;
    assert.equal(where.status, 'SCHEDULED');
    assert.equal('files' in select, false);
    if (!exists || where.id !== id || where.creatorId !== owner || capsule.status !== where.status) return [];
    Object.assign(capsule, data);
    return [{ ...capsule }];
  }) as typeof prisma.capsule.updateManyAndReturn;
  prisma.capsuleFile.findMany = (async () => []) as typeof prisma.capsuleFile.findMany;
  prisma.capsule.findFirst = (async ({ where }: { where: { id: string; creatorId: string } }) =>
    exists && where.id === id && where.creatorId === owner ? { status: capsule.status } : null
  ) as typeof prisma.capsule.findFirst;
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await prisma.$disconnect(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const patch = (body: unknown, user: string | null = owner, capsuleId = id) =>
    fetch(`http://127.0.0.1:${address.port}/api/capsules/${capsuleId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json',
        ...(user && { Authorization: `Bearer ${generateToken(user)}` }) },
      body: JSON.stringify(body),
    });
  assert.equal((await patch({ title: 'Novo' }, null)).status, 401);
  assert.equal(writes, 0);
  const originalDate = capsule.scheduleDate.toISOString();
  const response = await patch({ title: 'Novo' });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.title, 'Novo');
  assert.equal(updated.text, 'Texto original');
  assert.equal(updated.recipientEmail, 'old@example.com');
  assert.equal(updated.scheduleDate, originalDate);
  assert.deepEqual(updated.files, []);
  assert.equal('token' in updated, false);
  assert.equal('creatorId' in updated, false);
  const scheduleDate = new Date(Date.now() + 172800000).toISOString();
  const full = await patch({ title: 'Outro', text: 'Novo texto', recipientEmail: 'new@example.com', scheduleDate });
  assert.equal(full.status, 200);
  assert.equal((await full.json()).recipientEmail, 'new@example.com');
  assert.equal(capsule.scheduleDate.toISOString(), scheduleDate);
  for (capsule.status of ['SENT', 'FAILED']) {
    const conflict = await patch({ title: 'Proibido' });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, 'CAPSULE_NOT_EDITABLE');
    assert.equal(capsule.titleContent, 'Outro');
    assert.equal((await patch({ title: 'Outro' }, id)).status, 404);
  }
  exists = false;
  assert.equal((await patch({ title: 'Ausente' })).status, 404);
  assert.equal((await patch({ title: 'Ausente' }, owner, 'invalid-id')).status, 404);
  const beforeInvalid = writes;
  for (const body of [{}, { title: '' }, { title: 'a'.repeat(121) }, { text: '' },
    { text: 'a'.repeat(10001) }, { recipientEmail: 'invalid' }, { title: null },
    { scheduleDate: new Date(Date.now() - 1000).toISOString() },
    { scheduleDate: new Date(Date.now() + 30000).toISOString() },
    { scheduleDate: '2099-01-01T12:00:00' }, { scheduleDate: 123 }, { status: 'SENT' }]) {
    const invalid = await patch(body);
    assert.equal(invalid.status, 422);
    const error = await invalid.json();
    assert.equal(error.status, 'error');
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.ok(error.details.length > 0);
    assert.equal(typeof error.details[0].field, 'string');
    assert.equal(typeof error.details[0].message, 'string');
  }
  assert.equal(writes, beforeInvalid);
});
