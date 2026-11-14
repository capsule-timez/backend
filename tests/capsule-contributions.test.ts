import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test('group capsule contributions: participants only, before the deadline, immutable and visible', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { storage } = await import('../src/lib/storage');
  const { createApp } = await import('../src/app');
  const { generateToken } = await import('../src/lib/token');
  const owner = 'a82e2d4c-5b6a-4789-9abc-def012345678';
  const member = 'b82e2d4c-5b6a-4789-9abc-def012345678';
  const outsider = 'c82e2d4c-5b6a-4789-9abc-def012345678';
  const capsuleId = '3f1e2d4c-5b6a-4789-9abc-def012345678';
  const date = new Date('2026-11-13T12:00:00Z');
  const capsule = {
    status: 'SCHEDULED',
    contributionDeadline: new Date(Date.now() + 3_600_000) as Date | null,
  };
  const participants = new Set([owner, member]);
  const stored = new Map<string, { size: number; type: string }>();
  const removed: string[] = [];
  let failCreate = false;
  let created: Record<string, unknown>[] = [];

  prisma.capsule.findFirst = (async (args: {
    where: { id: string; type?: string; members?: { some: { userId: string } }; OR?: unknown };
    select: Record<string, unknown>;
  }) => {
    if (args.where.id !== capsuleId) return null;
    if ('OR' in args.where) {
      // Detalhe da capsula para um participante.
      return {
        id: capsuleId, titleContent: 'Grupo', textContent: 'Mensagem', recipientEmail: 'dest@example.com',
        scheduleDate: date, status: capsule.status, sentAt: null, createdAt: date, type: 'GROUP',
        inviteCode: 'code', members: [
          { userId: owner, role: 'OWNER', user: { name: 'Owner' } },
          { userId: member, role: 'MEMBER', user: { name: 'Member' } },
        ],
        files: [],
        contributions: created.map((contribution) => ({ ...contribution })),
      };
    }
    assert.equal(args.where.type, 'GROUP');
    const userId = args.where.members?.some.userId;
    if (!userId || !participants.has(userId)) return null;
    return { ...capsule };
  }) as unknown as typeof prisma.capsule.findFirst;

  prisma.capsuleContribution.create = (async (args: {
    data: { id: string; authorId: string; text: string | null; files: { create: Record<string, unknown>[] } };
  }) => {
    if (failCreate) throw new Error('db down');
    const contribution = {
      id: args.data.id,
      text: args.data.text,
      createdAt: date,
      author: { name: args.data.authorId === owner ? 'Owner' : 'Member' },
      files: args.data.files.create.map((file, index) => ({
        id: `file-${index}`, fileName: file.fileName, mimeType: file.mimeType,
        fileSize: file.fileSize, createdAt: date, objectKey: file.objectKey,
      })),
    };
    created.push(contribution);
    return contribution;
  }) as unknown as typeof prisma.capsuleContribution.create;

  storage.putObject = async (key, body, type) => { stored.set(key, { size: body.length, type }); };
  storage.removeObject = async (key) => { removed.push(key); stored.delete(key); };
  storage.downloadUrl = async (key) => ({ url: `http://minio/${key}?sig=1`, expiresAt: date });

  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await prisma.$disconnect(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/capsules/${capsuleId}`;
  const auth = (userId: string) => ({ Authorization: `Bearer ${generateToken(userId)}` });
  const sendJson = (body: unknown, userId = member) =>
    fetch(`${base}/contributions`, {
      method: 'POST',
      headers: { ...auth(userId), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const sendForm = (text: string | undefined, images: number, userId = member, type = 'image/png') => {
    const form = new FormData();
    if (text !== undefined) form.append('text', text);
    for (let index = 0; index < images; index++) {
      form.append('files', new Blob([new Uint8Array(PNG)], { type }), `foto-${index}.png`);
    }
    return fetch(`${base}/contributions`, { method: 'POST', headers: auth(userId), body: form });
  };

  // Texto puro em JSON.
  const textOnly = await sendJson({ text: '  Feliz aniversário!  ' });
  assert.equal(textOnly.status, 201);
  const textBody = await textOnly.json();
  assert.equal(textBody.text, 'Feliz aniversário!');
  assert.deepEqual(textBody.author, { name: 'Member' });
  assert.deepEqual(textBody.files, []);

  // Texto e imagens em multipart.
  const withImages = await sendForm('Olha essa foto', 2);
  assert.equal(withImages.status, 201);
  const imagesBody = await withImages.json();
  assert.equal(imagesBody.files.length, 2);
  assert.equal(stored.size, 2);
  for (const file of imagesBody.files) {
    assert.match(file.downloadUrl, new RegExp(`capsules/${capsuleId}/contributions/${imagesBody.id}/`));
    assert.equal('objectKey' in file, false);
  }

  // So imagens, sem texto.
  const imageOnly = await sendForm(undefined, 1);
  assert.equal(imageOnly.status, 201);
  assert.equal((await imageOnly.json()).text, null);

  // Limite de imagens por contribuicao.
  const tooMany = await sendForm('demais', 4);
  assert.equal(tooMany.status, 400);
  assert.equal(stored.size, 3);

  // Nem texto nem imagem.
  const empty = await sendJson({ text: '   ' });
  assert.equal(empty.status, 422);
  assert.equal((await empty.json()).details[0].field, 'text');
  assert.equal((await sendForm(undefined, 0)).status, 422);

  // Tipo de arquivo nao permitido.
  assert.equal((await sendForm('gif', 1, member, 'image/gif')).status, 415);

  // Quem nao participa nao enxerga a capsula.
  const outsiderResponse = await sendJson({ text: 'oi' }, outsider);
  assert.equal(outsiderResponse.status, 404);
  assert.equal((await outsiderResponse.json()).code, 'NOT_FOUND');
  assert.equal((await fetch(`${base.replace(capsuleId, 'nao-e-uuid')}/contributions`, {
    method: 'POST', headers: { ...auth(member), 'Content-Type': 'application/json' }, body: '{"text":"x"}',
  })).status, 404);

  // Falha ao gravar remove as imagens ja enviadas ao bucket.
  failCreate = true;
  const failed = await sendForm('falha', 2);
  assert.equal(failed.status, 500);
  assert.equal(removed.length, 2);
  assert.equal(stored.size, 3);
  failCreate = false;

  // Detalhe para participantes inclui as contribuicoes em ordem.
  const detail = await (await fetch(base, { headers: auth(member) })).json();
  assert.deepEqual(detail.contributions.map((item: { text: string | null }) => item.text),
    ['Feliz aniversário!', 'Olha essa foto', null]);
  assert.equal(detail.contributions[1].files.length, 2);
  assert.equal(JSON.stringify(detail).includes('objectKey'), false);

  // Contribuicoes nao podem ser editadas nem removidas.
  for (const method of ['PATCH', 'PUT', 'DELETE']) {
    const response = await fetch(`${base}/contributions/${textBody.id}`, {
      method, headers: { ...auth(member), 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{"text":"x"}',
    });
    assert.equal(response.status, 404);
  }

  // Prazo encerrado ou capsula ja processada.
  const before = created.length;
  capsule.contributionDeadline = new Date(Date.now() - 1000);
  const late = await sendJson({ text: 'atrasado' });
  assert.equal(late.status, 409);
  const lateError = await late.json();
  assert.equal(lateError.code, 'CONTRIBUTION_DEADLINE_PASSED');
  assert.match(lateError.message, /prazo de contribuição/);
  capsule.contributionDeadline = new Date(Date.now() + 3_600_000);
  capsule.status = 'SENT';
  assert.equal((await sendJson({ text: 'enviada' })).status, 409);
  assert.equal(created.length, before);
  created = [];
});

test('public capsule opening includes contributions only for group capsules', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { storage } = await import('../src/lib/storage');
  const { createApp } = await import('../src/app');
  const token = 'group-recipient-token';
  const hash = createHash('sha256').update(token).digest('hex');
  const date = new Date('2026-11-13T12:00:00Z');
  let type = 'GROUP';

  storage.downloadUrl = async (key) => ({ url: `http://minio/${key}?sig=1`, expiresAt: date });
  prisma.capsule.findFirst = (async (args: { where: { token: string }; select: Record<string, unknown> }) => {
    assert.deepEqual((args.select.files as { where: unknown }).where, { contributionId: null });
    if (args.where.token !== hash) return null;
    return {
      titleContent: 'Grupo', textContent: 'Mensagem', sentAt: date, type,
      creator: { name: 'Owner' }, files: [],
      contributions: [{
        id: 'contribution-1', text: 'Parabéns', createdAt: date, author: { name: 'Member' },
        files: [{ id: 'f1', fileName: 'a.png', mimeType: 'image/png', fileSize: 10, createdAt: date, objectKey: 'k/a.png' }],
      }],
    };
  }) as unknown as typeof prisma.capsule.findFirst;

  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.close(); await once(server, 'close'); await prisma.$disconnect(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/public/capsules/${token}`;

  const body = await (await fetch(url)).json();
  assert.deepEqual(body.contributions, [{
    id: 'contribution-1', text: 'Parabéns', createdAt: date.toISOString(), author: { name: 'Member' },
    files: [{ id: 'f1', fileName: 'a.png', mimeType: 'image/png', fileSize: 10, createdAt: date.toISOString(),
      downloadUrl: 'http://minio/k/a.png?sig=1', downloadUrlExpiresAt: date.toISOString() }],
  }]);
  type = 'INDIVIDUAL';
  assert.equal('contributions' in (await (await fetch(url)).json()), false);
});
