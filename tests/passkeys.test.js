import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as } from './helpers.js';
import { softPasskey } from './webauthn.js';

let ctx;
let origin;
before(async () => {
  ctx = await boot();
  origin = new URL(ctx.base).origin;
});
after(async () => {
  await ctx.close();
});

const PW = 'Brainadz@2026';
const EMP = 'aarav.mehta@brainadz.com';
const CEO = 'rajiv.malhotra@brainadz.com';
const HR = 'priya.sharma@brainadz.com';
const MGR = 'vikram.patel@brainadz.com';
const empKey = softPasskey();

// Stops a running clock and returns what the next check-in must include (a reason when resuming).
async function readyToCheckIn(c) {
  let w = (await c.get('/attendance/workday')).body.workday;
  if (w.openSince) assert.equal((await c.post('/attendance/check-out')).status, 200);
  w = (await c.get('/attendance/workday')).body.workday;
  return w.sessions.length ? { gap_reason: 'Lunch break' } : {};
}

// Runs the "confirm it's you" prompt with the given passkey.
async function confirm(c, key) {
  const opts = await c.post('/passkeys/verify/options');
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  return c.post('/passkeys/verify', key.sign(opts.body, origin));
}

const notes = async (c) => (await c.get('/notifications')).body.items.map((n) => n.text);
const userId = (email) => ctx.db.value('SELECT id FROM users WHERE email = ?', email);

test('when HR turns it on, check-in needs fingerprint check-in to be set up', async () => {
  const admin = await as(ctx.base, CEO);
  assert.equal((await admin.put('/settings', { geofence: { verifyCheckIn: true } })).status, 200);
  const emp = await as(ctx.base, EMP);
  const r = await emp.post('/attendance/check-in', await readyToCheckIn(emp));
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'verify_setup');
  const me = (await emp.get('/passkeys/me')).body;
  assert.equal(me.required, true);
  assert.equal(me.registered, false);
});

test('setting it up counts once; every later check-in needs the fingerprint again', async () => {
  const emp = await as(ctx.base, EMP);
  const opts = await emp.post('/passkeys/register/options');
  assert.equal(opts.status, 200);
  const reg = await emp.post('/passkeys/register', empKey.register(opts.body, origin));
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  assert.ok((await notes(emp)).some((t) => t.startsWith('Fingerprint check-in was set up')));
  // The setup itself confirmed it's them, for one check-in
  assert.equal((await emp.post('/attendance/check-in', await readyToCheckIn(emp))).status, 200);
  // Next time, no fingerprint, no check-in
  let r = await emp.post('/attendance/check-in', await readyToCheckIn(emp));
  assert.equal(r.body.code, 'verify_required');
  assert.equal((await confirm(emp, empKey)).status, 200);
  assert.equal((await emp.post('/attendance/check-in', await readyToCheckIn(emp))).status, 200);
  // A confirmation is good for one check-in only
  r = await emp.post('/attendance/check-in', await readyToCheckIn(emp));
  assert.equal(r.body.code, 'verify_required');
  const mine = (await emp.get('/attendance/locations?view=mine')).body.items;
  assert.ok(mine.some((x) => x.event === 'check-in' && /Fingerprint confirmed/.test(x.note)));
});

test("a colleague who knows the password can't check in for them", async () => {
  // Signs in as the employee on their own phone, with their own passkey
  const colleague = await as(ctx.base, EMP, PW, { device: 'c'.repeat(32) });
  const theirKey = softPasskey();
  let r = await confirm(colleague, theirKey);
  assert.equal(r.status, 403);
  // Can't add their own passkey either: one per person, and HR has to reset it
  r = await colleague.post('/passkeys/register/options');
  assert.equal(r.status, 409);
  r = await colleague.post('/attendance/check-in', await readyToCheckIn(colleague));
  assert.equal(r.body.code, 'verify_required');
});

test("someone else's passkey, a replayed answer or a skipped fingerprint is refused", async () => {
  // HR sets up their own passkey, then tries to use the employee's
  const hr = await as(ctx.base, HR);
  const hrKey = softPasskey();
  const opts = (await hr.post('/passkeys/register/options')).body;
  assert.equal((await hr.post('/passkeys/register', hrKey.register(opts, origin))).status, 200);
  assert.equal((await confirm(hr, empKey)).status, 403);
  // Replaying an answer: the prompt it answered is used up
  const emp = await as(ctx.base, EMP);
  const vOpts = (await emp.post('/passkeys/verify/options')).body;
  const answer = empKey.sign(vOpts, origin);
  assert.equal((await emp.post('/passkeys/verify', answer)).status, 200);
  assert.equal((await emp.post('/passkeys/verify', answer)).status, 400);
  // A phone that didn't check the fingerprint can't be set up
  const mgr = await as(ctx.base, MGR);
  const noBio = softPasskey({ verified: false });
  const mOpts = (await mgr.post('/passkeys/register/options')).body;
  assert.equal((await mgr.post('/passkeys/register', noBio.register(mOpts, origin))).status, 400);
});

test('HR sees who has set it up and can reset it; the person is told', async () => {
  const hr = await as(ctx.base, HR);
  const list = (await hr.get('/passkeys')).body;
  assert.equal(list.required, true);
  const emp = list.items.find((x) => x.email === EMP);
  assert.equal(emp.registered, true);
  assert.ok(emp.label);
  const r = await hr.del(`/passkeys/user/${userId(EMP)}`);
  assert.equal(r.body.removed, 1);
  const empClient = await as(ctx.base, EMP);
  assert.equal((await empClient.get('/passkeys/me')).body.registered, false);
  assert.ok((await notes(empClient)).some((t) => t.startsWith('HR reset your fingerprint')));
  // Employees can't see or reset anyone's
  assert.equal((await empClient.get('/passkeys')).status, 403);
  assert.equal((await empClient.del(`/passkeys/user/${userId(HR)}`)).status, 403);
});

test('a sign-in from a new device alerts the account owner', async () => {
  const phone = '1'.repeat(32);
  const laptop = '2'.repeat(32);
  const ceo = (device) => as(ctx.base, CEO, PW, { device });
  const alerts = async (c) => (await notes(c)).filter((t) => t.startsWith('New sign-in')).length;
  // The very first device isn't news, and the same device again isn't either
  let c = await ceo(phone);
  const before = await alerts(c);
  c = await ceo(phone);
  assert.equal(await alerts(c), before);
  c = await ceo(laptop);
  assert.equal(await alerts(c), before + 1);
});

test('one phone checking in two people is flagged for HR', async () => {
  const admin = await as(ctx.base, CEO);
  assert.equal((await admin.put('/settings', { geofence: { verifyCheckIn: false } })).status, 200);
  const phone = 'a'.repeat(32);
  const emp = await as(ctx.base, EMP, PW, { device: phone });
  assert.equal((await emp.post('/attendance/check-in', await readyToCheckIn(emp))).status, 200);
  const mgr = await as(ctx.base, MGR, PW, { device: phone });
  assert.equal((await mgr.post('/attendance/check-in', await readyToCheckIn(mgr))).status, 200);
  const hr = await as(ctx.base, HR);
  assert.ok((await notes(hr)).some((t) => t.startsWith('Shared device: Vikram Patel')));
  const log = (await hr.get('/attendance/locations?view=team')).body;
  const shared = log.items.filter((x) => x.shared);
  assert.ok(shared.some((x) => x.email === EMP && x.sharedWith.includes('Vikram Patel')));
  assert.ok(shared.some((x) => x.email === MGR && x.sharedWith.includes('Aarav Mehta')));
  assert.ok(log.summary.shared >= 2);
  // The raw device id is never sent to the browser
  assert.ok(log.items.every((x) => !('device' in x)));
});
