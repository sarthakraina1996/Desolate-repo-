import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, as } from './helpers.js';

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await ctx.close(); });

const HR = 'priya.sharma@brainadz.com';
const ADMIN = 'rajiv.malhotra@brainadz.com';
const EMP = 'aarav.mehta@brainadz.com';
const MGR_OF_EMP = 'nandini.joshi@brainadz.com';
const OTHER_MGR = 'vikram.patel@brainadz.com';

test('login rejects a wrong password and accepts the demo password', async () => {
  const c = client(ctx.base);
  assert.equal((await c.post('/auth/login', { email: HR, password: 'nope' })).status, 401);
  await c.login(HR);
  const me = await c.get('/auth/me');
  assert.equal(me.body.user.role, 'hr');
});

test('unauthenticated and cross-site requests are blocked', async () => {
  const anon = client(ctx.base);
  assert.equal((await anon.get('/employees')).status, 401);
  const c = await as(ctx.base, EMP);
  const r = await c.raw('POST', '/attendance/check-in', { mode: 'office' }, { headers: { 'X-Requested-With': 'x' } });
  assert.equal(r.status, 403);
});

test('employees cannot open payroll or other people\'s HR records', async () => {
  const c = await as(ctx.base, EMP);
  assert.equal((await c.get('/payroll')).status, 403);
  assert.equal((await c.get('/hiring')).status, 403);
  const other = await c.get('/employees/1');
  assert.equal(other.status, 200);
  assert.equal(other.body.limited, true);
  assert.equal(other.body.compensation, undefined);
});

async function findFreeDay(c, typeId) {
  const T = (await c.get('/meta')).body.today;
  for (let i = 20; i < 80; i++) {
    const d = new Date(`${T}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    const p = await c.post('/leave/preview', { leave_type_id: typeId, from_date: day, to_date: day });
    if (p.body.ok) return day;
  }
  throw new Error('no free day');
}

test('leave: employee applies, other manager cannot approve, own manager approves', async () => {
  const emp = await as(ctx.base, EMP);
  const types = (await emp.get('/leave/balances')).body.items;
  const cl = types.find((t) => t.code === 'CL');
  const day = await findFreeDay(emp, cl.typeId);
  const applied = await emp.post('/leave/requests', { leave_type_id: cl.typeId, from_date: day, to_date: day, reason: 'test' });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const dup = await emp.post('/leave/requests', { leave_type_id: cl.typeId, from_date: day, to_date: day });
  assert.equal(dup.status, 409);
  const after = (await emp.get('/leave/balances')).body.items.find((t) => t.code === 'CL');
  assert.equal(after.pending, cl.pending + 1);

  const wrong = await as(ctx.base, OTHER_MGR);
  assert.equal((await wrong.post(`/leave/requests/${applied.body.id}/decision`, { action: 'approve' })).status, 403);
  const mgr = await as(ctx.base, MGR_OF_EMP);
  const queue = (await mgr.get('/leave/requests?scope=approvals')).body.items;
  assert.ok(queue.some((r) => r.id === applied.body.id));
  assert.equal((await mgr.post(`/leave/requests/${applied.body.id}/decision`, { action: 'approve' })).status, 200);
  const final = (await emp.get('/leave/balances')).body.items.find((t) => t.code === 'CL');
  assert.equal(final.used, cl.used + 1);
  assert.equal(final.pending, cl.pending);
});

test('payroll: run, finance review, management approval by admin only, transfer, pay', async () => {
  const hr = await as(ctx.base, HR);
  const month = (await hr.get('/meta')).body.today.slice(0, 7);
  const run = await hr.post('/payroll/runs', { month });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.equal(run.body.status, 'In Review');
  assert.ok(run.body.totals.count > 50);
  assert.equal((await hr.post(`/payroll/runs/${run.body.id}/approve`, { stage: 'finance' })).body.status, 'Finance Reviewed');
  assert.equal((await hr.post(`/payroll/runs/${run.body.id}/approve`, { stage: 'management' })).status, 403);
  const admin = await as(ctx.base, ADMIN);
  assert.equal((await admin.post(`/payroll/runs/${run.body.id}/approve`, { stage: 'management' })).body.status, 'Approved');
  assert.equal((await hr.post('/payroll/runs', { month })).status, 409);
  const t = await hr.post(`/payroll/runs/${run.body.id}/transfer`);
  assert.equal(t.body.status, 'Transfer Scheduled');
  assert.ok(t.body.bankBatch.amount > 0);
  assert.equal((await hr.post(`/payroll/runs/${run.body.id}/complete`)).body.status, 'Completed');
  const emp = await as(ctx.base, EMP);
  const mine = (await emp.get('/payroll/my')).body.items;
  assert.ok(mine.some((p) => p.month === month));
  const slip = await emp.get(`/payroll/payslips/${mine[0].id}`);
  assert.equal(slip.status, 200);
  assert.equal(slip.body.data.net, slip.body.data.totalEarnings - slip.body.data.totalDeductions);
  const bank = await hr.get(`/payroll/runs/${run.body.id}/bank-file.csv`);
  assert.match(bank.body, /Beneficiary Name/);
});

test('HR adds an employee with a login; the new hire changes password and checks in', async () => {
  const hr = await as(ctx.base, HR);
  const meta = (await hr.get('/meta')).body;
  const created = await hr.post('/employees', { first_name: 'Test', last_name: 'Joiner', email: 'test.joiner@brainadz.com', join_date: meta.today, ctc: 720000, pan: 'ABCPJ1234K', create_login: true });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.ok(created.body.tempPassword);
  const bad = await hr.post('/employees', { first_name: 'X', email: 'bad', join_date: meta.today });
  assert.equal(bad.status, 400);
  const me = await as(ctx.base, 'test.joiner@brainadz.com', created.body.tempPassword);
  assert.equal((await me.get('/auth/me')).body.user.mustChangePassword, true);
  assert.equal((await me.post('/auth/change-password', { current: created.body.tempPassword, next: 'short' })).status, 400);
  assert.equal((await me.post('/auth/change-password', { current: created.body.tempPassword, next: 'BetterPass123' })).status, 200);
  assert.equal((await me.post('/attendance/check-in', { mode: 'wfh' })).status, 200);
  assert.equal((await me.post('/attendance/check-in', { mode: 'office' })).status, 409);
  const today = (await me.get('/attendance/today')).body.me;
  assert.equal(today.record.status, 'WFH');
  const profile = (await hr.get(`/employees/${created.body.id}`)).body;
  assert.equal(profile.onboarding.length, 5);
  assert.ok(profile.compensation.monthlyTds >= 0);
});

test('resume upload is screened in the background', async () => {
  const hr = await as(ctx.base, HR);
  const job = (await hr.get('/jobs')).body.items.find((j) => j.title === 'Senior Frontend Developer');
  const form = new FormData();
  form.append('files', new Blob(['Kiran Shah\nFrontend Developer | Bengaluru\nkiran.shah@example.com\nTotal Experience: 5 years\nSkills: React, Redux, JavaScript, TypeScript, HTML, CSS\nB.Tech CSE (2019)\nExpected CTC: 16 LPA'], { type: 'text/plain' }), 'kiran.txt');
  const up = await hr.post(`/screener/jobs/${job.id}/upload`, undefined, { form });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  let cand;
  for (let i = 0; i < 40; i++) {
    cand = (await hr.get(`/candidates/${up.body.created[0]}`)).body.candidate;
    if (cand.screen_status === 'done') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(cand.screen_status, 'done');
  assert.equal(cand.name, 'Kiran Shah');
  assert.ok(cand.ai_score >= 80, `score ${cand.ai_score}`);
  assert.equal(cand.stage, 'AI Screened');
  const bad = new FormData();
  bad.append('files', new Blob(['x']), 'virus.exe');
  assert.equal((await hr.post(`/screener/jobs/${job.id}/upload`, undefined, { form: bad })).status, 400);
});

test('resignation: submit, manager approval, HR acceptance moves employee to notice', async () => {
  const hr = await as(ctx.base, HR);
  const emp = await as(ctx.base, 'kavya.singh@brainadz.com');
  const sub = await emp.post('/resignations', { reason_category: 'Career Growth', reason: 'test' });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal((await emp.post('/resignations', { reason_category: 'Career Growth' })).status, 409);
  const mgrEmail = 'siddharth.menon@brainadz.com';
  const mgr = await as(ctx.base, mgrEmail);
  assert.equal((await mgr.post(`/resignations/${sub.body.id}/manager-decision`, { action: 'approve' })).status, 200);
  assert.equal((await hr.post(`/resignations/${sub.body.id}/hr-review`, { action: 'approve' })).status, 200);
  const r = (await hr.get(`/resignations/${sub.body.id}`)).body;
  assert.equal(r.status, 'In Progress');
  const meId = (await emp.get('/auth/me')).body.user.employeeId;
  assert.equal((await hr.get(`/employees/${meId}`)).body.employee.status, 'Notice');
  assert.equal((await hr.post(`/resignations/${sub.body.id}/complete`)).status, 400);
});

test('every main read endpoint answers for HR', async () => {
  const hr = await as(ctx.base, HR);
  for (const p of ['/dashboard', '/dashboard/me', '/employees', '/leave/overview', '/leave/calendar', '/attendance/today', '/attendance/register', '/policies', '/posh', '/payroll', '/hiring', '/screener', '/resignations', '/performance', '/reports/summary', '/settings', '/users', '/notifications', '/search?q=aar']) {
    const r = await hr.get(p);
    assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
});

test('removing demo data requires the administrator to set their own login', async () => {
  const { base, close } = await boot();
  try {
    const admin = await as(base, ADMIN);
    assert.equal((await admin.post('/settings/start-fresh', { confirm: 'START FRESH' })).status, 400);
    assert.equal((await admin.post('/settings/start-fresh', { confirm: 'START FRESH', email: 'owner@brainadz.com', password: 'short' })).status, 400);
    const ok = await admin.post('/settings/start-fresh', { confirm: 'START FRESH', email: 'Owner@BrainADZ.com', password: 'RealPass2026' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await admin.get('/auth/me')).body.user.email, 'owner@brainadz.com');
    assert.equal((await client(base).post('/auth/login', { email: ADMIN, password: 'Brainadz@2026' })).status, 401);
    await client(base).login('owner@brainadz.com', 'RealPass2026');
    assert.deepEqual((await client(base).get('/auth/config')).body.demoAccounts, []);
  } finally {
    await close();
  }
});
