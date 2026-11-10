import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

// Boots an app on a random port with a fresh demo database in a temp dir.
export async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bae-test-'));
  const { app, db, ctx } = createApp({ dbFile: path.join(dir, 'test.db'), dataDir: dir, serveClient: false, env: {} });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const close = () =>
    new Promise((resolve) =>
      server.close(() => {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      }),
    );
  return { base, db, ctx, close };
}

// API client that signs in the way the native apps do (bearer token).
export function client(base) {
  let token = null;
  const call = async (method, p, body, headers = {}) => {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    let payload;
    if (body !== undefined && !Buffer.isBuffer(body)) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    } else payload = body;
    const res = await fetch(base + p, { method, headers: h, body: payload });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}, h) => call('POST', p, b, h),
    put: (p, b = {}) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    setToken: (t) => (token = t),
    async login(email, password = 'Events@2026') {
      const r = await call('POST', '/auth/login', { email, password, client: 'android' });
      if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
      token = r.body.token;
      return this;
    },
    // Passwordless sign-in; the local email adapter returns the code in the demo.
    async code(email) {
      const sent = await call('POST', '/auth/code', { email });
      const r = await call('POST', '/auth/code/verify', { email, code: sent.body.demoCode, client: 'ios' });
      if (r.status !== 200) throw new Error(`code sign-in failed for ${email}: ${JSON.stringify(r.body)}`);
      token = r.body.token;
      return this;
    },
  };
}
export const as = (base, email) => client(base).login(email);
