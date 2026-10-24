// Metrics engine on controlled data: records coverage ("no data", never zero), the
// provisional open day, weighted multi-currency consolidation, OOO policy, and drill-downs
// that sum to the metric on the seeded demo.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BD, fixture } from './fixture.js';
import { boot, as, ok, U } from './helpers.js';
import { computeKpis } from '../server/modules/metrics/engine.js';
import { createBuilding, createProperty, updateProperty } from '../server/modules/properties/service.js';
import { saveRoom, saveRoomType, createBlock } from '../server/modules/rooms/service.js';
import { saveRatePlan } from '../server/modules/rates/service.js';
import { createBooking } from '../server/modules/reservations/service.js';
import { checkIn } from '../server/modules/frontdesk/service.js';
import { runNightAudit } from '../server/modules/nightaudit/service.js';
import { convert } from '../server/core/money.js';

const ID = { idType: 'passport', idNumber: 'X1234567', idCountry: 'PT', nowTime: '15:00' };
const kpis = (f, from, to, pids = [f.prop.id]) => computeKpis(f.db, { orgId: f.orgId, propertyIds: pids, from, to });

// A two-room Lisbon property (EUR, VAT-inclusive prices) in the fixture's organisation.
function addLisbon(f) {
  const p = createProperty(f.db, f.admin, f.orgId, { code: 'FXL', name: 'Lisbon', country: 'PT', timezone: 'Europe/Lisbon', currency: 'EUR', tax_regime: 'EU_VAT', prices_include_tax: 1, business_date: BD, invoice_prefix: 'FXL' });
  const b = createBuilding(f.db, f.admin, p.id, { code: 'M', name: 'Main', floors: [{ level: 1 }] });
  const floor = f.db.value('SELECT id FROM floors WHERE building_id = ?', b.id);
  const t = saveRoomType(f.db, f.admin, p.id, { code: 'DBL', name: 'Double', base_adults: 2, max_adults: 2, max_children: 1, max_occupancy: 3 });
  const rooms = [1, 2].map((i) => saveRoom(f.db, f.admin, p.id, { number: `L${i}`, building_id: b.id, floor_id: floor, room_type_id: t.id, commissioned_on: '2020-01-01' }).id);
  f.db.run("UPDATE rooms SET hk_status = 'inspected' WHERE property_id = ?", p.id);
  const plan = saveRatePlan(f.db, f.admin, p.id, { code: 'BAR', name: 'BAR', meal_plan: 'RO', roomTypes: [{ room_type_id: t.id, base_minor: 10600, weekend_minor: 10600 }] });
  f.db.run("INSERT INTO fx_rates (rate_date, from_currency, to_currency, rate_micros, source) VALUES ('2026-10-01', 'EUR', 'INR', 100000000, 'test')");
  return { prop: p, type: t, rooms, plan };
}

test('days before records begin are "no data", never zero', () => {
  const f = fixture();
  try {
    const none = kpis(f, '2026-10-01', '2026-10-23');
    assert.equal(none.coverage, null);
    for (const k of ['available_room_nights', 'occupancy_pct', 'room_revenue', 'total_operating_revenue', 'adr']) assert.equal(none.consolidated.metrics[k], null, k);
    const part = kpis(f, '2026-10-20', BD);
    assert.deepEqual(part.coverage, { from: BD, to: BD, partial: true });
    assert.equal(part.consolidated.metrics.available_room_nights, 8, 'only the covered day counts');
    assert.equal(part.properties[0].recordsFrom, BD);
  } finally {
    f.close();
  }
});

test('the open day is provisional until the night audit posts it', () => {
  const f = fixture();
  try {
    const r = f.book(f.actors.front_desk, { roomId: f.rooms.DLX[0] });
    checkIn(f.db, f.actors.front_desk, r.id, { ...ID, idCountry: 'IN' });
    const open = kpis(f, BD, BD);
    assert.equal(open.provisional, true);
    assert.equal(open.consolidated.metrics.provisional_room_revenue, 500000);
    assert.equal(open.consolidated.metrics.room_revenue, 500000);
    assert.equal(open.consolidated.metrics.sold_room_nights, 1);
    runNightAudit(f.db, f.actors.gm, f.prop.id);
    const closed = kpis(f, BD, BD);
    assert.equal(closed.provisional, false);
    assert.equal(closed.consolidated.metrics.provisional_room_revenue, 0);
    assert.equal(closed.consolidated.measures.room_revenue, 500000, 'the estimate became the posted figure');
  } finally {
    f.close();
  }
});

test('portfolio figures convert each night at its month’s rate, then weight by rooms', () => {
  const f = fixture();
  try {
    const L = addLisbon(f);
    // Delhi: 2 of 8 rooms sold at ₹5,000 net. Lisbon: 1 of 2 sold at €106 incl. 6% VAT (€100 net).
    for (const roomId of [f.rooms.DLX[0], f.rooms.DLX[1]]) {
      const r = f.book(f.actors.front_desk, { roomId, departure: '2026-10-25' });
      checkIn(f.db, f.actors.front_desk, r.id, { ...ID, idCountry: 'IN' });
    }
    const b = createBooking(f.db, f.admin, { propertyId: L.prop.id, guest: { first_name: 'Ana', last_name: 'Silva' }, source: 'Direct', rooms: [{ roomTypeId: L.type.id, ratePlanId: L.plan.id, arrival: BD, departure: '2026-10-25', adults: 2, roomId: L.rooms[0] }] });
    checkIn(f.db, f.admin, b.reservations[0].id, ID);
    runNightAudit(f.db, f.admin, f.prop.id);
    runNightAudit(f.db, f.admin, L.prop.id);
    const k = kpis(f, BD, BD, [f.prop.id, L.prop.id]);
    const lisbon = k.properties.find((p) => p.code === 'FXL');
    assert.equal(lisbon.metrics.room_revenue, 10000, '€100.00 net of VAT, in EUR');
    assert.equal(lisbon.reporting.room_revenue, convert(10000, 100000000, 'EUR', 'INR'));
    const c = k.consolidated.metrics;
    assert.equal(c.room_revenue, 2 * 500000 + 1000000);
    assert.equal(c.available_room_nights, 10);
    assert.equal(c.occupancy_pct, 30, '3 of 10 rooms — not the 37.5% average of 25% and 50%');
    assert.equal(c.adr, Math.round(2000000 / 3));
    assert.deepEqual(k.fx.map((x) => [x.pair, x.rate]), [['EUR→INR 2026-10', 100]]);
  } finally {
    f.close();
  }
});

test('out-of-order rooms leave available rooms unless the property excludes them', () => {
  const f = fixture();
  try {
    createBlock(f.db, f.admin, f.prop.id, { roomId: f.rooms.STE[0], kind: 'ooo', startDate: BD, endDate: '2026-10-25', reason: 'Repair' });
    assert.equal(kpis(f, BD, BD).consolidated.metrics.available_room_nights, 8);
    assert.equal(kpis(f, BD, BD).consolidated.metrics.ooo_room_nights, 1);
    updateProperty(f.db, f.admin, f.prop.id, { exclude_ooo_from_available: 1 });
    assert.equal(kpis(f, BD, BD).consolidated.metrics.available_room_nights, 7);
  } finally {
    f.close();
  }
});

let ctx;
before(async () => {
  ctx = await boot();
});
after(async () => ctx?.close());

test('drill-downs sum to the metric, and the dashboard agrees with the KPI API', async () => {
  const c = await as(ctx.base, U.gmDelhi);
  const pid = c.me.properties[0].id;
  const q = `property=${pid}&preset=last30`;
  const k = ok(await c.get(`/metrics/kpis?${q}`));
  for (const metric of ['fnb_revenue', 'spa_revenue', 'rooms_other_revenue']) {
    const d = ok(await c.get(`/metrics/drilldown?${q}&metric=${metric}&limit=1`));
    assert.equal(d.sum_minor, k.consolidated.metrics[metric], metric);
  }
  // Room revenue over closed days: posted rows equal the metric exactly.
  const room = ok(await c.get(`/metrics/drilldown?${q}&metric=room_revenue&limit=1`));
  assert.equal(room.sum_minor, k.consolidated.metrics.room_revenue - k.consolidated.metrics.provisional_room_revenue);
  const nights = ok(await c.get(`/metrics/drilldown?${q}&metric=sold_room_nights&limit=1`));
  assert.equal(nights.total, k.consolidated.metrics.sold_room_nights);
  const d = ok(await c.get(`/dashboard?${q}`));
  for (const key of ['occupancy_pct', 'adr', 'revpar', 'total_operating_revenue', 'sold_room_nights']) assert.equal(d.kpis[key], k.consolidated.metrics[key], key);
  assert.equal(d.trend.length, 12);
});

test('portfolio consolidation over the demo equals the sum of its properties', async () => {
  const c = await as(ctx.base, U.cfo);
  const k = ok(await c.get('/metrics/kpis?preset=mtd'));
  assert.equal(k.properties.length, 5);
  const sum = (key) => k.properties.reduce((a, p) => a + p.reporting[key], 0);
  for (const key of ['available_room_nights', 'sold_room_nights', 'room_revenue', 'total_operating_revenue']) assert.equal(k.consolidated.metrics[key], sum(key), key);
  const m = k.consolidated.metrics;
  assert.equal(m.occupancy_pct, (m.sold_room_nights / m.available_room_nights) * 100);
  assert.ok(k.fx.some((x) => x.pair.startsWith('EUR→INR')), 'Lisbon was converted');
});
