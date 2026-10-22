import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, client, as } from './helpers.js';
import { isLoopback } from '../server/lib/network.js';

const root = path.join(import.meta.dirname, '..', 'client');
const built = fs.existsSync(path.join(root, 'dist', 'index.html'));

let ctx;
before(async () => { ctx = await boot({ serveClient: built }); });
after(async () => { await ctx.close(); });

test('the installable app: manifest, icons and service worker', () => {
  const pub = path.join(root, 'public');
  const m = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const src of [...m.icons, ...m.shortcuts.flatMap((s) => s.icons)].map((i) => i.src)) assert.ok(fs.existsSync(path.join(pub, src)), `${src} is missing`);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
  const sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)\) return/, 'personal data under /api is never stored on the device');
});

test('office Wi-Fi addresses for the phone QR code: signed-in people on the server computer only', async () => {
  assert.equal((await client(ctx.base).get('/meta/addresses')).status, 401);
  const hr = await as(ctx.base, 'priya.sharma@brainadz.com');
  const r = await hr.get('/meta/addresses');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.urls));
  for (const u of r.body.urls) assert.match(u, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
  assert.ok(isLoopback('127.0.0.1') && isLoopback('::1') && isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('192.168.1.20') && !isLoopback(''));
});

test('the server keeps the app files fresh and the build files cached', { skip: !built && 'client not built' }, async () => {
  const site = ctx.base.replace(/\/api$/, '');
  const head = async (p) => (await fetch(site + p)).headers;
  assert.equal((await head('/sw.js')).get('cache-control'), 'no-cache');
  const m = await head('/manifest.webmanifest');
  assert.equal(m.get('cache-control'), 'no-cache');
  assert.match(m.get('content-type'), /application\/manifest\+json/);
  const html = await (await fetch(`${site}/`)).text();
  const asset = html.match(/\/assets\/[^"]+\.js/)[0];
  assert.match((await head(asset)).get('cache-control'), /immutable/);
  assert.equal((await head('/attendance')).get('cache-control'), 'no-cache', 'pages are the app shell, always checked');
});
