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
const idOf = (key) => db.get('SELECT id FROM users WHERE email = ?', demoEmail(key)).id;
const call = (who, method, path, { query, body } = {}) => handle({ db, user: loadUser(db, idOf(who)), query, body, services }, method, path);
const vid = (short) => db.get('SELECT id FROM verticals WHERE short = ?', short).id;

before(() => {
  db = openDb(':memory:');
  migrate(db);
  seedBasics(db);
  seedDemo(db, { today: TODAY, passwordHash: 'plain$demo1234' });
});

test('a future project added from the calendar shows on its day, marked as planned', async () => {
  const p = await call('suresh', 'POST', '/projects', {
    body: { vertical_id: vid('Exhibits'), name: 'Auto Expo 2027 pavilion', client: 'Northwind Motors', key_date: '2027-01-18', start_date: TODAY, status: 'planning' },
  });
  assert.equal(p.status, 'planning');
  const { items } = await call('rohan', 'GET', '/calendar', { query: { from: '2027-01-01', to: '2027-01-31', tasks: 'none' } });
  const day = items.find((it) => it.project_id === p.id && it.type === 'key');
  assert.equal(day.date, '2027-01-18');
  assert.equal(day.status, 'planning');
  assert.equal(day.label, 'Show opens');
  // Members cannot add projects; other verticals do not see it.
  await assert.rejects(call('rohan', 'POST', '/projects', { body: { vertical_id: vid('Exhibits'), name: 'Not allowed', key_date: '2027-02-01' } }), (e) => e.status === 403);
  const other = await call('kavita', 'GET', '/calendar', { query: { from: '2027-01-01', to: '2027-01-31', tasks: 'none' } });
  assert.ok(!other.items.some((it) => it.project_id === p.id));
});
