import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

// Boots an app on a random port with a fresh demo database in a temp dir.
export async function boot({ serveClient = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-test-'));
  const { app, db } = createApp({ dbFile: path.join(dir, 'test.db'), dataDir: dir, serveClient });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  // Stops the server, closes the database and deletes the temp dir.
  const close = () =>
    new Promise((resolve) =>
      server.close(() => {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      }),
    );
  return { base, db, close };
}

// API client that keeps its cookies (session and device) and sends the X-Requested-With header.
// `device` pins the device cookie, to act as a particular phone.
export function client(base, { device } = {}) {
  const jar = device ? { hrms_device: device } : {};
  // Sends JSON or FormData and returns the status with a parsed body.
  const call = async (method, p, body, { form, headers = {} } = {}) => {
    const h = { 'X-Requested-With': 'hrms', ...headers };
    const cookie = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookie) h.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + p, { method, headers: h, body: payload });
    // Keep each cookie the server sets; Max-Age=0 removes it
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      if (/max-age=0/i.test(set)) delete jar[name];
      else jar[name] = pair.slice(i + 1).trim();
    }
    const type = res.headers.get('content-type') || '';
    return {
      status: res.status,
      body: type.includes('json') ? await res.json() : await res.text(),
    };
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

// A client already signed in as `email`.
export const as = (base, email, password, opts) => client(base, opts).login(email, password);
