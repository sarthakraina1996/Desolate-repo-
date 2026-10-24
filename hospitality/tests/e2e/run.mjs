// End-to-end journeys in a real browser (Playwright/Chromium) against the built client and a
// copy of the seeded demo, at desktop (1440×900) and tablet (1024×768) sizes:
//   1. sign in → dashboard first, navigation across the top (no left sidebar), no overflow
//   2. move between modules from the top navigation
//   3. a front-desk agent checks a guest in from the arrivals board
// Usage: npm run hos:e2e   (screenshots are written to hospitality/tests/e2e/output/)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/app.js';
import { templateDb, PASSWORD, U } from '../helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const out = path.join(here, 'output');
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(path.join(root, 'hospitality/client/dist/index.html'))) execSync('npm run hos:build', { cwd: root, stdio: 'inherit' });

const { chromium } = createRequire(import.meta.url)('playwright');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhos-e2e-'));
const dbFile = path.join(dir, 'e2e.db');
fs.copyFileSync(await templateDb(), dbFile);
const { app, db } = createApp({ dbFile, dataDir: dir, seed: 'none', serveClient: true });
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
async function journey(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// One confirmed arrival per viewport, assigned to an inspected room, ready to check in.
function readyArrival() {
  const r = db.get(
    `SELECT r.id, r.conf_no, rn.room_id FROM reservations r JOIN properties p ON p.id = r.property_id
     JOIN room_nights rn ON rn.reservation_id = r.id AND rn.night = p.business_date
     WHERE p.code = 'LGD' AND r.status = 'confirmed' AND r.arrival = p.business_date
       AND NOT EXISTS (SELECT 1 FROM room_nights o JOIN reservations x ON x.id = o.reservation_id
                       WHERE o.room_id = rn.room_id AND o.night = date(p.business_date, '-1 day') AND x.status = 'in_house')
       AND r.id NOT IN (SELECT value FROM json_each(?))
     ORDER BY r.id LIMIT 1`,
    JSON.stringify(used),
  );
  if (!r) throw new Error('No assignable arrival in the demo data');
  used.push(r.id);
  db.run("UPDATE rooms SET hk_status = 'inspected', dnd = 0 WHERE id = ?", r.room_id);
  return r;
}
const used = [];

const browser = await chromium.launch();
for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const signIn = async (email) => {
    await ctx.clearCookies();
    await page.goto(base);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForSelector('header.header');
  };

  await journey(`${vp.name}: sign in lands on the dashboard with top navigation`, async () => {
    await signIn(U.gmDelhi);
    await page.getByRole('heading', { name: 'Executive Dashboard' }).waitFor();
    await page.getByText('Occupancy').first().waitFor();
    const nav = await page.locator('nav.nav').boundingBox();
    expect(nav && nav.y < 64 && nav.width > nav.height * 4, `navigation is not a top bar: ${JSON.stringify(nav)}`);
    const first = (await page.locator('nav.nav a').first().innerText()).trim();
    expect(first === 'Dashboard', `first navigation item is "${first}"`);
    const sidebar = await page.evaluate(() =>
      [...document.querySelectorAll('aside, nav')].some((el) => {
        const r = el.getBoundingClientRect();
        return r.left < 5 && r.height > window.innerHeight * 0.6 && r.width < window.innerWidth / 3;
      }),
    );
    expect(!sidebar, 'a permanent left sidebar is present');
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    expect(overflow <= 1, `page scrolls horizontally by ${overflow}px`);
    await page.screenshot({ path: path.join(out, `${vp.name}-dashboard.png`) });
  });

  await journey(`${vp.name}: modules open from the top navigation`, async () => {
    for (const [label, heading, url] of [
      ['Calendar', 'Booking Calendar', '/calendar'],
      ['Front Desk', null, '/front-desk'],
      ['Housekeeping', 'Housekeeping Management', '/housekeeping'],
    ]) {
      const link = page.locator('nav.nav a', { hasText: label });
      if (await link.isVisible()) await link.click();
      else {
        await page.locator('nav.nav button', { hasText: 'More' }).click();
        await page.getByRole('menuitem', { name: label }).or(page.locator('a', { hasText: label })).first().click();
      }
      await page.waitForURL(`**${url}`);
      if (heading) await page.getByRole('heading', { name: heading }).waitFor();
    }
    await page.locator('.cal, .hk-tiles, table').first().waitFor();
    await page.screenshot({ path: path.join(out, `${vp.name}-housekeeping.png`) });
  });

  await journey(`${vp.name}: front desk checks a guest in from the arrivals board`, async () => {
    const r = readyArrival();
    await signIn(U.desk);
    await page.goto(`${base}/front-desk?tab=arrivals`);
    const row = page.locator('tr', { hasText: r.conf_no });
    await row.waitFor();
    await row.getByRole('button', { name: 'Check in' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const doc = dialog.getByLabel('Document number');
    if (await doc.count()) await doc.fill('P9876543');
    await dialog.getByRole('button', { name: 'Check in' }).click();
    await dialog.waitFor({ state: 'detached' });
    const status = db.value('SELECT status FROM reservations WHERE id = ?', r.id);
    expect(status === 'in_house', `reservation is ${status} after check-in`);
    await page.screenshot({ path: path.join(out, `${vp.name}-checked-in.png`) });
  });

  if (errors.length) results.push({ name: `${vp.name}: no page errors`, ok: false, error: errors.join('; ') });
  await ctx.close();
}
await browser.close();
await new Promise((r) => server.close(r));
db.close();
fs.rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} journeys passed; screenshots in ${path.relative(root, out)}/`);
process.exit(failed.length ? 1 : 0);
