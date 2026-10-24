// Test harness: boots the app on a random port with a copy of a seeded demo database. The
// seeded template is built once per code version (hash of the server sources) and shared by
// every test file, so suites do not re-run the simulation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db/connection.js';
import { seedDemo } from '../server/seed/demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TODAY = '2026-10-24';
export const PASSWORD = 'Hospitality@2026';

function sourceHash() {
  const h = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.js')) h.update(p).update(fs.readFileSync(p));
    }
  };
  walk(path.join(here, '..', 'server'));
  return h.digest('hex').slice(0, 16);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Path of the seeded template database, building it if needed (one process builds, others wait).
export async function templateDb(profile = 'test') {
  const file = path.join(os.tmpdir(), `bhos-template-${profile}-${TODAY}-${sourceHash()}.db`);
  if (fs.existsSync(file)) return file;
  const lock = `${file}.lock`;
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch {
    for (let i = 0; i < 1200 && !fs.existsSync(file); i++) await sleep(250);
    if (fs.existsSync(file)) return file;
    throw new Error('Timed out waiting for the seeded template database');
  }
  try {
    const tmp = `${file}.building`;
    fs.rmSync(tmp, { force: true });
    const db = openDb(tmp);
    seedDemo(db, { profile, today: TODAY });
    db.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    fs.renameSync(tmp, file);
    for (const f of [`${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
    return file;
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

// Boots an app. seed: 'demo' (copy of the template), 'empty' or 'none' (blank schema).
export async function boot({ seed = 'demo' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhos-test-'));
  const dbFile = path.join(dir, 'test.db');
  if (seed === 'demo') fs.copyFileSync(await templateDb(), dbFile);
  const { app, db } = createApp({ dbFile, dataDir: dir, seed: seed === 'demo' ? 'none' : seed, serveClient: false });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
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

// API client with a cookie jar and the CSRF header.
export function client(base) {
  const jar = {};
  const call = async (method, p, body, { headers = {} } = {}) => {
    const h = { 'X-Requested-With': 'bhos', ...headers };
    const cookie = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookie) h.Cookie = cookie;
    let payload;
    if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + p, { method, headers: h, body: payload });
    for (const set of res.headers.getSetCookie()) {
      const [pair] = set.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      if (/max-age=0/i.test(set)) delete jar[name];
      else jar[name] = pair.slice(i + 1).trim();
    }
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return {
    get: (p, o) => call('GET', p, undefined, o),
    post: (p, b = {}, o) => call('POST', p, b, o),
    put: (p, b = {}, o) => call('PUT', p, b, o),
    del: (p) => call('DELETE', p),
    raw: call,
    async login(email, password = PASSWORD) {
      const r = await call('POST', '/auth/login', { email, password });
      if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
      this.me = r.body;
      return this;
    },
  };
}

export const as = (base, email, password) => client(base).login(email, password);

// Demo logins by role.
export const U = {
  owner: 'rohan.mehra@lumora.demo',
  ceo: 'ananya.iyer@lumora.demo',
  cfo: 'kabir.sethi@lumora.demo',
  finance: 'priya.nair@lumora.demo',
  revenue: 'arjun.malhotra@lumora.demo',
  admin: 'neha.kulkarni@lumora.demo',
  gmDelhi: 'sanjay.verma@lumora.demo',
  gmLisbon: 'ines.carvalho@lumora.demo',
  fom: 'kavya.reddy@lumora.demo',
  desk: 'rahul.sharma@lumora.demo',
  deskLisbon: 'tiago.martins@lumora.demo',
  hkManager: 'lakshmi.menon@lumora.demo',
  attendant: 'anita.sharma@lumora.demo',
  attendant2: 'raj.kumar@lumora.demo',
  fnb: 'aman.bhatia@lumora.demo',
  banquet: 'ritu.arora@lumora.demo',
};

export const ok = (r, status = 200) => {
  if (r.status !== status) throw new Error(`Expected ${status}, got ${r.status}: ${JSON.stringify(r.body).slice(0, 500)}`);
  return r.body;
};
