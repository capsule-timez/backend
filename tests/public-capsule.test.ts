import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';

test('public capsule: hashed lookup, SENT only, signed files and indistinguishable 404s', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { storage } = await import('../src/lib/storage');
  const { logger } = await import('../src/lib/logger');
  const { createApp } = await import('../src/app');
  const token = 'secret-recipient-token';
  const hash = createHash('sha256').update(token).digest('hex');
  const date = new Date('2026-10-01T12:00:00Z');
  const file = { id: 'file-id', fileName: 'foto.jpg', mimeType: 'image/jpeg',
    fileSize: 123, createdAt: date };
  let status = 'SENT';
  let withFiles = true;
  let signed = 0;
  const warnings: string[] = [];
  const originalWarn = logger.warn;
  logger.warn = (message) => { warnings.push(message); };
  t.after(() => { logger.warn = originalWarn; });
  storage.downloadUrl = async (key) => {
    signed++;
    assert.equal(key, 'private/photo.jpg');
    return { url: 'https://minio.example/photo.jpg?X-Amz-Signature=test', expiresAt: date };
  };
  prisma.capsule.findFirst = (async (args: {
    where: { token: string; status: string }; select: Record<string, unknown>;
  }) => {
    assert.equal(args.where.status, 'SENT');
    assert.equal('token' in args.select, false);
    assert.deepEqual(args.select.creator, { select: { name: true } });
    if (args.where.token !== hash || status !== args.where.status) return null;
    return { titleContent: 'Carta', textContent: 'Para o futuro', sentAt: date,
      creator: { name: 'Maria' }, token: hash, recipientEmail: 'private@example.com',
      files: withFiles ? [{ ...file, objectKey: 'private/photo.jpg' }] : [] };
  }) as typeof prisma.capsule.findFirst;
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await prisma.$disconnect(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/public/capsules/`;
  const response = await fetch(base + token);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const body = await response.json();
  assert.deepEqual(body, { title: 'Carta', text: 'Para o futuro', creatorName: 'Maria',
    sentAt: date.toISOString(), files: [{ ...file, createdAt: date.toISOString(),
      downloadUrl: 'https://minio.example/photo.jpg?X-Amz-Signature=test',
      downloadUrlExpiresAt: date.toISOString() }] });
  assert.equal(JSON.stringify(body).includes(hash), false);
  assert.equal(JSON.stringify(body).includes('objectKey'), false);
  assert.equal(signed, 1);
  withFiles = false;
  assert.deepEqual((await (await fetch(base + token)).json()).files, []);
  const missing = await fetch(base + 'unknown');
  assert.equal(missing.status, 404);
  const error = await missing.json();
  assert.equal(error.code, 'NOT_FOUND');
  for (status of ['SCHEDULED', 'FAILED']) {
    const unavailable = await fetch(base + token);
    assert.equal(unavailable.status, 404);
    assert.deepEqual(await unavailable.json(), error);
  }
  assert.equal(signed, 1);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every((message) => message.includes('[redacted]') && !message.includes(token)));
});
