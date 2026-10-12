import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

// Boots an app on a random port with a fresh demo database in a temp dir.
export async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-test-'));
  const { app, db } = createApp({ dbFile: path.join(dir, 'test.db'), dataDir: dir, serveClient: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const close = () => new Promise((resolve) => server.close(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); resolve(); }));
  return { base, db, close };
}

export function client(base) {
  let cookie = '';
  const call = async (method, p, body, { form, headers = {} } = {}) => {
    const h = { 'X-Requested-With': 'hrms', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + p, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}, o) => call('POST', p, b, o),
    put: (p, b = {}) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    raw: call,
    async login(email, password = 'Brainadz@2026') {
      const r = await call('POST', '/auth/login', { email, password });
      if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
      return this;
    },
  };
}

export const as = (base, email, password) => client(base).login(email, password);
