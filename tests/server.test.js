import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { migrate, seedBasics } from '../core/setup.js';
import { seedDemo, demoEmail } from '../core/demo-seed.js';
import { hashPassword } from '../server/auth.js';

let server;
let base;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'bpm-test-'));
  const db = openDb(':memory:');
  migrate(db);
  seedBasics(db);
  seedDemo(db, { today: '2026-10-13', passwordHash: await hashPassword('demo1234') });
  const { app } = createApp({ db, dataDir, distDir: null });
  await new Promise((resolve) => (server = app.listen(0, resolve)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function login(key) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bpm': '1' },
    body: JSON.stringify({ email: demoEmail(key), password: 'demo1234' }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (p, init = {}) => fetch(base + p, { ...init, headers: { cookie, 'x-bpm': '1', ...(init.headers || {}) } });
}

test('wrong password is refused and the API needs a session', async () => {
  const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bpm': '1' }, body: JSON.stringify({ email: demoEmail('rohan'), password: 'nope' }) });
  assert.equal(bad.status, 401);
  assert.equal((await fetch(`${base}/projects`)).status, 401);
});

test('writes without the app header are blocked', async () => {
  const as = await login('rohan');
  const { items } = await (await as('/projects')).json();
  const res = await as(`/projects/${items[0].id}/tasks`, { method: 'POST', headers: { 'x-bpm': '', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }) });
  assert.equal(res.status, 403);
});

test('uploaded files download for the vertical and stay hidden from others', async () => {
  const rohan = await login('rohan');
  const { items } = await (await rohan('/projects')).json();
  const pid = items[0].id;
  const fd = new FormData();
  fd.append('file', new Blob(['booth spec'], { type: 'text/plain' }), 'Booth spec.txt');
  fd.append('category', 'Brief');
  const up = await rohan(`/projects/${pid}/upload`, { method: 'POST', body: fd });
  assert.equal(up.status, 200);
  const file = await up.json();
  assert.equal(file.name, 'Booth spec.txt');

  const dl = await rohan(`/files/${file.id}/download`);
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), 'booth spec');
  assert.match(dl.headers.get('content-disposition'), /attachment/);

  const kavita = await login('kavita');
  assert.equal((await kavita(`/files/${file.id}/download`)).status, 404);
  assert.equal((await kavita(`/projects/${pid}`)).status, 404);

  const del = await rohan(`/files/${file.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await rohan(`/files/${file.id}/download`)).status, 404);
});

test('viewers cannot upload', async () => {
  const vikram = await login('vikram');
  const { items } = await (await vikram('/projects')).json();
  const fd = new FormData();
  fd.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
  const res = await vikram(`/projects/${items[0].id}/upload`, { method: 'POST', body: fd });
  assert.equal(res.status, 403);
});
