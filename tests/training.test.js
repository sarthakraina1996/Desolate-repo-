import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as } from './helpers.js';
import { ensureTraining } from '../server/services/training.js';

let ctx;
before(async () => {
  ctx = await boot();
});
after(async () => {
  await ctx.close();
});

const EMP = 'aarav.mehta@brainadz.com'; // Marketing, reports to Nandini
const OTHER = 'neha.kapoor@brainadz.com'; // HR, not in Nandini's team
const HR = 'priya.sharma@brainadz.com';
const MGR = 'nandini.joshi@brainadz.com'; // Aarav's manager
const OTHER_MGR = 'vikram.patel@brainadz.com'; // manages a different team
const T = () => ctx.db.value("SELECT date('now')");
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const empId = (email) => ctx.db.value('SELECT id FROM employees WHERE email = ?', email);
const mine = async (c) => (await c.get('/training/mine')).body.items;
const notes = async (c) => (await c.get('/notifications')).body.items.map((n) => n.text);

// Creates a course as HR and returns its id.
async function createCourse(hr, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const r = await hr.post('/training/courses', null, { form });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.id;
}

test('POSH awareness is a built-in course everyone has, and the POSH page counts it', async () => {
  const hr = await as(ctx.base, HR);
  const courses = (await hr.get('/training/courses')).body.items;
  const posh = courses.find((c) => c.builtIn);
  assert.equal(posh.title, 'POSH awareness');
  assert.equal(posh.mandatory, 1);
  // Everyone current has it; the POSH page's numbers come from it
  const stats = (await hr.get('/posh')).body.stats;
  assert.equal(
    stats.trained,
    ctx.db.value(
      "SELECT COUNT(*) FROM training_assignments a JOIN employees e ON e.id = a.employee_id WHERE a.training_id = ? AND a.completed_at IS NOT NULL AND e.status != 'Exited'",
      posh.id,
    ),
  );
  // It can't be archived or taken off anyone
  assert.equal(
    (await hr.post(`/training/courses/${posh.id}/active`, { active: false })).status,
    400,
  );
  const aid = ctx.db.value(
    'SELECT id FROM training_assignments WHERE training_id = ? AND employee_id = ?',
    posh.id,
    empId(EMP),
  );
  assert.equal((await hr.del(`/training/assignments/${aid}`)).status, 400);
  // The old POSH endpoints are gone: training lives in Training now
  assert.equal((await hr.post('/posh/training', {})).status, 404);
});

test('old POSH completions move into Training when the server starts', () => {
  const db = ctx.db;
  const eid = db.value(
    `SELECT a.employee_id FROM training_assignments a JOIN trainings t ON t.id = a.training_id
     WHERE t.system_key = 'posh' AND a.completed_at IS NULL LIMIT 1`,
  );
  db.run(
    'INSERT INTO posh_training (employee_id, completed_at) VALUES (?, ?)',
    eid,
    '2026-01-05T10:00:00.000Z',
  );
  ensureTraining(db, T());
  assert.equal(
    db.value(
      `SELECT a.completed_at FROM training_assignments a JOIN trainings t ON t.id = a.training_id
       WHERE t.system_key = 'posh' AND a.employee_id = ?`,
      eid,
    ),
    '2026-01-05T10:00:00.000Z',
  );
  assert.equal(db.value('SELECT COUNT(*) FROM posh_training'), 0);
});

test('HR creates a course and assigns it to a department; people there are told', async () => {
  const hr = await as(ctx.base, HR);
  // Links must be real web addresses
  const bad = new FormData();
  for (const [k, v] of Object.entries({
    title: 'X',
    format: 'Online course',
    link: 'javascript:alert(1)',
  }))
    bad.append(k, v);
  assert.equal((await hr.post('/training/courses', null, { form: bad })).status, 400);
  const noLink = new FormData();
  noLink.append('title', 'X');
  noLink.append('format', 'Video');
  assert.equal((await hr.post('/training/courses', null, { form: noLink })).status, 400);
  // A real course, assigned to Marketing
  const cid = await createCourse(hr, {
    title: 'Brand guidelines refresher',
    category: 'Product',
    format: 'Online course',
    link: 'https://example.com/brand',
    duration_min: 20,
  });
  const marketing = ctx.db.value("SELECT id FROM departments WHERE name = 'Marketing'");
  const r = await hr.post(`/training/courses/${cid}/assign`, {
    to: 'department',
    group_id: marketing,
    due_date: inDays(14),
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.added > 1);
  const emp = await as(ctx.base, EMP);
  const a = (await mine(emp)).find((x) => x.training_id === cid);
  assert.equal(a.status, 'Assigned');
  assert.equal(a.due_date, inDays(14));
  assert.ok(
    (await notes(emp)).some((t) => t.startsWith('New training: Brand guidelines refresher')),
  );
  // Assigning again doesn't duplicate anyone
  const again = await hr.post(`/training/courses/${cid}/assign`, {
    to: 'department',
    group_id: marketing,
  });
  assert.equal(again.body.added, 0);
  // Due dates in the past are refused
  const past = await hr.post(`/training/courses/${cid}/assign`, {
    to: 'people',
    ids: [empId(OTHER)],
    due_date: '2020-01-01',
  });
  assert.equal(past.status, 400);
});

test('people start and finish their own courses; a certificate is needed when the course asks', async () => {
  const hr = await as(ctx.base, HR);
  const cid = await createCourse(hr, {
    title: 'Safe driving for site visits',
    category: 'Safety',
    format: 'Online course',
    link: 'https://example.com/driving',
    needs_certificate: true,
  });
  await hr.post(`/training/courses/${cid}/assign`, { to: 'people', ids: [empId(EMP)] });
  const emp = await as(ctx.base, EMP);
  const a = (await mine(emp)).find((x) => x.training_id === cid);
  assert.equal((await emp.post(`/training/assignments/${a.id}/start`)).status, 200);
  assert.equal((await mine(emp)).find((x) => x.id === a.id).status, 'In progress');
  // No certificate, not finished
  assert.equal(
    (await emp.post(`/training/assignments/${a.id}/complete`, null, { form: new FormData() }))
      .status,
    400,
  );
  const form = new FormData();
  form.append('certificate', new Blob(['%PDF-1.4 cert'], { type: 'application/pdf' }), 'cert.pdf');
  assert.equal(
    (await emp.post(`/training/assignments/${a.id}/complete`, null, { form })).status,
    200,
  );
  assert.equal((await mine(emp)).find((x) => x.id === a.id).status, 'Completed');
  // The certificate: the owner and HR can open it, a colleague can't
  assert.equal((await emp.get(`/training/assignments/${a.id}/certificate`)).status, 200);
  assert.equal((await hr.get(`/training/assignments/${a.id}/certificate`)).status, 200);
  const colleague = await as(ctx.base, OTHER_MGR);
  assert.equal((await colleague.get(`/training/assignments/${a.id}/certificate`)).status, 403);
  // Someone else can't finish it for you, and it can't be finished twice
  assert.equal(
    (await colleague.post(`/training/assignments/${a.id}/complete`, null, { form: new FormData() }))
      .status,
    403,
  );
  assert.equal(
    (await emp.post(`/training/assignments/${a.id}/complete`, null, { form: new FormData() }))
      .status,
    409,
  );
});

test('classroom sessions are marked by the manager or HR, not by the attendee', async () => {
  const hr = await as(ctx.base, HR);
  const cid = await createCourse(hr, {
    title: 'Negotiation workshop',
    category: 'Skills',
    format: 'Classroom',
    session_at: `${inDays(3)}T15:00`,
    venue: 'Training room 1',
  });
  await hr.post(`/training/courses/${cid}/assign`, {
    to: 'people',
    ids: [empId(EMP), empId(OTHER)],
  });
  const emp = await as(ctx.base, EMP);
  const a = (await mine(emp)).find((x) => x.training_id === cid);
  assert.equal(
    (await emp.post(`/training/assignments/${a.id}/complete`, null, { form: new FormData() }))
      .status,
    400,
  );
  // The manager marks their own report, but not someone outside their team
  const mgr = await as(ctx.base, MGR);
  assert.equal(
    (await mgr.post(`/training/assignments/${a.id}/complete`, null, { form: new FormData() }))
      .status,
    200,
  );
  assert.ok(
    (await notes(emp)).some((t) => t.includes('Negotiation workshop" was marked complete')),
  );
  const other = ctx.db.value(
    'SELECT id FROM training_assignments WHERE training_id = ? AND employee_id = ?',
    cid,
    empId(OTHER),
  );
  assert.equal(
    (await mgr.post(`/training/assignments/${other}/complete`, null, { form: new FormData() }))
      .status,
    403,
  );
  // Classroom courses need a session date
  const form = new FormData();
  form.append('title', 'No date');
  form.append('format', 'Classroom');
  assert.equal((await hr.post('/training/courses', null, { form })).status, 400);
});

test('managers assign only to their own team; employees can do neither', async () => {
  const hr = await as(ctx.base, HR);
  const cid = await createCourse(hr, {
    title: 'Team tools',
    format: 'Reading',
    content: '## Tools\n\nSlack and Drive.',
  });
  const mgr = await as(ctx.base, MGR);
  assert.equal(
    (await mgr.post(`/training/courses/${cid}/assign`, { to: 'people', ids: [empId(EMP)] })).status,
    200,
  );
  assert.equal(
    (await mgr.post(`/training/courses/${cid}/assign`, { to: 'people', ids: [empId(OTHER)] }))
      .status,
    403,
  );
  assert.equal((await mgr.post(`/training/courses/${cid}/assign`, { to: 'everyone' })).status, 403);
  const emp = await as(ctx.base, EMP);
  assert.equal(
    (await emp.post(`/training/courses/${cid}/assign`, { to: 'people', ids: [empId(EMP)] })).status,
    403,
  );
  const form = new FormData();
  form.append('title', 'Mine');
  form.append('format', 'Reading');
  form.append('content', 'x');
  assert.equal((await emp.post('/training/courses', null, { form })).status, 403);
  assert.equal((await emp.get('/training/tracking')).status, 403);
  assert.equal((await emp.get('/training/export.csv')).status, 403);
});

test('tracking shows overdue people; managers see only their team', async () => {
  const hr = await as(ctx.base, HR);
  const cid = await createCourse(hr, {
    title: 'Data privacy',
    category: 'Compliance',
    format: 'Reading',
    content: 'Read this.',
  });
  await hr.post(`/training/courses/${cid}/assign`, {
    to: 'people',
    ids: [empId(EMP), empId(OTHER)],
    due_date: inDays(5),
  });
  // Due date passes
  ctx.db.run(
    "UPDATE training_assignments SET due_date = date('now', '-2 days') WHERE training_id = ?",
    cid,
  );
  const emp = await as(ctx.base, EMP);
  assert.equal((await mine(emp)).find((x) => x.training_id === cid).status, 'Overdue');
  const all = (await hr.get('/training/tracking')).body;
  const overdueHere = all.overdue.filter((x) => x.training_id === cid).map((x) => x.employee_id);
  assert.deepEqual(overdueHere.sort(), [empId(EMP), empId(OTHER)].sort());
  const mgr = await as(ctx.base, MGR);
  const team = (await mgr.get('/training/tracking')).body;
  assert.deepEqual(
    team.overdue.filter((x) => x.training_id === cid).map((x) => x.employee_id),
    [empId(EMP)],
  );
  // Reminders reach only the people the sender looks after
  const sent = (await mgr.post(`/training/courses/${cid}/remind`)).body.sent;
  assert.equal(sent, 1);
  assert.ok(
    (await notes(emp)).some((t) => t === 'Reminder: please finish "Data privacy" (overdue)'),
  );
  // HR's spreadsheet lists everyone
  const csv = await hr.get('/training/export.csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.body.includes('Employee,Code,Department,Course'));
  assert.ok(csv.body.includes('Data privacy'));
});

test('anyone can join an open course; invitation-only courses refuse', async () => {
  const hr = await as(ctx.base, HR);
  const open = await createCourse(hr, {
    title: 'Public speaking club',
    format: 'Reading',
    content: 'Meet on Fridays.',
    open_enrol: true,
  });
  const closed = await createCourse(hr, {
    title: 'Board prep',
    format: 'Reading',
    content: 'Private.',
  });
  const emp = await as(ctx.base, EMP);
  assert.equal((await emp.post(`/training/courses/${open}/enrol`)).status, 200);
  assert.ok((await mine(emp)).some((x) => x.training_id === open));
  assert.equal((await emp.post(`/training/courses/${closed}/enrol`)).status, 400);
  // Archived courses disappear from the catalogue for employees
  assert.equal((await hr.post(`/training/courses/${open}/active`, { active: false })).status, 200);
  const catalogue = (await emp.get('/training/courses')).body.items;
  assert.ok(!catalogue.some((c) => c.id === open));
});

test('new employees get the new-joiner courses, POSH awareness included', async () => {
  const hr = await as(ctx.base, HR);
  const r = await hr.post('/employees', {
    first_name: 'Test',
    last_name: 'Joiner',
    email: 'test.joiner@brainadz.com',
    join_date: T(),
    create_login: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const titles = ctx.db
    .all(
      'SELECT t.title FROM training_assignments a JOIN trainings t ON t.id = a.training_id WHERE a.employee_id = ?',
      r.body.id,
    )
    .map((x) => x.title);
  assert.ok(titles.includes('POSH awareness'));
  assert.ok(titles.includes('Welcome to BrainADZ'));
});
