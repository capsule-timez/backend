import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test('capsule upload stores images for the owner of a SCHEDULED capsule and rejects invalid files', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { storage } = await import('../src/lib/storage');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');
  const owner = 'a82e2d4c-5b6a-4789-9abc-def012345678';
  const other = 'b82e2d4c-5b6a-4789-9abc-def012345678';
  const open = '3f1e2d4c-5b6a-4789-9abc-def012345678';
  const sent = '4f1e2d4c-5b6a-4789-9abc-def012345678';
  const full = '5f1e2d4c-5b6a-4789-9abc-def012345678';
  const capsules: Record<string, { status: string; files: number }> = {
    [open]: { status: 'SCHEDULED', files: 0 },
    [sent]: { status: 'SENT', files: 0 },
    [full]: { status: 'SCHEDULED', files: 5 },
  };
  const stored = new Map<string, { size: number; type: string }>();
  const created = new Date('2026-10-09T12:00:00Z');

  prisma.capsule.findFirst = (async (args: { where: { id: string; creatorId: string } }) => {
    const capsule = capsules[args.where.id];
    if (!capsule || args.where.creatorId !== owner) return null;
    return { status: capsule.status, _count: { files: capsule.files } };
  }) as unknown as typeof prisma.capsule.findFirst;
  prisma.capsuleFile.create = (async (args: { data: Record<string, unknown> }) => ({
    id: 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f',
    createdAt: created,
    ...args.data,
  })) as unknown as typeof prisma.capsuleFile.create;
  storage.putObject = async (key, body, type) => { stored.set(key, { size: body.length, type }); };
  storage.removeObject = async (key) => { stored.delete(key); };
  storage.downloadUrl = async (key) => ({ url: `http://minio/${key}?sig=1`, expiresAt: created });

  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await prisma.$disconnect(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/capsules`;
  const upload = (id: string, body: Buffer, type: string, name = 'foto.png', userId = owner) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(body)], { type }), name);
    return fetch(`${base}/${id}/files`, { method: 'POST', headers: { Authorization: `Bearer ${generateToken(userId)}` }, body: form });
  };

  const ok = await upload(open, PNG, 'image/png');
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(body.fileName, 'foto.png');
  assert.equal(body.mimeType, 'image/png');
  assert.equal(body.fileSize, PNG.length);
  assert.ok(body.downloadUrl.startsWith(`http://minio/capsules/${open}/`));
  assert.equal('objectKey' in body, false);
  assert.equal(stored.size, 1);

  const notImage = await upload(open, Buffer.from('%PDF-1.4'), 'application/pdf', 'doc.pdf');
  assert.equal(notImage.status, 415);
  assert.equal((await notImage.json()).code, 'UNSUPPORTED_MEDIA_TYPE');

  const fake = await upload(open, Buffer.from('not really a png'), 'image/png');
  assert.equal(fake.status, 415);

  const big = await upload(open, Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'image/png');
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, 'FILE_TOO_LARGE');

  assert.equal((await upload(open, PNG, 'image/png', 'foto.png', other)).status, 404);
  assert.equal((await upload(open, PNG, 'image/png', 'foto.png', owner)).status, 201);
  assert.equal((await upload('3f1e2d4c-5b6a-4789-9abc-000000000000', PNG, 'image/png')).status, 404);
  assert.equal((await upload('invalid-id', PNG, 'image/png')).status, 404);

  const closed = await upload(sent, PNG, 'image/png');
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).code, 'CAPSULE_NOT_EDITABLE');

  const limit = await upload(full, PNG, 'image/png');
  assert.equal(limit.status, 409);
  assert.equal((await limit.json()).code, 'FILE_LIMIT_REACHED');
  assert.equal(stored.size, 2);

  const noFile = await fetch(`${base}/${open}/files`, { method: 'POST', headers: { Authorization: `Bearer ${generateToken(owner)}` }, body: new FormData() });
  assert.equal(noFile.status, 400);
  assert.equal((await fetch(`${base}/${open}/files`, { method: 'POST' })).status, 401);
});
