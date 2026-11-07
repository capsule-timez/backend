import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';

test('POST capsule: defaults to individual and creates groups with an owner', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');
  const owner = '3f1e2d4c-5b6a-4789-9abc-def012345679';
  const now = Date.now();
  const scheduleDate = new Date(now + 86400000).toISOString();
  const contributionDeadline = new Date(now + 3600000).toISOString();
  const payload = { title: 'Memórias', text: 'Uma mensagem', recipientEmail: 'test@example.com', scheduleDate };
  const writes: Parameters<typeof prisma.capsule.create>[0]['data'][] = [];
  const originalCreate = prisma.capsule.create;
  t.after(() => { prisma.capsule.create = originalCreate; });
  prisma.capsule.create = (async ({ data }: Parameters<typeof prisma.capsule.create>[0]) => {
    writes.push(data);
    const row = {
      ...data, id: owner, status: 'SCHEDULED', sentAt: null, createdAt: new Date(),
    };
    return row;
  }) as typeof prisma.capsule.create;
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await prisma.$disconnect(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (body: unknown, authenticated = true) => fetch(
    `http://127.0.0.1:${address.port}/api/capsules`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        ...(authenticated && { Authorization: `Bearer ${generateToken(owner)}` }) },
      body: JSON.stringify(body),
    },
  );

  assert.equal((await post(payload, false)).status, 401);
  for (const deadline of [undefined, new Date(now - 1000).toISOString(), scheduleDate,
    new Date(now + 172800000).toISOString(), '2099-01-01T12:00:00']) {
    const invalid = await post({ ...payload, type: 'GROUP', contributionDeadline: deadline });
    assert.equal(invalid.status, 422);
    const error = await invalid.json();
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.details[0].field, 'contributionDeadline');
  }
  assert.equal((await post({ ...payload, contributionDeadline })).status, 422);
  assert.equal(writes.length, 0);

  const individual = await post(payload);
  assert.equal(individual.status, 201);
  const individualBody = await individual.json();
  assert.equal(individualBody.type, 'INDIVIDUAL');
  assert.equal('inviteCode' in individualBody, false);
  assert.equal('contributionDeadline' in individualBody, false);
  assert.equal(writes[0].members, undefined);

  const groupPayload = { ...payload, type: 'GROUP', contributionDeadline };
  const group = await post(groupPayload);
  assert.equal(group.status, 201);
  const groupBody = await group.json();
  assert.equal(groupBody.type, 'GROUP');
  assert.equal(groupBody.contributionDeadline, contributionDeadline);
  assert.match(groupBody.inviteCode, /^[a-f0-9]{32}$/);
  assert.equal(groupBody.inviteCode, writes[1].inviteCode);
  assert.deepEqual(writes[1].members, { create: { userId: owner, role: 'OWNER' } });
  assert.equal('token' in groupBody, false);
  assert.equal('creatorId' in groupBody, false);
  assert.deepEqual(groupBody.files, []);

  const secondGroup = await post(groupPayload);
  assert.equal(secondGroup.status, 201);
  assert.notEqual((await secondGroup.json()).inviteCode, groupBody.inviteCode);
});
