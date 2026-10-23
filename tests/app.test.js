import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot, client, as } from './helpers.js';
import { isLoopback } from '../server/lib/network.js';

const root = path.join(import.meta.dirname, '..', 'client');
// The caching test needs a built client and is skipped without one.
const built = fs.existsSync(path.join(root, 'dist', 'index.html'));

let ctx;
before(async () => {
  ctx = await boot({ serveClient: built });
});
after(async () => {
  await ctx.close();
});

test('the installable app: manifest, icons and service worker', () => {
  const pub = path.join(root, 'public');
  const m = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const src of [...m.icons, ...m.shortcuts.flatMap((s) => s.icons), ...m.screenshots].map(
    (i) => i.src,
  ))
    assert.ok(fs.existsSync(path.join(pub, src)), `${src} is missing`);
  // Chrome's full install sheet needs a phone screenshot; desktop needs a wide one.
  assert.ok(m.screenshots.some((s) => s.form_factor === 'narrow'));
  assert.ok(m.screenshots.some((s) => s.form_factor === 'wide'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
  const sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');
  assert.match(
    sw,
    /pathname\.startsWith\('\/api\/'\)\) return/,
    'personal data under /api is never stored on the device',
  );
});

test('Play Store app link: off until the package and signing key are set', async () => {
  const site = ctx.base.replace(/\/api$/, '');
  const get = async () => {
    const r = await fetch(`${site}/.well-known/assetlinks.json`);
    return { status: r.status, type: r.headers.get('content-type'), body: await r.json() };
  };
  const saved = [process.env.ANDROID_PACKAGE, process.env.ANDROID_CERT_SHA256];
  const print = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');
  try {
    delete process.env.ANDROID_PACKAGE;
    delete process.env.ANDROID_CERT_SHA256;
    assert.equal((await get()).status, 404);
    // A malformed fingerprint is ignored rather than published.
    process.env.ANDROID_PACKAGE = 'com.brainadz.hrms';
    process.env.ANDROID_CERT_SHA256 = 'not-a-fingerprint';
    assert.equal((await get()).status, 404);
    process.env.ANDROID_CERT_SHA256 = `${print}, nope`;
    const r = await get();
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/json/);
    assert.equal(r.body[0].target.package_name, 'com.brainadz.hrms');
    assert.deepEqual(r.body[0].target.sha256_cert_fingerprints, [print.toUpperCase()]);
    assert.ok(r.body[0].relation.includes('delegate_permission/common.handle_all_urls'));
  } finally {
    if (saved[0] === undefined) delete process.env.ANDROID_PACKAGE;
    else process.env.ANDROID_PACKAGE = saved[0];
    if (saved[1] === undefined) delete process.env.ANDROID_CERT_SHA256;
    else process.env.ANDROID_CERT_SHA256 = saved[1];
  }
});

test('office Wi-Fi addresses for the phone QR code: signed-in people on the server computer only', async () => {
  assert.equal((await client(ctx.base).get('/meta/addresses')).status, 401);
  const hr = await as(ctx.base, 'priya.sharma@brainadz.com');
  const r = await hr.get('/meta/addresses');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.urls));
  for (const u of r.body.urls) assert.match(u, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
  // Loopback check that decides who counts as "on the server computer".
  assert.ok(isLoopback('127.0.0.1') && isLoopback('::1') && isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('192.168.1.20') && !isLoopback(''));
});

test(
  'the server keeps the app files fresh and the build files cached',
  { skip: !built && 'client not built' },
  async () => {
    const site = ctx.base.replace(/\/api$/, '');
    const head = async (p) => (await fetch(site + p)).headers;
    assert.equal((await head('/sw.js')).get('cache-control'), 'no-cache');
    const m = await head('/manifest.webmanifest');
    assert.equal(m.get('cache-control'), 'no-cache');
    assert.match(m.get('content-type'), /application\/manifest\+json/);
    // Hashed build assets never change, so they can be cached for good.
    const html = await (await fetch(`${site}/`)).text();
    const asset = html.match(/\/assets\/[^"]+\.js/)[0];
    assert.match((await head(asset)).get('cache-control'), /immutable/);
    assert.equal(
      (await head('/attendance')).get('cache-control'),
      'no-cache',
      'pages are the app shell, always checked',
    );
  },
);
