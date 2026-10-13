import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { migrate, seedBasics } from '../core/setup.js';
import { seedDemo, demoEmail } from '../core/demo-seed.js';
import { handle } from '../core/api.js';
import { loadUser } from '../core/access.js';
import { SCHEMA_V1 } from './fixtures/schema-v1.js';

const TODAY = '2026-10-13';
let clock = Date.parse(`${TODAY}T10:00:00.000Z`);
let db;
const services = {
  today: () => TODAY,
  now: () => new Date(clock).toISOString(),
  hashPassword: async (p) => `plain$${p}`,
  verifyPassword: async (p, h) => h === `plain$${p}`,
  removeStored: async () => {},
};
const as = (key) => loadUser(db, db.get('SELECT id FROM users WHERE email = ?', demoEmail(key)).id);
const call = (who, method, path, { query, body } = {}) => handle({ db, user: as(who), query, body, services }, method, path);
const vid = (short) => db.get('SELECT id FROM verticals WHERE short = ?', short).id;
const rejects = (p, status) => assert.rejects(p, (e) => e.status === status);
const exhProject = () => db.get("SELECT id FROM projects WHERE vertical_id = ? AND status = 'active' ORDER BY id LIMIT 1", vid('Exhibits')).id;

before(() => {
  db = openDb(':memory:');
  migrate(db);
  seedBasics(db);
  seedDemo(db, { today: TODAY, passwordHash: 'plain$demo1234' });
});

test('a comment can be deleted by its author within 15 seconds', async () => {
  const pid = exhProject();
  const c = await call('rohan', 'POST', `/projects/${pid}/comments`, { body: { body: 'Typo here' } });
  assert.equal(c.can_delete, true);
  assert.ok(c.delete_ms_left > 14000 && c.delete_ms_left <= 15000);
  clock += 10_000;
  await call('rohan', 'DELETE', `/comments/${c.id}`);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM comments WHERE id = ?', c.id).n, 0);
});

test('after 15 seconds deleting needs a head to approve', async () => {
  const pid = exhProject();
  const c = await call('rohan', 'POST', `/projects/${pid}/comments`, { body: { body: 'Wrong project, sorry' } });
  clock += 30_000;
  await rejects(call('rohan', 'DELETE', `/comments/${c.id}`), 403);

  const { comments } = await call('rohan', 'GET', `/projects/${pid}/activity`);
  const mine = comments.find((x) => x.id === c.id);
  assert.equal(mine.can_delete, false);
  assert.equal(mine.can_request_delete, true);

  // Other people cannot ask or decide; members are not heads.
  await rejects(call('neha', 'POST', `/comments/${c.id}/delete-request`), 403);
  await call('rohan', 'POST', `/comments/${c.id}/delete-request`);
  await rejects(call('neha', 'POST', `/comments/${c.id}/delete-decision`, { body: { approve: true } }), 403);
  // Heads of another vertical cannot even see it.
  await rejects(call('kavita', 'POST', `/comments/${c.id}/delete-decision`, { body: { approve: true } }), 404);

  const notes = await call('suresh', 'GET', '/notifications');
  assert.ok(notes.items.some((n) => n.text.includes('asks to delete a comment')));
  const view = (await call('suresh', 'GET', `/projects/${pid}/activity`)).comments.find((x) => x.id === c.id);
  assert.equal(view.can_decide, true);

  await rejects(call('rohan', 'DELETE', `/comments/${c.id}`), 403); // still pending
  await call('suresh', 'POST', `/comments/${c.id}/delete-decision`, { body: { approve: true } });
  const after = (await call('rohan', 'GET', `/projects/${pid}/activity`)).comments.find((x) => x.id === c.id);
  assert.equal(after.can_delete, true);
  await call('rohan', 'DELETE', `/comments/${c.id}`);
  const log = (await call('suresh', 'GET', `/projects/${pid}/activity`)).activity;
  assert.ok(log.some((a) => a.action === 'comment_deleted' && a.detail === 'Suresh Iyer'));
});

test('a declined request keeps the comment, and nobody else can delete it', async () => {
  const pid = exhProject();
  const c = await call('rohan', 'POST', `/projects/${pid}/comments`, { body: { body: 'Keep me' } });
  clock += 30_000;
  await call('rohan', 'POST', `/comments/${c.id}/delete-request`);
  await call('suresh', 'POST', `/comments/${c.id}/delete-decision`, { body: { approve: false } });
  await rejects(call('rohan', 'DELETE', `/comments/${c.id}`), 403);
  await rejects(call('rajiv', 'DELETE', `/comments/${c.id}`), 403);
  // Heads cannot approve their own comments.
  const own = await call('suresh', 'POST', `/projects/${pid}/comments`, { body: { body: 'Head comment' } });
  clock += 30_000;
  await call('suresh', 'POST', `/comments/${own.id}/delete-request`);
  await rejects(call('suresh', 'POST', `/comments/${own.id}/delete-decision`, { body: { approve: true } }), 403);
  await call('rajiv', 'POST', `/comments/${own.id}/delete-decision`, { body: { approve: true } });
  await call('suresh', 'DELETE', `/comments/${own.id}`);
});

test('task comments follow the same rule', async () => {
  const pid = exhProject();
  const task = db.get('SELECT id FROM tasks WHERE project_id = ? LIMIT 1', pid).id;
  const c = await call('rohan', 'POST', `/projects/${pid}/comments`, { body: { body: 'On the task', task_id: task } });
  const detail = await call('rohan', 'GET', `/tasks/${task}`);
  assert.equal(detail.comments.find((x) => x.id === c.id).can_delete, true);
  clock += 16_000 + 5_000;
  await rejects(call('rohan', 'DELETE', `/comments/${c.id}`), 403);
});

test('Ready for Event / Exhibition is an Exhibits-only status', async () => {
  const exh = exhProject();
  const p = await call('suresh', 'PATCH', `/projects/${exh}`, { body: { status: 'ready' } });
  assert.equal(p.status, 'ready');
  assert.equal(p.ready_label, 'Ready for Event / Exhibition');
  // Still an open project: it shows on the board and the dashboard, not in Past Projects.
  assert.ok((await call('suresh', 'GET', '/projects')).items.some((x) => x.id === exh));
  assert.ok(!(await call('suresh', 'GET', '/projects', { query: { scope: 'past' } })).items.some((x) => x.id === exh));

  const mkt = db.get('SELECT id FROM projects WHERE vertical_id = ? AND status = ? LIMIT 1', vid('Marketing'), 'active').id;
  await rejects(call('kavita', 'PATCH', `/projects/${mkt}`, { body: { status: 'ready' } }), 400);
  const delivered = await call('kavita', 'PATCH', `/projects/${mkt}`, { body: { status: 'completed' } });
  assert.equal(delivered.status, 'completed');
});

test('board order is saved without cluttering the activity log', async () => {
  const exh = exhProject();
  const before = db.get('SELECT COUNT(*) AS n FROM activity WHERE project_id = ?', exh).n;
  const p = await call('suresh', 'PATCH', `/projects/${exh}`, { body: { board_sort: 2.5 } });
  assert.equal(p.board_sort, 2.5);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM activity WHERE project_id = ?', exh).n, before);
  // Members can only move projects they own.
  const notNehas = db.get("SELECT p.id FROM projects p JOIN users u ON u.id = p.owner_id WHERE p.vertical_id = ? AND u.email != ? LIMIT 1", vid('Exhibits'), demoEmail('neha')).id;
  await rejects(call('neha', 'PATCH', `/projects/${notNehas}`, { body: { board_sort: 1 } }), 403);
});

test('cards carry a cover image when the project has one', async () => {
  const { items } = await call('suresh', 'GET', '/projects', { query: { scope: 'all' } });
  const withCover = items.filter((p) => p.cover);
  assert.ok(withCover.length > 0);
  assert.ok(withCover.every((p) => p.cover.mime.startsWith('image/') && p.cover.id > 0));
});

test('a version 1 database upgrades without losing data', () => {
  const old = openDb(':memory:');
  old.exec('PRAGMA foreign_keys = ON;');
  old.exec(SCHEMA_V1);
  old.run("INSERT INTO settings (key, value) VALUES ('schema_version', '1')");
  old.run("INSERT INTO verticals (id, name, short, code, color, key_date_label, sort) VALUES (1, 'BrainADZ Exhibits', 'Exhibits', 'EXH', '#8CC63F', 'Show opens', 1)");
  old.run("INSERT INTO users (id, name, email, role) VALUES (1, 'Admin', 'a@b.co', 'admin')");
  old.run("INSERT INTO projects (id, code, vertical_id, name, status, owner_id) VALUES (7, 'EXH-26-001', 1, 'Old stall', 'active', 1)");
  old.run("INSERT INTO tasks (project_id, title) VALUES (7, 'Build')");
  old.run("INSERT INTO comments (project_id, user_id, body, created_at) VALUES (7, 1, 'hello', '2026-01-01T00:00:00.000Z')");

  migrate(old);

  assert.equal(old.get("SELECT value FROM settings WHERE key = 'schema_version'").value, '2');
  assert.equal(old.get('SELECT ready_label FROM verticals WHERE id = 1').ready_label, 'Ready for Event / Exhibition');
  old.run("UPDATE projects SET status = 'ready', board_sort = 1 WHERE id = 7");
  assert.equal(old.get('SELECT status FROM projects WHERE id = 7').status, 'ready');
  assert.equal(old.get('SELECT COUNT(*) AS n FROM tasks WHERE project_id = 7').n, 1);
  assert.equal(old.get('SELECT delete_status FROM comments').delete_status, null);
  assert.deepEqual(old.all('PRAGMA foreign_key_check'), []);
  // Foreign keys still cascade after the rebuild.
  old.run('DELETE FROM projects WHERE id = 7');
  assert.equal(old.get('SELECT COUNT(*) AS n FROM tasks').n, 0);
  migrate(old); // running again is harmless
});
