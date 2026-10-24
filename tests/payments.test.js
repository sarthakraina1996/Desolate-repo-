import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { migrate, seedBasics } from '../core/setup.js';
import { seedDemo, seedPayments, demoEmail } from '../core/demo-seed.js';
import { handle } from '../core/api.js';
import { loadUser } from '../core/access.js';

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
const idOf = (key) => db.get('SELECT id FROM users WHERE email = ?', demoEmail(key)).id;
const call = (who, method, path, { query, body } = {}) => handle({ db, user: loadUser(db, idOf(who)), query, body, services }, method, path);
const vid = (short) => db.get('SELECT id FROM verticals WHERE short = ?', short).id;
const rejects = (p, status) => assert.rejects(p, (e) => e.status === status);
const tick = (ms = 1000) => (clock += ms);

before(() => {
  db = openDb(':memory:');
  migrate(db);
  seedBasics(db);
  seedDemo(db, { today: TODAY, passwordHash: 'plain$demo1234' });
});

// A fresh Exhibits project owned by Rohan (a member), with a budget of ₹10,00,000.
async function newProject(budget = 1000000) {
  tick();
  return call('suresh', 'POST', '/projects', { body: { vertical_id: vid('Exhibits'), name: 'Payments test stall', client: 'Test client', owner_id: idOf('rohan'), budget } });
}

test('the owner and managers record payments; others cannot', async () => {
  const p = await newProject();
  tick();
  const first = await call('rohan', 'POST', `/projects/${p.id}/payments`, { body: { amount: '4,00,000', received_on: '2026-10-10', method: 'bank', reference: 'UTR 123', note: 'Advance, 40%' } });
  assert.equal(first.amount, 400000);
  assert.equal(first.created_by_name, 'Rohan Das');
  await call('suresh', 'POST', `/projects/${p.id}/payments`, { body: { amount: 100000, method: 'cheque' } }); // today by default
  await rejects(call('kunal', 'POST', `/projects/${p.id}/payments`, { body: { amount: 1000 } }), 403); // member, not the owner
  await rejects(call('vikram', 'POST', `/projects/${p.id}/payments`, { body: { amount: 1000 } }), 403); // viewer
  await rejects(call('kavita', 'POST', `/projects/${p.id}/payments`, { body: { amount: 1000 } }), 404); // other vertical
  await rejects(call('rajiv', 'DELETE', '/payments/999999'), 404);

  // Everyone who can see the project sees the money, like the budget.
  const seen = await call('vikram', 'GET', `/projects/${p.id}`);
  assert.equal(seen.received, 500000);
  assert.equal(seen.to_collect, 500000);
  assert.deepEqual(seen.payments.map((x) => x.amount), [100000, 400000]); // newest first
  assert.equal(seen.payments[0].received_on, TODAY);

  const listed = (await call('rohan', 'GET', '/projects', { query: { vertical: vid('Exhibits') } })).items.find((x) => x.id === p.id);
  assert.equal(listed.to_collect, 500000);

  const log = db.all("SELECT action, detail FROM activity WHERE project_id = ? AND action LIKE 'payment%' ORDER BY id", p.id);
  assert.deepEqual(log.map((a) => a.detail), ['₹4,00,000 (Advance, 40%)', '₹1,00,000']);
});

test('amounts, dates and methods are checked', async () => {
  const p = await newProject();
  const bad = (body) => rejects(call('rohan', 'POST', `/projects/${p.id}/payments`, { body }), 400);
  await bad({ amount: 0 });
  await bad({ amount: -5000 });
  await bad({ amount: 'lots' });
  await bad({});
  await bad({ amount: 1000, received_on: '2026-10-14' }); // tomorrow
  await bad({ amount: 1000, received_on: 'yesterday' });
  await bad({ amount: 1000, method: 'barter' });
  await bad({ amount: 1e12 });
  assert.equal(db.get('SELECT COUNT(*) AS n FROM payments WHERE project_id = ?', p.id).n, 0);
});

test('removing a payment puts the amount back to collect', async () => {
  const p = await newProject(200000);
  tick();
  const a = await call('rohan', 'POST', `/projects/${p.id}/payments`, { body: { amount: 150000 } });
  await rejects(call('kunal', 'DELETE', `/payments/${a.id}`), 403);
  await rejects(call('arvind', 'DELETE', `/payments/${a.id}`), 404);
  assert.equal((await call('rohan', 'GET', `/projects/${p.id}`)).to_collect, 50000);
  await call('suresh', 'DELETE', `/payments/${a.id}`);
  const after = await call('rohan', 'GET', `/projects/${p.id}`);
  assert.equal(after.received, 0);
  assert.equal(after.to_collect, 200000);
  assert.equal(db.get("SELECT detail FROM activity WHERE project_id = ? AND action = 'payment_removed'", p.id).detail, `₹1,50,000 received ${TODAY}`);
});

test('paying more than the budget leaves nothing to collect; no budget means unknown', async () => {
  const p = await newProject(100000);
  tick();
  await call('rohan', 'POST', `/projects/${p.id}/payments`, { body: { amount: 120000 } });
  const over = await call('rohan', 'GET', `/projects/${p.id}`);
  assert.equal(over.received, 120000);
  assert.equal(over.to_collect, 0);

  const none = await newProject(null);
  tick();
  await call('rohan', 'POST', `/projects/${none.id}/payments`, { body: { amount: 50000 } });
  const n = await call('rohan', 'GET', `/projects/${none.id}`);
  assert.equal(n.received, 50000);
  assert.equal(n.to_collect, null);
});

test('cancelled projects take no payments and drop out of what is to collect', async () => {
  const p = await newProject(300000);
  tick();
  await call('suresh', 'PATCH', `/projects/${p.id}`, { body: { status: 'cancelled' } });
  await rejects(call('suresh', 'POST', `/projects/${p.id}/payments`, { body: { amount: 1000 } }), 400);
  assert.equal((await call('suresh', 'GET', `/projects/${p.id}`)).to_collect, null);
  const dash = await call('suresh', 'GET', '/dashboard');
  assert.ok(!dash.collect.some((x) => x.id === p.id));
});

test('the dashboard adds up budget, received and to collect, per vertical and in total', async () => {
  const d = await call('rajiv', 'GET', '/dashboard');
  assert.ok(d.money.budget > 0 && d.money.received > 0 && d.money.to_collect > 0);
  assert.equal(Math.round(d.money.budget), Math.round(d.money.received + d.money.to_collect));
  assert.equal(Math.round(d.by_vertical.reduce((a, v) => a + v.to_collect, 0)), Math.round(d.money.to_collect));
  assert.ok(d.collect.length > 0 && d.collect.length <= 8);
  assert.ok(d.collect.every((x) => x.to_collect > 0 && x.to_collect === x.budget - x.received));
  // Delivered work still waiting for money comes first.
  const firstOpen = d.collect.findIndex((x) => !x.delivered);
  assert.ok(d.collect.some((x) => x.delivered), 'sample data has delivered work waiting for its last payment');
  assert.ok(firstOpen === -1 || d.collect.slice(firstOpen).every((x) => !x.delivered));

  // People only see money from their own verticals.
  const live = await call('arvind', 'GET', '/dashboard');
  assert.ok(live.collect.every((x) => x.vertical === 'Live'));
  assert.ok(live.money.to_collect < d.money.to_collect);
  const one = await call('rajiv', 'GET', '/dashboard', { query: { vertical: vid('Marketing') } });
  assert.ok(one.collect.every((x) => x.vertical === 'Marketing'));
});

test('sample payments: never in the future or before the project, and only added once', async () => {
  const fresh = openDb(':memory:');
  migrate(fresh);
  seedBasics(fresh);
  seedDemo(fresh, { today: TODAY, passwordHash: 'x' });
  const rows = fresh.all('SELECT pay.*, p.created_at AS project_created, p.status FROM payments pay JOIN projects p ON p.id = pay.project_id');
  assert.ok(rows.length > 10);
  for (const r of rows) {
    assert.ok(r.received_on <= TODAY, 'not in the future');
    assert.ok(r.received_on >= r.project_created.slice(0, 10), 'not before the project existed');
    assert.notEqual(r.status, 'cancelled');
  }
  assert.equal(seedPayments(fresh, { today: TODAY, now: `${TODAY}T12:00:00.000Z` }), false);

  // Sample data saved before payments existed gets them when it is upgraded.
  fresh.run('DELETE FROM payments');
  assert.equal(seedPayments(fresh, { today: TODAY, now: `${TODAY}T12:00:00.000Z` }), true);
  assert.equal(fresh.get('SELECT COUNT(*) AS n FROM payments').n, rows.length);
});
