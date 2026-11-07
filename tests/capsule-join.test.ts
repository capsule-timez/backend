import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

const databaseUrl = process.env.CAPSULE_JOIN_TEST_DATABASE_URL;

test('group invitations grant membership and protect the invitation code', {
  skip: !databaseUrl && 'Set CAPSULE_JOIN_TEST_DATABASE_URL to a migrated PostgreSQL test database.',
}, async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl!;
  process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
  process.env.API_PREFIX = '/api';
  const { prisma } = await import('../src/lib/prisma');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');

  const users = ['Owner', 'Member', 'Outsider'].map((name) => ({
    id: randomUUID(), name, email: `${randomUUID()}@example.com`, passhash: 'test',
  }));
  const [owner, member, outsider] = users;
  t.after(async () => {
    try {
      await prisma.capsule.deleteMany({ where: { creatorId: owner.id } });
      await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
    } finally {
      await prisma.$disconnect();
    }
  });
  await prisma.user.createMany({ data: users });

  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = (path: string, userId: string | null, body?: object) =>
    fetch(`http://127.0.0.1:${address.port}/api/capsules${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(userId && { Authorization: `Bearer ${generateToken(userId)}` }),
      },
      body: body && JSON.stringify(body),
    });

  const created = await request('', owner.id, {
    title: 'Grupo', text: 'Mensagem', recipientEmail: owner.email, type: 'GROUP',
    scheduleDate: new Date(Date.now() + 7200000).toISOString(),
    contributionDeadline: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(created.status, 201);
  const { id, inviteCode } = await created.json();
  const detail = (userId: string) => request(`/${id}`, userId);
  const join = (userId: string | null, code = inviteCode) => request('/join', userId, { inviteCode: code });

  assert.equal((await join(null)).status, 401);
  assert.equal((await join(member.id, 'unknown-code')).status, 404);
  assert.equal((await detail(member.id)).status, 404);
  assert.deepEqual((await (await request('', member.id)).json()).data, []);

  const roster = [{ name: 'Owner', role: 'OWNER' }, { name: 'Member', role: 'MEMBER' }];
  for (const joined of await Promise.all([join(member.id), join(member.id)])) {
    assert.equal(joined.status, 200);
    const capsule = await joined.json();
    assert.equal(capsule.id, id);
    assert.deepEqual(capsule.participants, roster);
    assert.equal('inviteCode' in capsule, false);
  }
  assert.equal(await prisma.capsuleMember.count({ where: { capsuleId: id } }), 2);
  assert.equal((await join(owner.id)).status, 200);
  const ownerDetail = await (await detail(owner.id)).json();
  assert.equal(ownerDetail.inviteCode, inviteCode);
  assert.deepEqual(ownerDetail.participants, roster);
  const memberDetail = await (await detail(member.id)).json();
  assert.deepEqual(memberDetail.participants, roster);
  assert.equal('inviteCode' in memberDetail, false);
  assert.equal((await detail(outsider.id)).status, 404);

  const { data } = await (await request('', member.id)).json();
  assert.equal(data.length, 1);
  assert.equal(data[0].id, id);
  assert.deepEqual(data[0].participants, roster);
  assert.equal('inviteCode' in data[0], false);
  assert.equal('inviteCode' in (await (await request('', owner.id)).json()).data[0], false);

  await prisma.capsule.update({ where: { id }, data: { contributionDeadline: new Date(Date.now() - 1000) } });
  const expired = await join(outsider.id);
  assert.equal(expired.status, 409);
  const error = await expired.json();
  assert.equal(error.code, 'CONTRIBUTION_DEADLINE_PASSED');
  assert.match(error.message, /prazo de contribuição.*já passou/);
  assert.equal(await prisma.capsuleMember.count({ where: { capsuleId: id } }), 2);
});
