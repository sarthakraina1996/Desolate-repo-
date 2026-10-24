import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as, U, ok } from './helpers.js';

let ctx;
before(async () => {
  ctx = await boot();
});
after(async () => ctx?.close());

test('every main GET endpoint answers for a general manager', async () => {
  const c = await as(ctx.base, U.gmDelhi);
  const pid = c.me.properties[0].id;
  const paths = [
    '/auth/me',
    '/org',
    '/properties',
    `/properties/${pid}`,
    `/room-types?property=${pid}`,
    `/rooms?property=${pid}`,
    `/rate-plans?property=${pid}`,
    `/rates/grid?property=${pid}`,
    '/guests?q=a',
    '/companies',
    `/reservations?property=${pid}`,
    `/calendar?property=${pid}`,
    `/frontdesk/boards?property=${pid}`,
    `/frontdesk/forecast?property=${pid}`,
    `/housekeeping/board?property=${pid}`,
    `/housekeeping/tasks?property=${pid}`,
    `/night-audit?property=${pid}`,
    `/invoices?property=${pid}`,
    `/finance/trial-balance?property=${pid}`,
    `/finance/journals?property=${pid}`,
    `/finance/city-ledger?property=${pid}`,
    `/finance/reconciliation?property=${pid}`,
    `/metrics/kpis?property=${pid}&preset=mtd`,
    `/metrics/series?property=${pid}&preset=last30`,
    `/metrics/breakdowns?property=${pid}&preset=mtd`,
    `/metrics/drilldown?property=${pid}&preset=mtd&metric=room_revenue`,
    '/metrics/definitions',
    `/dashboard?property=${pid}`,
    '/system/modules',
    '/system/status',
    `/audit?property=${pid}`,
    `/guest-requests?property=${pid}`,
    `/cashier/shift?property=${pid}`,
  ];
  for (const p of paths) {
    const r = await c.get(p);
    assert.equal(r.status, 200, `${p} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  }
  const room = ok(await c.get(`/rooms?property=${pid}`)).rooms[0];
  ok(await c.get(`/rooms/${room.id}`));
  const resv = ok(await c.get(`/reservations?property=${pid}&status=closed&limit=1`)).rows[0];
  const detail = ok(await c.get(`/reservations/${resv.id}`));
  ok(await c.get(`/folios/${detail.folios[0].id}`));
  const guest = ok(await c.get('/guests?q=a')).rows[0];
  ok(await c.get(`/guests/${guest.id}`));
});

test('the seeded demo reconciles (R1–R6)', async () => {
  const c = await as(ctx.base, U.cfo);
  const r = ok(await c.get('/finance/reconciliation'));
  for (const chk of r.checks) assert.ok(chk.ok, `${chk.id} ${chk.name}: ${chk.left} vs ${chk.right}`);
});
