import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';
process.env.MINIO_ROOT_USER = 'test-access-key';
process.env.MINIO_ROOT_PASSWORD = 'test-secret-key';
process.env.MINIO_ENDPOINT = 'localhost';
process.env.MINIO_API_PORT = '9000';
process.env.MINIO_USE_SSL = 'false';
process.env.MINIO_REGION = 'us-east-1';
process.env.MINIO_BUCKET = 'capsula';
process.env.MINIO_PRESIGNED_URL_TTL_SECONDS = '120';

test('public capsule: SHA-256 lookup, SENT only, private fields and expiring MinIO URLs', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { createApp } = await import('../src/app');
  const token = 'a-secret-public-token';
  const hash = createHash('sha256').update(token).digest('hex');
  let status = 'SENT';
  let withFiles = true;
  let requestedHash = '';
  prisma.capsule.findFirst = (async (args: {
    where: { token: string; status: string }; select: Record<string, unknown>;
  }) => {
    requestedHash = args.where.token;
    assert.equal(args.where.status, 'SENT');
    assert.equal('token' in args.select, false);
    assert.deepEqual(args.select.creator, { select: { name: true } });
    if (args.where.token !== hash || args.where.status !== status) return null;
    return {
      titleContent: 'Uma lembrança', textContent: 'Para o futuro',
      creator: { name: 'Maria' }, sentAt: new Date('2026-10-20T10:00:00Z'),
      files: withFiles ? [{ id: 'file-id', fileName: 'foto.jpg', mimeType: 'image/jpeg',
        fileSize: 123, createdAt: new Date('2026-10-01T10:00:00Z'),
        objectKey: 'capsules/private-photo.jpg' }] : [],
    };
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
  assert.equal(requestedHash, hash);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['creatorName', 'files', 'sentAt', 'text', 'title']);
  assert.equal(body.title, 'Uma lembrança');
  assert.equal(body.text, 'Para o futuro');
  assert.equal(body.sentAt, '2026-10-20T10:00:00.000Z');
  const file = body.files[0];
  assert.deepEqual(Object.keys(file).sort(), ['createdAt', 'downloadUrl', 'downloadUrlExpiresAt',
    'fileName', 'fileSize', 'id', 'mimeType']);
  const url = new URL(file.downloadUrl);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '120');
  assert.match(url.searchParams.get('X-Amz-Signature') ?? '', /^[a-f0-9]{64}$/);
  const signedDate = url.searchParams.get('X-Amz-Date')!;
  const issuedAt = new Date(signedDate.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z',
  ));
  assert.equal(Date.parse(file.downloadUrlExpiresAt) - issuedAt.getTime(), 120000);

  withFiles = false;
  assert.deepEqual((await (await fetch(base + token)).json()).files, []);
  const missing = await fetch(base + 'unknown');
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  for (status of ['SCHEDULED', 'FAILED']) {
    const unavailable = await fetch(base + token);
    assert.equal(unavailable.status, 404);
    assert.deepEqual(await unavailable.json(), missingBody);
  }
});
