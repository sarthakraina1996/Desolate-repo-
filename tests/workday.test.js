import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, as } from './helpers.js';
import { syncAttendance } from '../server/services/workday.js';
import { zonedIso } from '../server/lib/dates.js';

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await ctx.close(); });

const EMP = 'aarav.mehta@brainadz.com';
const MGR_OF_EMP = 'nandini.joshi@brainadz.com';
const OTHER_MGR = 'vikram.patel@brainadz.com';
const HR = 'priya.sharma@brainadz.com';
const CEO = 'rajiv.malhotra@brainadz.com';

test('stepping out and coming back asks the reason for the gap', async () => {
  const emp = await as(ctx.base, EMP);
  let w = (await emp.get('/attendance/workday')).body.workday;
  if (!w.sessions.length) assert.equal((await emp.post('/attendance/check-in', { mode: 'office' })).status, 200);
  w = (await emp.get('/attendance/workday')).body.workday;
  if (w.openSince) assert.equal((await emp.post('/attendance/check-out')).status, 200);

  const noReason = await emp.post('/attendance/check-in', { mode: 'office' });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /reason for the gap/);
  assert.equal((await emp.post('/attendance/check-in', { gap_reason: 'Other' })).status, 400);
  assert.equal((await emp.post('/attendance/check-in', { gap_reason: 'Client meeting', gap_note: 'Brand review' })).status, 200);
  assert.equal((await emp.post('/attendance/check-in', { gap_reason: 'Client meeting' })).status, 409);

  w = (await emp.get('/attendance/workday')).body.workday;
  assert.ok(w.openSince);
  assert.equal(w.gaps.at(-1).reason, 'Client meeting');
  assert.equal(w.gaps.at(-1).note, 'Brand review');

  // Signing out with pause stops the clock; the next sign-in is asked why.
  const out = await emp.post('/auth/logout', { pause: true });
  assert.equal(out.body.paused, true);
  const back = await as(ctx.base, EMP);
  w = (await back.get('/attendance/workday')).body.workday;
  assert.equal(w.openSince, null);
  assert.equal(w.signedOutAway, true);
  assert.equal((await back.post('/attendance/check-in', { gap_reason: 'Lunch break' })).status, 200);
  assert.equal((await back.get('/attendance/workday')).body.workday.signedOutAway, false);
});

test('a short day is explained by the employee and decided by their manager or the CEO', async () => {
  const { db } = ctx;
  const emp = db.get("SELECT * FROM employees WHERE email = ?", EMP);
  const T = db.value("SELECT MAX(date) FROM attendance WHERE employee_id = ?", emp.id);
  // Two recent full-attendance days for this employee, made short.
  const days = db.all(`SELECT a.date FROM attendance a WHERE a.employee_id = ? AND a.date < ? AND a.date >= date(?, '-7 day') AND a.status = 'P'
    AND NOT EXISTS (SELECT 1 FROM hour_shortfalls s WHERE s.employee_id = a.employee_id AND s.date = a.date) ORDER BY a.date DESC LIMIT 2`, emp.id, T, T).map((r) => r.date);
  assert.equal(days.length, 2, 'need two recent working days');
  for (const d of days) {
    db.run('DELETE FROM work_sessions WHERE employee_id = ? AND date = ?', emp.id, d);
    db.insert('work_sessions', { employee_id: emp.id, date: d, start_at: zonedIso(d, '09:30'), end_at: zonedIso(d, '12:30'), mode: 'office', ended_by: 'signout' });
    db.insert('work_sessions', { employee_id: emp.id, date: d, start_at: zonedIso(d, '14:30'), end_at: zonedIso(d, '17:30'), mode: 'office', ended_by: 'checkout', gap_reason: 'Client meeting' });
    syncAttendance(db, emp.id, d, null);
  }

  const me = await as(ctx.base, EMP);
  assert.ok((await me.get('/attendance/workday')).body.toExplain >= 2);
  const mine = (await me.get('/attendance/short-hours?view=mine')).body.items.filter((x) => days.includes(x.date));
  assert.equal(mine.length, 2);
  for (const x of mine) {
    assert.equal(x.status, 'Awaiting explanation');
    assert.equal(x.worked_minutes, 360);
    assert.equal(x.gaps[0].reason, 'Client meeting');
  }
  const [a, b] = mine;

  assert.equal((await me.post(`/attendance/short-hours/${a.id}/explain`, { reason: '' })).status, 400);
  assert.equal((await me.post(`/attendance/short-hours/${a.id}/explain`, { reason: 'Client meeting at Thane ran late.' })).status, 200);
  assert.equal((await me.post(`/attendance/short-hours/${b.id}/explain`, { reason: 'Doctor appointment.' })).status, 200);
  assert.equal((await me.post(`/attendance/short-hours/${a.id}/decide`, { action: 'approve' })).status, 403, 'no self-approval');

  const other = await as(ctx.base, OTHER_MGR);
  assert.equal((await other.post(`/attendance/short-hours/${a.id}/decide`, { action: 'approve' })).status, 403);
  const hr = await as(ctx.base, HR);
  assert.equal((await hr.post(`/attendance/short-hours/${a.id}/decide`, { action: 'approve' })).status, 403, 'HR can view but not approve');
  assert.ok((await hr.get('/attendance/short-hours?view=team&status=open')).body.items.some((x) => x.id === a.id));

  const mgr = await as(ctx.base, MGR_OF_EMP);
  const queue = (await mgr.get('/attendance/short-hours?view=team&status=open')).body.items;
  const row = queue.find((x) => x.id === a.id);
  assert.ok(row?.canDecide);
  assert.equal(row.reason, 'Client meeting at Thane ran late.');
  assert.ok((await mgr.get('/attendance/workday')).body.toApprove >= 2);
  assert.equal((await mgr.post(`/attendance/short-hours/${a.id}/decide`, { action: 'reject', note: 'Please plan client visits with the team.' })).status, 200);
  assert.equal(db.value('SELECT status FROM attendance WHERE employee_id = ? AND date = ?', emp.id, a.date), 'HD');
  assert.equal((await mgr.post(`/attendance/short-hours/${a.id}/decide`, { action: 'approve' })).status, 409);

  const ceo = await as(ctx.base, CEO);
  assert.equal((await ceo.post(`/attendance/short-hours/${b.id}/decide`, { action: 'approve' })).status, 200);
  assert.equal(db.value('SELECT status FROM attendance WHERE employee_id = ? AND date = ?', emp.id, b.date), 'P');
  const after = (await me.get('/attendance/short-hours?view=mine')).body.items;
  assert.equal(after.find((x) => x.id === a.id).status, 'Rejected');
  assert.equal(after.find((x) => x.id === b.id).status, 'Approved');
  assert.ok((await me.get('/notifications')).body.items.some((n) => /did not approve your short hours/.test(n.text)));
});

test('a clock left running overnight is closed at the end of that workday', async () => {
  const { db } = ctx;
  const emp = db.get("SELECT * FROM employees WHERE email = ?", 'kavya.singh@brainadz.com');
  const d = db.value("SELECT MAX(date) FROM attendance WHERE employee_id = ? AND status = 'P' AND date < (SELECT MAX(date) FROM attendance)", emp.id);
  db.run('DELETE FROM work_sessions WHERE employee_id = ? AND date = ?', emp.id, d);
  db.run('DELETE FROM hour_shortfalls WHERE employee_id = ? AND date = ?', emp.id, d);
  db.insert('work_sessions', { employee_id: emp.id, date: d, start_at: zonedIso(d, '09:45'), mode: 'office' });
  syncAttendance(db, emp.id, d, null);
  const c = await as(ctx.base, 'kavya.singh@brainadz.com');
  await c.get('/attendance/workday');
  const s = db.get('SELECT * FROM work_sessions WHERE employee_id = ? AND date = ?', emp.id, d);
  assert.equal(s.end_at, zonedIso(d, '18:30'));
  assert.equal(s.ended_by, 'auto');
  assert.equal(db.value('SELECT check_out FROM attendance WHERE employee_id = ? AND date = ?', emp.id, d), zonedIso(d, '18:30'));
});

test('anonymous users cannot reach the work clock', async () => {
  assert.equal((await client(ctx.base).get('/attendance/workday')).status, 401);
});

test('HR sets the working hours per day used for short-hours checks', async () => {
  const hr = await as(ctx.base, HR);
  assert.equal((await hr.put('/settings', { workHours: 9, shortHoursGraceMinutes: 10, workdayEnd: '19:00' })).status, 200);
  const emp = await as(ctx.base, EMP);
  assert.equal((await emp.get('/attendance/workday')).body.workday.requiredMinutes, 540);
  assert.equal((await hr.put('/settings', { workHours: 30 })).status, 400);
  assert.equal((await hr.put('/settings', { workdayEnd: '7pm' })).status, 400);
  assert.equal((await hr.put('/settings', { workHours: 8, shortHoursGraceMinutes: 15, workdayEnd: '18:30' })).status, 200);
});
