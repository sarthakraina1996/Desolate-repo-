// Reservation engine: double-booking prevention, inventory control, restrictions,
// optimistic concurrency, idempotent creation, cancellation and modification.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { BD, fixture, rejects } from './fixture.js';
import { openDb } from '../server/db/connection.js';
import { assignRoom, cancelReservation, createBooking, modifyReservation } from '../server/modules/reservations/service.js';
import { availability } from '../server/modules/reservations/inventory.js';
import { createBlock } from '../server/modules/rooms/service.js';
import { setRestrictions } from '../server/modules/rates/service.js';

test('a room can never hold two stays on the same night', () => {
  const f = fixture();
  try {
    const room = f.rooms.DLX[0];
    const a = f.book(undefined, { roomId: room });
    assert.equal(a.room_id, room);
    const e = rejects(() => f.book(undefined, { roomId: room, arrival: '2026-10-25', departure: '2026-10-27' }), 409, 'room_taken');
    assert.equal(e.details.night, '2026-10-25');
    assert.match(e.message, new RegExp(a.conf_no));
    // A rejected booking leaves nothing behind (the whole transaction rolled back).
    assert.equal(f.db.value('SELECT COUNT(*) FROM reservations'), 1);
    // Back-to-back stays share the room: departure day is free.
    const b = f.book(undefined, { roomId: room, arrival: '2026-10-26', departure: '2026-10-28' });
    assert.equal(b.room_id, room);
    // The lock is physical: even a raw insert of the same room-night fails.
    assert.throws(() => f.db.run('INSERT INTO room_nights (room_id, night, property_id, reservation_id) VALUES (?, ?, ?, ?)', room, BD, f.prop.id, b.id), /UNIQUE|PRIMARY/);
  } finally {
    f.close();
  }
});

test('two connections assigning the same room: exactly one wins', () => {
  const f = fixture();
  const db2 = openDb(path.join(f.dir, 'fx.db'));
  try {
    const a = f.book();
    const b = f.book();
    const room = f.rooms.DLX[1];
    const results = [];
    for (const [db, id] of [[f.db, a.id], [db2, b.id]]) {
      try {
        assignRoom(db, f.actors.front_desk, id, room);
        results.push('ok');
      } catch (e) {
        results.push(e.code);
      }
    }
    assert.deepEqual(results, ['ok', 'room_taken']);
    assert.equal(f.db.value('SELECT COUNT(DISTINCT reservation_id) FROM room_nights WHERE room_id = ?', room), 1);
  } finally {
    db2.close();
    f.close();
  }
});

test('a room type cannot be sold beyond its rooms; overbooking needs policy and override', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 6; i++) f.book();
    const e = rejects(() => f.book(), 409, 'sold_out');
    assert.equal(e.details.nights[0].available, 0);
    // An override without an overbooking allowance still cannot oversell.
    rejects(() => f.book(undefined, {}, {}, { allowOverbooking: true }), 409, 'sold_out');
    // Unassigned nights and blocks reduce availability too.
    assert.equal(availability(f.db, f.prop.id, BD, '2026-10-26')[f.types.dlx.id][BD].available, 0);
  } finally {
    f.close();
  }
  const g = fixture({ overbookingPct: 20 });
  try {
    for (let i = 0; i < 6; i++) g.book();
    rejects(() => g.book(), 409, 'sold_out');
    const over = g.book(undefined, {}, {}, { allowOverbooking: true }); // floor(6 × 20%) = 1 extra
    assert.equal(over.status, 'confirmed');
    rejects(() => g.book(undefined, {}, {}, { allowOverbooking: true }), 409, 'sold_out');
  } finally {
    g.close();
  }
});

test('out-of-order rooms are not sellable', () => {
  const f = fixture();
  try {
    createBlock(f.db, f.admin, f.prop.id, { roomId: f.rooms.STE[0], kind: 'ooo', startDate: BD, endDate: '2026-10-26', reason: 'Leak' });
    f.book(undefined, { roomTypeId: f.types.ste.id });
    rejects(() => f.book(undefined, { roomTypeId: f.types.ste.id }), 409, 'sold_out');
    rejects(() => f.book(undefined, { roomTypeId: f.types.ste.id, roomId: f.rooms.STE[0], arrival: '2026-10-25', departure: '2026-10-26' }, {}, { allowOverbooking: true }), 409);
  } finally {
    f.close();
  }
});

test('restrictions block sales unless a manager overrides them', () => {
  const f = fixture();
  try {
    setRestrictions(f.db, f.admin, f.prop.id, { from: BD, to: '2026-10-25', values: { min_los: 3 } });
    const e = rejects(() => f.book(), 409, 'restricted');
    assert.match(e.message, /Minimum stay of 3 nights/);
    setRestrictions(f.db, f.admin, f.prop.id, { roomTypeId: f.types.dlx.id, from: '2026-10-30', to: '2026-10-31', values: { stop_sell: true } });
    rejects(() => f.book(undefined, { arrival: '2026-10-29', departure: '2026-11-01' }), 409, 'restricted');
    const ok = f.book(undefined, {}, {}, { overrideRestrictions: true });
    assert.equal(ok.status, 'confirmed');
  } finally {
    f.close();
  }
});

test('stays are priced from the rate plan, per night', () => {
  const f = fixture();
  try {
    const r = f.book(undefined, { adults: 3, arrival: BD, departure: '2026-10-27' });
    assert.deepEqual(r.nights.map((n) => n.rate_minor), [600000, 600000, 600000]); // base + one extra adult
    assert.equal(r.total_minor, 1800000);
    const bb = f.book(undefined, { ratePlanId: f.plans.bb.id });
    assert.equal(bb.nights[0].rate_minor, 660000); // BAR + 1,600 package
  } finally {
    f.close();
  }
});

test('stale edits are rejected (optimistic concurrency)', () => {
  const f = fixture();
  try {
    const r = f.book();
    const updated = modifyReservation(f.db, f.actors.front_desk, r.id, { special_requests: 'High floor' }, { version: r.version });
    assert.equal(updated.version, r.version + 1);
    const e = rejects(() => modifyReservation(f.db, f.actors.front_desk, r.id, { special_requests: 'Low floor' }, { version: r.version }), 409, 'stale_version');
    assert.equal(e.details.current, r.version + 1);
  } finally {
    f.close();
  }
});

test('changing dates reprices the stay and keeps the room where it is free', () => {
  const f = fixture();
  try {
    const room = f.rooms.DLX[2];
    const r = f.book(undefined, { roomId: room });
    const m = modifyReservation(f.db, f.actors.front_desk, r.id, { departure: '2026-10-28' }, { version: r.version });
    assert.equal(m.nights.length, 4);
    assert.equal(m.total_minor, 2000000);
    assert.equal(m.room_id, room);
    assert.equal(f.db.value('SELECT COUNT(*) FROM room_nights WHERE reservation_id = ?', r.id), 4);
    // Shortening releases the nights it no longer needs.
    modifyReservation(f.db, f.actors.front_desk, r.id, { departure: '2026-10-25' }, { version: m.version });
    assert.equal(f.db.value('SELECT COUNT(*) FROM room_nights WHERE reservation_id = ?', r.id), 1);
  } finally {
    f.close();
  }
});

test('booking creation is idempotent per key, and channel references are unique', () => {
  const f = fixture();
  try {
    const input = {
      propertyId: f.prop.id,
      guest: { first_name: 'Ida', last_name: 'Empotent' },
      source: 'Direct',
      rooms: [{ roomTypeId: f.types.dlx.id, ratePlanId: f.plans.bar.id, arrival: BD, departure: '2026-10-25', adults: 1 }],
    };
    const a = createBooking(f.db, f.actors.front_desk, input, { idempotencyKey: 'key-1' });
    const b = createBooking(f.db, f.actors.front_desk, input, { idempotencyKey: 'key-1' });
    assert.equal(a.booking.id, b.booking.id);
    assert.equal(f.db.value('SELECT COUNT(*) FROM reservations'), 1);
    assert.equal(f.db.value('SELECT COUNT(*) FROM guests'), 1);
    const ota = { ...input, source: 'OTA', channel: 'Booking.com', channelRef: 'BDC-1' };
    createBooking(f.db, f.actors.front_desk, ota);
    rejects(() => createBooking(f.db, f.actors.front_desk, ota), 409);
  } finally {
    f.close();
  }
});

test('cancelling releases the room and inventory; the fee follows the policy', () => {
  const f = fixture();
  try {
    const r = f.book(undefined, { roomId: f.rooms.DLX[0], arrival: '2026-11-10', departure: '2026-11-12' });
    const before = availability(f.db, f.prop.id, '2026-11-10', '2026-11-12')[f.types.dlx.id]['2026-11-10'].available;
    rejects(() => cancelReservation(f.db, f.actors.front_desk, r.id, {}), 400);
    const c = cancelReservation(f.db, f.actors.front_desk, r.id, { reason: 'Plans changed', nowLocal: '2026-10-24T10:00' });
    assert.equal(c.status, 'cancelled');
    assert.equal(c.feePosted, null, 'free cancellation well before arrival');
    assert.equal(f.db.value('SELECT COUNT(*) FROM room_nights WHERE reservation_id = ?', r.id), 0);
    assert.equal(availability(f.db, f.prop.id, '2026-11-10', '2026-11-12')[f.types.dlx.id]['2026-11-10'].available, before + 1);
    rejects(() => cancelReservation(f.db, f.actors.front_desk, r.id, { reason: 'Again' }), 409);
  } finally {
    f.close();
  }
});
