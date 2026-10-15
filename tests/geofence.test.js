import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, as } from './helpers.js';
import { distanceM, ipMatches } from '../server/services/geofence.js';

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await ctx.close(); });

const PW = 'Brainadz@2026';
const EMP = 'aarav.mehta@brainadz.com';
const HR = 'priya.sharma@brainadz.com';
const CEO = 'rajiv.malhotra@brainadz.com';
const MGR = 'vikram.patel@brainadz.com';
const OFFICE = { lat: 12.9784, lng: 77.6408 };
const INSIDE = { lat: 12.9786, lng: 77.6411, accuracy: 25 }; // about 40 m away
const HOME = { lat: 12.9352, lng: 77.6245, accuracy: 30 }; // Koramangala, about 5 km away

const signIn = (body) => client(ctx.base).post('/auth/login', body);

test('distance and network helpers', () => {
  assert.ok(Math.abs(distanceM(OFFICE, INSIDE) - 40) < 10);
  assert.ok(distanceM(OFFICE, HOME) > 4500);
  assert.ok(ipMatches('::ffff:192.168.1.42', '192.168.1.0/24'));
  assert.ok(ipMatches('203.0.113.7', '10.0.0.0/8, 203.0.113.7'));
  assert.ok(!ipMatches('192.168.2.1', '192.168.1.0/24'));
  assert.ok(!ipMatches('', '192.168.1.0/24'));
});

test('HR sets up offices and turns on office-only sign-in', async () => {
  const hr = await as(ctx.base, HR);
  const offices = (await hr.get('/settings/offices')).body;
  assert.equal(offices.policy.mode, 'off');
  assert.ok(offices.offices.some((o) => o.name === 'Bengaluru office'));
  assert.equal((await hr.post('/settings/offices', { name: 'Bad', lat: 95, lng: 77 })).status, 400);
  assert.equal((await hr.post('/settings/offices', { name: 'Bad', lat: 12, lng: 77, ip_ranges: 'not-an-ip' })).status, 400);
  assert.equal((await hr.put('/settings', { geofence: { mode: 'sometimes' } })).status, 400);
  assert.equal((await hr.put('/settings', { geofence: { mode: 'login' } })).status, 200);
  assert.equal((await client(ctx.base).get('/auth/config')).body.officeOnly, true);
  const emp = await as(ctx.base, EMP).catch(() => null);
  assert.equal(emp, null, 'the plain test login (no location) is refused now');
});

test('sign-in needs a location inside an office; the password is checked first', async () => {
  assert.equal((await signIn({ email: EMP, password: 'wrong' })).status, 401);
  const none = await signIn({ email: EMP, password: PW });
  assert.equal(none.status, 403);
  assert.equal(none.body.code, 'location_required');
  const home = await signIn({ email: EMP, password: PW, location: HOME });
  assert.equal(home.body.code, 'outside_office');
  assert.equal(home.body.office, 'Bengaluru office');
  assert.match(home.body.error, /km from the nearest office/);
  const rough = await signIn({ email: EMP, password: PW, location: { ...HOME, accuracy: 5000 } });
  assert.equal(rough.body.code, 'location_imprecise');
  const ok = await signIn({ email: EMP, password: PW, location: INSIDE });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.location.office, 'Bengaluru office');

  // The session ends at midnight so the next day starts with an office sign-in.
  const { db } = ctx;
  const uid = db.value('SELECT id FROM users WHERE email = ?', EMP);
  const exp = db.value('SELECT expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', uid);
  assert.ok(Date.parse(exp) - Date.now() <= 24 * 3600000);
  const blocked = db.all("SELECT * FROM location_log WHERE user_id = ? AND event = 'sign-in blocked'", uid);
  assert.ok(blocked.some((b) => b.result === 'outside' && b.distance_m > 4500));
});

test('administrators, people allowed anywhere, and office networks skip the GPS check', async () => {
  assert.equal((await signIn({ email: CEO, password: PW })).status, 200, 'admins can always sign in');
  const hr = await as(ctx.base, CEO);
  const mgrId = ctx.db.value('SELECT employee_id FROM users WHERE email = ?', MGR);
  assert.equal((await signIn({ email: MGR, password: PW, location: HOME })).status, 403);
  assert.equal((await hr.put('/settings', { geofence: { exemptEmployeeIds: [mgrId] } })).status, 200);
  assert.equal((await signIn({ email: MGR, password: PW })).status, 200, 'field staff sign in from anywhere');

  const office = ctx.db.get("SELECT * FROM office_sites WHERE name = 'Bengaluru office'");
  assert.equal((await hr.put(`/settings/offices/${office.id}`, { ip_ranges: '127.0.0.1' })).status, 200);
  assert.equal((await signIn({ email: HR, password: PW })).status, 200, 'office network counts as in the office');
  assert.equal((await hr.put(`/settings/offices/${office.id}`, { ip_ranges: '' })).status, 200);
  assert.equal((await signIn({ email: HR, password: PW })).body.code, 'location_required');
});

test('office check-in needs the office; work from home needs an approved WFH day', async () => {
  const c = client(ctx.base);
  assert.equal((await c.post('/auth/login', { email: EMP, password: PW, location: INSIDE })).status, 200);
  let w = (await c.get('/attendance/workday')).body.workday;
  if (w.openSince) assert.equal((await c.post('/attendance/check-out')).status, 200);
  w = (await c.get('/attendance/workday')).body.workday;
  const again = w.sessions.length ? { gap_reason: 'Lunch break' } : {};
  assert.equal((await c.post('/attendance/check-in', { mode: 'wfh', ...again })).body.code, 'wfh_not_approved');
  assert.equal((await c.post('/attendance/check-in', { mode: 'office', ...again, location: HOME })).body.code, 'outside_office');
  assert.equal((await c.post('/attendance/check-in', { mode: 'office', ...again, location: INSIDE })).status, 200);
  const mine = (await c.get('/attendance/locations?view=mine')).body.items;
  assert.ok(mine.some((x) => x.event === 'check-in' && x.result === 'in-office'));
  assert.ok(mine.some((x) => x.event === 'check-in blocked' && x.result === 'outside'));
  assert.ok(mine.every((x) => x.user_id === ctx.db.value('SELECT id FROM users WHERE email = ?', EMP)));
});

test('strict mode signs you out after leaving the office and pauses the clock', async () => {
  const ceo = client(ctx.base);
  await ceo.post('/auth/login', { email: CEO, password: PW });
  assert.equal((await ceo.put('/settings', { geofence: { mode: 'strict' } })).status, 200);
  const c = client(ctx.base);
  await c.post('/auth/login', { email: EMP, password: PW, location: INSIDE });
  assert.ok((await c.get('/attendance/workday')).body.workday.openSince, 'clock running from the previous test');
  const inside = await c.post('/attendance/location', INSIDE);
  assert.equal(inside.body.ok, true);
  const first = await c.post('/attendance/location', HOME);
  assert.equal(first.body.ok, false);
  assert.ok(!first.body.signedOut, 'one reading outside is not enough');
  const second = await c.post('/attendance/location', HOME);
  assert.equal(second.body.signedOut, true);
  assert.match(second.body.message, /left the office/);
  assert.equal((await c.get('/auth/me')).status, 401);
  const back = client(ctx.base);
  await back.post('/auth/login', { email: EMP, password: PW, location: INSIDE });
  const w = (await back.get('/attendance/workday')).body.workday;
  assert.equal(w.openSince, null);
  assert.equal(w.signedOutAway, true, 'coming back asks the reason for the gap');

  // HR sees the team log; an employee cannot.
  const hr = client(ctx.base);
  await hr.post('/auth/login', { email: CEO, password: PW });
  const team = (await hr.get('/attendance/locations?view=team&issues=1')).body;
  assert.ok(team.items.some((x) => x.event === 'signed out (left office)'));
  assert.ok(team.items.every((x) => ['outside', 'imprecise', 'no-location'].includes(x.result)));
  const empTeam = (await back.get('/attendance/locations?view=team')).body.items;
  assert.equal(empTeam.length, 0, 'employees have no team');
  assert.equal((await hr.put('/settings', { geofence: { mode: 'off' } })).status, 200);
});
