import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { migrate, seedBasics } from '../core/setup.js';
import { seedDemo, demoEmail } from '../core/demo-seed.js';
import { handle } from '../core/api.js';
import { loadUser } from '../core/access.js';

const TODAY = '2026-10-13';
let db;
const services = {
  today: () => TODAY,
  now: () => `${TODAY}T10:00:00.000Z`,
  hashPassword: async (p) => `plain$${p}`,
  verifyPassword: async (p, h) => h === `plain$${p}`,
  removeStored: async () => {},
};

const as = (key) => {
  const row = db.get('SELECT id FROM users WHERE email = ?', demoEmail(key));
  return loadUser(db, row.id);
};
const call = (who, method, path, { query, body } = {}) => handle({ db, user: as(who), query, body, services }, method, path);
const vid = (short) => db.get('SELECT id FROM verticals WHERE short = ?', short).id;
const projectIn = (short) => db.get('SELECT id FROM projects WHERE vertical_id = ? ORDER BY id LIMIT 1', vid(short)).id;

async function rejects(promise, status) {
  await assert.rejects(promise, (e) => e.status === status);
}

before(() => {
  db = openDb(':memory:');
  migrate(db);
  seedBasics(db);
  seedDemo(db, { today: TODAY, passwordHash: 'plain$demo1234' });
});

test('an Exhibits person only sees Exhibits projects', async () => {
  for (const scope of ['open', 'past', 'all']) {
    const { items } = await call('rohan', 'GET', '/projects', { query: { scope } });
    assert.ok(items.length > 0);
    assert.ok(items.every((p) => p.vertical === 'Exhibits'), `scope ${scope} leaked another vertical`);
  }
});

test('a Marketing manager only sees Marketing projects, and Live only Live', async () => {
  const mkt = await call('kavita', 'GET', '/projects', { query: { scope: 'all' } });
  assert.ok(mkt.items.length > 0 && mkt.items.every((p) => p.vertical === 'Marketing'));
  const live = await call('arvind', 'GET', '/projects', { query: { scope: 'all' } });
  assert.ok(live.items.length > 0 && live.items.every((p) => p.vertical === 'Live'));
});

test('admins see every vertical', async () => {
  const { items } = await call('rajiv', 'GET', '/projects', { query: { scope: 'all' } });
  assert.deepEqual([...new Set(items.map((p) => p.vertical))].sort(), ['Exhibits', 'Live', 'Marketing']);
});

test('people with two verticals see both, and nothing else', async () => {
  const { items } = await call('siddharth', 'GET', '/projects', { query: { scope: 'all' } });
  assert.deepEqual([...new Set(items.map((p) => p.vertical))].sort(), ['Live', 'Marketing']);
});

test('opening a project from another vertical looks like it does not exist', async () => {
  const mktProject = projectIn('Marketing');
  await rejects(call('rohan', 'GET', `/projects/${mktProject}`), 404);
  await rejects(call('rohan', 'GET', `/projects/${mktProject}/tasks`), 404);
  await rejects(call('rohan', 'GET', `/projects/${mktProject}/files`), 404);
  await rejects(call('rohan', 'GET', `/projects/${mktProject}/activity`), 404);
  await rejects(call('rohan', 'POST', `/projects/${mktProject}/comments`, { body: { body: 'hi' } }), 404);
  await rejects(call('rohan', 'PATCH', `/projects/${mktProject}`, { body: { name: 'x' } }), 404);
  const task = db.get('SELECT id FROM tasks WHERE project_id = ?', mktProject).id;
  await rejects(call('rohan', 'GET', `/tasks/${task}`), 404);
  await rejects(call('rohan', 'PATCH', `/tasks/${task}`, { body: { status: 'done' } }), 404);
  const file = db.get('SELECT id FROM files WHERE project_id = ?', mktProject).id;
  await rejects(call('rohan', 'PATCH', `/files/${file}`, { body: { is_final: true } }), 404);
});

test('task lists, files, calendar, search and dashboard are scoped too', async () => {
  const tasks = await call('rohan', 'GET', '/tasks', { query: { scope: 'all' } });
  assert.ok(tasks.items.every((t) => t.vertical === 'Exhibits'));
  const files = await call('rohan', 'GET', '/files');
  assert.ok(files.items.length > 0 && files.items.every((f) => f.vertical === 'Exhibits'));
  const cal = await call('rohan', 'GET', '/calendar', { query: { from: '2025-01-01', to: '2027-12-31' } });
  assert.ok(cal.items.length > 0 && cal.items.every((i) => i.vertical === 'Exhibits'));
  const search = await call('rohan', 'GET', '/search', { query: { q: 'Sahyadri' } });
  // Sahyadri has an Exhibits project and Marketing projects; only the Exhibits one may show.
  const projectHits = search.results.filter((r) => r.type === 'project');
  assert.equal(projectHits.length, 1);
  const dash = await call('rohan', 'GET', '/dashboard');
  assert.deepEqual(dash.by_vertical.map((v) => v.short), ['Exhibits']);
  assert.ok(dash.attention.every((p) => p.vertical === 'Exhibits'));
  const facets = await call('rohan', 'GET', '/projects/facets');
  assert.ok(!facets.clients.some((c) => c.name === 'Indus Fintech'));
});

test('asking for another vertical by id returns nothing', async () => {
  const { items } = await call('rohan', 'GET', '/projects', { query: { vertical: String(vid('Live')), scope: 'all' } });
  assert.equal(items.length, 0);
});

test('members cannot create projects; managers can, only in their vertical', async () => {
  await rejects(call('rohan', 'POST', '/projects', { body: { vertical_id: vid('Exhibits'), name: 'New stall' } }), 403);
  await rejects(call('suresh', 'POST', '/projects', { body: { vertical_id: vid('Marketing'), name: 'Sneaky' } }), 400);
  const tpl = db.get('SELECT id FROM templates WHERE vertical_id = ? ORDER BY id LIMIT 1', vid('Exhibits')).id;
  const p = await call('suresh', 'POST', '/projects', {
    body: { vertical_id: vid('Exhibits'), name: 'Hospitality expo stall', client: 'Lotus Hotels', template_id: tpl, key_date: '2026-12-10', start_date: '2026-10-13' },
  });
  assert.match(p.code, /^EXH-26-\d{3}$/);
  assert.ok(p.tasks_created > 5);
  const tasks = await call('suresh', 'GET', `/projects/${p.id}/tasks`);
  assert.ok(tasks.items.every((t) => t.due_date >= '2026-10-13'), 'template tasks should not start in the past');
});

test('viewers can read but not change anything', async () => {
  const live = projectIn('Live');
  const p = await call('vikram', 'GET', `/projects/${live}`);
  assert.equal(p.permissions.contribute, false);
  await rejects(call('vikram', 'POST', `/projects/${live}/tasks`, { body: { title: 'x' } }), 403);
  await rejects(call('vikram', 'POST', `/projects/${live}/comments`, { body: { body: 'x' } }), 403);
  await rejects(call('vikram', 'POST', `/projects/${live}/files`, { body: { url: 'https://example.com' } }), 403);
});

test('tasks can only be assigned to people in the same vertical', async () => {
  const exh = projectIn('Exhibits');
  const kavita = db.get('SELECT id FROM users WHERE email = ?', demoEmail('kavita')).id;
  await rejects(call('rohan', 'POST', `/projects/${exh}/tasks`, { body: { title: 'Wrong person', assignee_id: kavita } }), 400);
  const tanvi = db.get('SELECT id FROM users WHERE email = ?', demoEmail('tanvi')).id;
  const t = await call('rohan', 'POST', `/projects/${exh}/tasks`, { body: { title: 'Revise logo size', assignee_id: tanvi, due_date: '2026-10-20' } });
  assert.equal(t.assignee_id, tanvi);
  const notes = await call('tanvi', 'GET', '/notifications');
  assert.ok(notes.items.some((n) => n.text.includes('Revise logo size')));
});

test('copying a past project shifts its plan to the new date', async () => {
  const past = db.get("SELECT id, key_date FROM projects WHERE status = 'completed' AND vertical_id = ? ORDER BY id LIMIT 1", vid('Exhibits'));
  const src = await call('suresh', 'GET', `/projects/${past.id}/tasks`);
  const copy = await call('suresh', 'POST', '/projects', { body: { vertical_id: vid('Exhibits'), name: 'Repeat stall', copy_from: past.id, key_date: '2027-09-20' } });
  const tasks = await call('suresh', 'GET', `/projects/${copy.id}/tasks`);
  assert.equal(tasks.items.length, src.items.length);
  assert.ok(tasks.items.every((t) => t.status === 'todo'));
});

test('admin access changes take effect immediately', async () => {
  const neha = db.get('SELECT id FROM users WHERE email = ?', demoEmail('neha')).id;
  await call('rajiv', 'PATCH', `/admin/users/${neha}`, { body: { access: { [vid('Exhibits')]: 'member', [vid('Live')]: 'viewer' } } });
  const after = await call('neha', 'GET', '/projects', { query: { scope: 'all' } });
  assert.deepEqual([...new Set(after.items.map((p) => p.vertical))].sort(), ['Exhibits', 'Live']);
  await rejects(call('neha', 'GET', '/admin/users'), 403);
});
