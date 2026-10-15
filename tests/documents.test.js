import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as } from './helpers.js';

let ctx;
before(async () => { ctx = await boot(); });
after(async () => { await ctx.close(); });

const EMP = 'aarav.mehta@brainadz.com';
const HR = 'priya.sharma@brainadz.com';
const MGR = 'vikram.patel@brainadz.com';

test('HR sees every employee\'s documents and the checklist of what is missing', async () => {
  const hr = await as(ctx.base, HR);
  const list = (await hr.get('/documents?limit=10')).body;
  assert.ok(list.total > 500);
  assert.equal(list.items.length, 10);
  const check = (await hr.get('/documents/checklist')).body;
  assert.ok(check.required.includes('Aadhaar Card'));
  assert.ok(check.summary.employees > 80);
  assert.ok(check.summary.complete < check.summary.employees, 'some files are incomplete');
  const aarav = check.rows.find((r) => r.name === 'Aarav Mehta');
  assert.deepEqual(aarav.missing, ['Address Proof']);
  const missingOnly = (await hr.get('/documents/checklist?missing=1')).body.rows;
  assert.ok(missingOnly.every((r) => r.missing.length));
  // A seeded document downloads as a PDF.
  const file = await hr.raw('GET', `/documents/${list.items[0].id}/download`);
  assert.equal(file.status, 200);
  assert.match(String(file.body), /^%PDF-1\.4/);
});

test('employees and managers only see their own documents and can upload their own', async () => {
  const emp = await as(ctx.base, EMP);
  const mine = (await emp.get('/documents?limit=200')).body;
  const empId = (await emp.get('/auth/me')).body.user.employeeId;
  assert.ok(mine.items.length > 0);
  assert.ok(mine.items.every((d) => d.employee_id === empId));
  const check = (await emp.get('/documents/checklist')).body;
  assert.equal(check.rows.length, 1);
  assert.deepEqual(check.rows[0].missing, ['Address Proof']);

  const form = new FormData();
  form.append('file', new Blob(['%PDF-1.4 rent agreement'], { type: 'application/pdf' }), 'rent-agreement.pdf');
  form.append('category', 'Address Proof');
  assert.equal((await emp.post(`/employees/${empId}/documents`, undefined, { form })).status, 200);
  assert.deepEqual((await emp.get('/documents/checklist')).body.rows[0].missing, []);

  const mgr = await as(ctx.base, MGR);
  const theirs = (await mgr.get('/documents?limit=200')).body.items;
  const mgrId = (await mgr.get('/auth/me')).body.user.employeeId;
  assert.ok(theirs.every((d) => d.employee_id === mgrId), 'managers do not see their team\'s ID documents');
  assert.equal((await mgr.raw('GET', `/documents/${mine.items[0].id}/download`)).status, 403);
  const bad = new FormData();
  bad.append('file', new Blob(['x']), 'x.pdf');
  assert.equal((await mgr.post(`/employees/${empId}/documents`, undefined, { form: bad })).status, 403);
});

test('the holiday calendar lists the year\'s holidays and your own leave', async () => {
  const emp = await as(ctx.base, EMP);
  const year = Number((await emp.get('/meta')).body.today.slice(0, 4));
  const cal = (await emp.get(`/holidays/calendar?year=${year}`)).body;
  assert.equal(cal.year, year);
  assert.ok(cal.holidays.some((h) => h.name === 'Independence Day' && h.type === 'Company'));
  assert.deepEqual(cal.weeklyOffs, [0, 6]);
  assert.ok(Array.isArray(cal.myLeave));
  assert.ok(cal.myLeave.every((l) => l.date.startsWith(String(year))));
  assert.equal((await emp.get('/holidays/calendar?year=1500')).status, 400);
});
