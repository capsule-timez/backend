import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
process.env.API_PREFIX = '/api';
process.env.RESEND_API_KEY = 're_test_key';
process.env.WEB_URL = 'https://capsula.example.com/';

test('send job emails an open link, stores only the token hash and never sends twice', async (t) => {
  const { prisma } = await import('../src/lib/prisma');
  const { hashAccessToken } = await import('../src/lib/accessToken');
  const { sendScheduledCapsules } = await import('../src/jobs/sendScheduledCapsules.job');
  const date = new Date('2026-10-09T12:00:00Z');
  const ok = '3f1e2d4c-5b6a-4789-9abc-def012345678';
  const claimed = '4f1e2d4c-5b6a-4789-9abc-def012345678';
  const failing = '5f1e2d4c-5b6a-4789-9abc-def012345678';
  const capsule = (id: string, recipientEmail: string) => ({
    id, titleContent: `Titulo ${id}`, textContent: 'Mensagem', recipientEmail, scheduleDate: date, status: 'SCHEDULED', token: 'old-hash',
  });
  const rows = new Map([
    [ok, capsule(ok, 'ok@example.com')],
    [claimed, capsule(claimed, 'claimed@example.com')],
    [failing, capsule(failing, 'fail@example.com')],
  ]);

  prisma.capsule.findMany = (async () => [...rows.values()].filter((row) => row.status === 'SCHEDULED').map((row) => ({ ...row }))) as unknown as typeof prisma.capsule.findMany;
  prisma.capsule.updateMany = (async (args: { where: { id: string; status: string }; data: { status: string; token: string } }) => {
    const row = rows.get(args.where.id);
    if (args.where.id === claimed && row) row.status = 'SENT';
    if (!row || row.status !== args.where.status) return { count: 0 };
    Object.assign(row, args.data);
    return { count: 1 };
  }) as unknown as typeof prisma.capsule.updateMany;
  prisma.capsule.update = (async (args: { where: { id: string }; data: { status: string } }) => {
    Object.assign(rows.get(args.where.id)!, args.data);
    return rows.get(args.where.id);
  }) as unknown as typeof prisma.capsule.update;

  const sent: { to: string; text: string; html: string }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as { to: string; text: string; html: string };
    if (body.to === 'fail@example.com') {
      return new Response(JSON.stringify({ name: 'validation_error', message: 'invalid' }), { status: 422, headers: { 'content-type': 'application/json' } });
    }
    sent.push(body);
    return new Response(JSON.stringify({ id: 'email-id' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const logs: string[] = [];
  const capture = (...args: unknown[]) => { logs.push(args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ')); };
  t.mock.method(console, 'log', capture);
  t.mock.method(console, 'error', capture);
  t.after(async () => { globalThis.fetch = originalFetch; await prisma.$disconnect(); });

  await sendScheduledCapsules();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ok@example.com');
  const match = /https:\/\/capsula\.example\.com\/c\/([A-Za-z0-9_-]{43})/.exec(sent[0].text);
  assert.ok(match, 'o texto do e-mail deve conter o link de abertura');
  const token = match[1];
  assert.ok(sent[0].html.includes(`href="https://capsula.example.com/c/${token}"`));
  assert.equal(rows.get(ok)!.token, hashAccessToken(token));
  assert.equal(rows.get(ok)!.status, 'SENT');
  assert.equal(rows.get(claimed)!.token, 'old-hash');
  assert.equal(rows.get(failing)!.status, 'FAILED');
  assert.equal(logs.some((line) => line.includes(token)), false);

  await sendScheduledCapsules();
  assert.equal(sent.length, 1);
});
