// Reservation engine: bookings with one or more room stays, the lifecycle state machine,
// pricing, restriction and inventory validation, per-night room assignment (moves, splits,
// upgrades), modification history, cancellation and no-show with policy fees.
import { stamp } from '../../core/clock.js';
import { conflict, fail, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { nextNumber, pad } from '../../core/sequences.js';
import { addDays, diffDays, nights as nightsOf, timeIn, todayIn } from '../../core/dates.js';
import { bpOf } from '../../core/money.js';
import { json } from '../../db/connection.js';
import { assertInventory, HOLDING } from './inventory.js';
import { checkRestrictions, priceStay, RESTRICTION_TEXT } from '../rates/service.js';
import { saveGuest } from '../guests/service.js';
import { ensureGuestFolio, postCharge, folioBalance } from '../folios/service.js';

export const SOURCES = ['Direct', 'Website', 'Phone', 'Walk-in', 'Corporate', 'Group', 'Travel Agent', 'OTA'];
// Sources booked without an intermediary (direct booking % in the metrics engine).
export const DIRECT_SOURCES = ['Direct', 'Website', 'Phone', 'Walk-in', 'Corporate', 'Group'];
export const SEGMENTS = ['Leisure', 'Corporate', 'Group', 'MICE', 'Government', 'Long stay', 'Crew'];
export const STATUSES = ['quote', 'confirmed', 'in_house', 'checked_out', 'closed', 'cancelled', 'no_show'];

// Allowed status transitions (PRD RES-2). Check-in/out are performed by the front-desk module.
export const TRANSITIONS = {
  quote: ['confirmed', 'cancelled'],
  confirmed: ['in_house', 'cancelled', 'no_show'],
  in_house: ['checked_out'],
  checked_out: ['closed'],
  closed: [],
  cancelled: [],
  no_show: [],
};
export function assertTransition(from, to) {
  if (!TRANSITIONS[from]?.includes(to))
    conflict(`A ${from.replace('_', '-')} reservation cannot become ${to.replace('_', '-')}`, {
      code: 'invalid_transition',
      details: { from, to },
    });
}

export const loadProperty = (db, id) => {
  const p = db.get('SELECT * FROM properties WHERE id = ?', id);
  if (!p) notFound('Property');
  return p;
};

function record(db, actor, res, action, changes) {
  db.run(
    'INSERT INTO reservation_history (reservation_id, action, changes, user_id, at) VALUES (?, ?, ?, ?, ?)',
    res.id,
    action,
    changes ? JSON.stringify(changes) : null,
    actor?.id ?? null,
    stamp(actor),
  );
  audit(db, actor, `reservation.${action}`, {
    entity: 'reservation',
    entityId: res.id,
    propertyId: res.property_id,
    after: changes ?? undefined,
  });
  emit(db, {
    propertyId: res.property_id,
    entity: 'reservation',
    entityUid: res.uid,
    op: action,
    payload: { conf_no: res.conf_no, ...(changes || {}) },
  });
}

function policySnapshot(db, prop, ratePlanId) {
  const pid =
    (ratePlanId && db.value('SELECT cancellation_policy_id FROM rate_plans WHERE id = ?', ratePlanId)) ||
    prop.default_cancellation_policy_id;
  const p = pid ? db.get('SELECT * FROM cancellation_policies WHERE id = ?', pid) : null;
  return p
    ? {
        code: p.code,
        name: p.name,
        free_cancel_hours: p.free_cancel_hours,
        penalty_kind: p.penalty_kind,
        penalty_bp: p.penalty_bp,
        no_show_kind: p.no_show_kind,
        non_refundable: p.non_refundable,
      }
    : null;
}

function roomTypeOf(db, prop, roomTypeId) {
  const t = db.get('SELECT * FROM room_types WHERE id = ? AND property_id = ?', roomTypeId, prop.id);
  if (!t) fail(400, 'Room type not found at this property');
  return t;
}

function ratePlanOf(db, prop, ratePlanId, roomTypeId) {
  if (!ratePlanId) return null;
  const p = db.get('SELECT * FROM rate_plans WHERE id = ? AND property_id = ? AND active = 1', ratePlanId, prop.id);
  if (!p) fail(400, 'Rate plan not found at this property');
  // A derived plan is sold for the room types its root plan prices.
  let root = p;
  for (let i = 0; root.parent_id && i < 5; i++) root = db.get('SELECT * FROM rate_plans WHERE id = ?', root.parent_id);
  if (!db.value('SELECT 1 FROM rate_plan_room_types WHERE rate_plan_id = ? AND room_type_id = ?', root.id, roomTypeId))
    fail(400, `${p.name} is not sold for this room type`);
  return p;
}

// Nightly rates for a stay: the rate plan's prices, or a manual flat rate per night.
function priceNights(db, prop, type, { ratePlanId, arrival, departure, adults, children, rateMinor, isComplimentary }) {
  if (isComplimentary) return nightsOf(arrival, departure).map((night) => ({ night, rate_minor: 0 }));
  if (rateMinor != null) return nightsOf(arrival, departure).map((night) => ({ night, rate_minor: rateMinor }));
  if (!ratePlanId) fail(400, 'Choose a rate plan or enter a rate');
  return priceStay(db, {
    propertyId: prop.id,
    ratePlanId,
    roomTypeId: type.id,
    arrival,
    departure,
    adults,
    children,
    baseAdults: type.base_adults,
  });
}

function validateOccupancy(type, adults, children) {
  if (adults > type.max_adults) fail(400, `${type.name} sleeps at most ${type.max_adults} adults`);
  if (children > type.max_children) fail(400, `${type.name} allows at most ${type.max_children} children`);
  if (adults + children > type.max_occupancy) fail(400, `${type.name} allows at most ${type.max_occupancy} guests`);
}

function restrictionsOk(db, prop, { roomTypeId, ratePlanId, arrival, departure }, override) {
  const v = checkRestrictions(db, { propertyId: prop.id, roomTypeId, ratePlanId, arrival, departure });
  if (v.length && !override)
    conflict(RESTRICTION_TEXT[v[0].code](v[0]), { code: 'restricted', details: { restrictions: v } });
  return v;
}

const holderOf = (db, roomId, night) =>
  db.get(
    `SELECT rn.reservation_id, rn.block_id, r.conf_no, g.first_name || ' ' || g.last_name AS guest, b.kind, b.reason
     FROM room_nights rn LEFT JOIN reservations r ON r.id = rn.reservation_id LEFT JOIN guests g ON g.id = r.guest_id
     LEFT JOIN room_blocks b ON b.id = rn.block_id WHERE rn.room_id = ? AND rn.night = ?`,
    roomId,
    night,
  );

// Claims `nights` of `roomId` for the reservation. The primary key on room_nights is the
// guarantee; this turns a violation into a clear 409 naming who holds the room.
function claim(db, res, room, nights) {
  for (const night of nights) {
    try {
      db.run(
        'INSERT INTO room_nights (room_id, night, property_id, reservation_id) VALUES (?, ?, ?, ?)',
        room.id,
        night,
        res.property_id,
        res.id,
      );
    } catch (e) {
      if (!/UNIQUE|PRIMARY KEY/i.test(e.message)) throw e;
      const h = holderOf(db, room.id, night);
      if (h?.block_id)
        conflict(`Room ${room.number} is ${h.kind === 'ooo' ? 'out of order' : 'out of service'} on ${night} (${h.reason})`, {
          code: 'room_blocked',
          details: { roomId: room.id, night },
        });
      conflict(`Room ${room.number} is already taken on ${night} by ${h?.conf_no} (${h?.guest})`, {
        code: 'room_taken',
        details: { roomId: room.id, night, reservationId: h?.reservation_id, confNo: h?.conf_no },
      });
    }
  }
}

// Assigns `nights` of a reservation to a room after checking the room, its type and occupancy.
function applyAssignment(db, prop, res, roomId, nights, { allowTypeChange = false, allowOverbooking = false, force = false } = {}) {
  const room = db.get(
    `SELECT r.*, t.name AS type_name, COALESCE(r.max_adults, t.max_adults) AS cap_adults,
            COALESCE(r.max_children, t.max_children) AS cap_children
     FROM rooms r JOIN room_types t ON t.id = r.room_type_id WHERE r.id = ? AND r.property_id = ?`,
    roomId,
    prop.id,
  );
  if (!room) fail(400, 'Room not found at this property');
  const first = nights[0];
  const last = nights[nights.length - 1];
  if (room.commissioned_on > first || (room.decommissioned_on && room.decommissioned_on <= last))
    fail(400, `Room ${room.number} is not in service for these dates`);
  if (!force && (res.adults > room.cap_adults || res.children > room.cap_children))
    conflict(`Room ${room.number} is too small for ${res.adults} adults and ${res.children} children`, {
      code: 'room_too_small',
    });
  if (room.room_type_id !== res.room_type_id) {
    if (!allowTypeChange)
      conflict(`Room ${room.number} is a ${room.type_name}; the booking is for another room type`, {
        code: 'room_type_mismatch',
        details: { roomTypeId: room.room_type_id },
      });
    // The nights will consume the new type; make sure that type is not oversold by it.
    assertInventory(
      db,
      prop,
      nights.map((night) => ({ roomTypeId: room.room_type_id, night })),
      { allowOverbooking, excludeReservationIds: [res.id] },
    );
  }
  db.run(
    `DELETE FROM room_nights WHERE reservation_id = ? AND night IN (${nights.map(() => '?').join(',')})`,
    res.id,
    ...nights,
  );
  claim(db, res, room, nights);
  return room;
}

// Room per night for a reservation: [{ night, room_id, number }].
export const assignments = (db, resId) =>
  db.all(
    `SELECT rn.night, rn.room_id, r.number, r.room_type_id FROM room_nights rn JOIN rooms r ON r.id = rn.room_id
     WHERE rn.reservation_id = ? ORDER BY rn.night`,
    resId,
  );

// ---------- create ----------
// input: { propertyId, guest | guestId, companyId, source, channel, channelRef, segment, notes,
//          groupName, status ('confirmed' | 'quote'), guarantee, rooms: [{ roomTypeId, ratePlanId,
//          arrival, departure, adults, children, roomId, rateMinor, isComplimentary, isHouseUse,
//          specialRequests, eta, depositRequiredMinor }] }
// opts: { idempotencyKey, allowOverbooking, overrideRestrictions, allowPast }
export function createBooking(db, actor, input, opts = {}) {
  return db.tx(() => {
    const prop = loadProperty(db, input.propertyId);
    if (opts.idempotencyKey) {
      const existing = db.get(
        'SELECT id FROM bookings WHERE created_by IS ? AND idempotency_key = ?',
        actor?.id ?? null,
        opts.idempotencyKey,
      );
      if (existing) return bookingDetail(db, existing.id);
    }
    const status = input.status === 'quote' ? 'quote' : 'confirmed';
    const source = SOURCES.includes(input.source) ? input.source : 'Direct';
    const lines = Array.isArray(input.rooms) ? input.rooms : [];
    if (!lines.length) fail(400, 'Add at least one room');
    if (lines.length > 50) fail(400, 'A booking can hold at most 50 rooms; use a group block');

    let guestId = input.guestId;
    if (guestId) {
      if (!db.value('SELECT 1 FROM guests WHERE id = ? AND org_id = ?', guestId, prop.org_id)) fail(400, 'Guest not found');
    } else if (input.guest) {
      guestId = saveGuest(db, actor, prop.org_id, input.guest).id;
    } else fail(400, 'Guest details are required');

    const company = input.companyId
      ? db.get('SELECT * FROM companies WHERE id = ? AND org_id = ?', input.companyId, prop.org_id)
      : null;
    if (input.companyId && !company) fail(400, 'Company not found');
    if (input.channel && input.channelRef) {
      const dup = db.value(
        'SELECT ref FROM bookings WHERE property_id = ? AND channel = ? AND channel_ref = ?',
        prop.id,
        input.channel,
        input.channelRef,
      );
      if (dup)
        conflict(`${input.channel} reservation ${input.channelRef} was already imported as ${dup}`, {
          code: 'duplicate_channel_booking',
        });
    }

    // Validate every line first, then check inventory for all of them together.
    const planned = lines.map((l, i) => {
      const arrival = l.arrival;
      const departure = l.departure;
      if (!arrival || !departure || !(departure > arrival)) fail(400, `Room ${i + 1}: departure must be after arrival`);
      if (!opts.allowPast && arrival < prop.business_date)
        fail(400, `Room ${i + 1}: arrival ${arrival} is before the business date ${prop.business_date}`);
      if (diffDays(arrival, departure) > 365) fail(400, `Room ${i + 1}: stays are limited to 365 nights`);
      const type = roomTypeOf(db, prop, l.roomTypeId);
      const adults = Math.max(1, Number(l.adults) || 1);
      const children = Math.max(0, Number(l.children) || 0);
      validateOccupancy(type, adults, children);
      const plan = ratePlanOf(db, prop, l.ratePlanId, type.id);
      const complimentary = Boolean(l.isComplimentary || l.isHouseUse);
      if (status === 'confirmed')
        restrictionsOk(db, prop, { roomTypeId: type.id, ratePlanId: plan?.id, arrival, departure }, opts.overrideRestrictions);
      const nights = priceNights(db, prop, type, {
        ratePlanId: plan?.id,
        arrival,
        departure,
        adults,
        children,
        rateMinor: l.rateMinor,
        isComplimentary: complimentary,
      });
      let lineGuest = guestId;
      if (l.guestId && l.guestId !== guestId) {
        if (!db.value('SELECT 1 FROM guests WHERE id = ? AND org_id = ?', l.guestId, prop.org_id)) fail(400, `Room ${i + 1}: guest not found`);
        lineGuest = l.guestId;
      }
      return { l, type, plan, arrival, departure, adults, children, nights, complimentary, guestId: lineGuest };
    });
    if (status === 'confirmed')
      assertInventory(
        db,
        prop,
        planned.flatMap((p) => p.nights.map((n) => ({ roomTypeId: p.type.id, night: n.night }))),
        { allowOverbooking: opts.allowOverbooking },
      );

    const seq = nextNumber(db, prop.id, 'booking');
    const ref = `${prop.code}-${pad(seq, 6)}`;
    const bookingId = db.insert('bookings', {
      property_id: prop.id,
      ref,
      booker_guest_id: guestId,
      company_id: company?.id ?? null,
      source,
      channel: input.channel ?? null,
      channel_ref: input.channelRef ?? null,
      segment: input.segment ?? null,
      group_name: input.groupName ?? null,
      notes: input.notes ?? null,
      idempotency_key: opts.idempotencyKey ?? null,
      created_by: actor?.id ?? null,
      created_at: stamp(actor),
    });
    const commissionDefault =
      input.commissionBp ?? (company && ['ota', 'travel_agent'].includes(company.kind) ? company.commission_bp : 0);
    planned.forEach((p, i) => {
      const total = p.nights.reduce((a, n) => a + n.rate_minor, 0);
      const resId = db.insert('reservations', {
        property_id: prop.id,
        booking_id: bookingId,
        conf_no: planned.length > 1 ? `${ref}-${i + 1}` : ref,
        guest_id: p.guestId,
        room_type_id: p.type.id,
        rate_plan_id: p.plan?.id ?? null,
        arrival: p.arrival,
        departure: p.departure,
        adults: p.adults,
        children: p.children,
        status,
        is_complimentary: p.l.isComplimentary ? 1 : 0,
        is_house_use: p.l.isHouseUse ? 1 : 0,
        source,
        channel: input.channel ?? null,
        segment: input.segment ?? null,
        company_id: company?.id ?? null,
        commission_bp: source === 'OTA' || source === 'Travel Agent' ? commissionDefault || 0 : 0,
        currency: prop.currency,
        total_minor: total,
        deposit_required_minor: p.l.depositRequiredMinor ?? 0,
        guarantee: input.guarantee || 'none',
        cancellation_policy: JSON.stringify(policySnapshot(db, prop, p.plan?.id)),
        eta: p.l.eta ?? null,
        special_requests: p.l.specialRequests ?? null,
        notes: input.notes ?? null,
        quote_expires_at: status === 'quote' ? addDays(prop.business_date, 3) : null,
        confirmed_at: status === 'confirmed' ? stamp(actor) : null,
        created_by: actor?.id ?? null,
        created_at: stamp(actor),
        updated_at: stamp(actor),
      });
      for (const n of p.nights)
        db.run(
          'INSERT INTO reservation_nights (reservation_id, property_id, night, room_type_id, rate_minor) VALUES (?, ?, ?, ?, ?)',
          resId,
          prop.id,
          n.night,
          p.type.id,
          n.rate_minor,
        );
      const res = db.get('SELECT * FROM reservations WHERE id = ?', resId);
      if (p.l.roomId && status === 'confirmed')
        applyAssignment(db, prop, res, p.l.roomId, p.nights.map((n) => n.night), {
          allowTypeChange: p.l.allowTypeChange,
          allowOverbooking: opts.allowOverbooking,
        });
      ensureGuestFolio(db, actor, res);
      record(db, actor, res, 'created', {
        status,
        arrival: p.arrival,
        departure: p.departure,
        room_type: p.type.code,
        rate_plan: p.plan?.code ?? null,
        total_minor: total,
        room: p.l.roomId ? db.value('SELECT number FROM rooms WHERE id = ?', p.l.roomId) : null,
      });
    });
    return bookingDetail(db, bookingId);
  });
}

export function bookingDetail(db, bookingId) {
  const b = db.get('SELECT * FROM bookings WHERE id = ?', bookingId);
  if (!b) notFound('Booking');
  const ids = db.all('SELECT id FROM reservations WHERE booking_id = ? ORDER BY id', bookingId).map((r) => r.id);
  return { booking: b, reservations: ids.map((id) => reservationDetail(db, id)) };
}

// ---------- read ----------
export function reservationDetail(db, id) {
  const r = db.get(
    `SELECT r.*, b.ref AS booking_ref, b.channel_ref, b.group_name,
            t.code AS room_type_code, t.name AS room_type_name, t.color AS room_type_color,
            rp.code AS rate_plan_code, rp.name AS rate_plan_name, rp.meal_plan,
            c.name AS company_name, p.name AS property_name, p.code AS property_code, p.business_date
     FROM reservations r JOIN bookings b ON b.id = r.booking_id JOIN room_types t ON t.id = r.room_type_id
     JOIN properties p ON p.id = r.property_id
     LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id LEFT JOIN companies c ON c.id = r.company_id
     WHERE r.id = ?`,
    id,
  );
  if (!r) notFound('Reservation');
  const guest = db.get('SELECT * FROM guests WHERE id = ?', r.guest_id);
  const nights = db.all(
    `SELECT n.night, n.rate_minor, n.room_type_id, rn.room_id, rm.number AS room_number
     FROM reservation_nights n LEFT JOIN room_nights rn ON rn.reservation_id = n.reservation_id AND rn.night = n.night
     LEFT JOIN rooms rm ON rm.id = rn.room_id WHERE n.reservation_id = ? ORDER BY n.night`,
    id,
  );
  const current = nights.find((n) => n.night === r.business_date) || nights.find((n) => n.night >= r.business_date) || nights[nights.length - 1];
  const folios = db.all('SELECT * FROM folios WHERE reservation_id = ? ORDER BY folio_window', id).map((f) => ({
    ...f,
    balance_minor: folioBalance(db, f.id),
  }));
  const history = db.all(
    `SELECT h.*, u.name AS user_name FROM reservation_history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.reservation_id = ? ORDER BY h.id DESC`,
    id,
  );
  return {
    ...r,
    cancellation_policy: json(r.cancellation_policy, null),
    nights_count: nights.length,
    guest,
    nights,
    room_id: current?.room_id ?? null,
    room_number: current?.room_number ?? null,
    unassigned_nights: nights.filter((n) => !n.room_id).length,
    folios,
    balance_minor: folios.reduce((a, f) => a + f.balance_minor, 0),
    history: history.map((h) => ({ ...h, changes: json(h.changes, null) })),
  };
}

export function listReservations(db, propertyIds, f = {}) {
  const where = [`r.property_id IN (${propertyIds.map(() => '?').join(',') || 'NULL'})`];
  const params = [...propertyIds];
  if (f.status) {
    const st = String(f.status).split(',').filter((s) => STATUSES.includes(s));
    if (st.length) {
      where.push(`r.status IN (${st.map(() => '?').join(',')})`);
      params.push(...st);
    }
  }
  if (f.arrivalFrom) where.push('r.arrival >= ?') && params.push(f.arrivalFrom);
  if (f.arrivalTo) where.push('r.arrival <= ?') && params.push(f.arrivalTo);
  if (f.stayOn) where.push('r.arrival <= ? AND r.departure > ?') && params.push(f.stayOn, f.stayOn);
  if (f.source) where.push('r.source = ?') && params.push(f.source);
  if (f.roomTypeId) where.push('r.room_type_id = ?') && params.push(f.roomTypeId);
  if (f.q) {
    const like = `%${String(f.q).replace(/[%_]/g, '')}%`;
    where.push(`(r.conf_no LIKE ? OR g.first_name || ' ' || g.last_name LIKE ? OR g.email LIKE ? OR g.phone LIKE ? OR b.channel_ref LIKE ?)`);
    params.push(like, like, like, like, like);
  }
  const SORTS = {
    arrival: 'r.arrival',
    departure: 'r.departure',
    created: 'r.created_at',
    guest: 'g.last_name',
    total: 'r.total_minor',
    status: 'r.status',
  };
  const sort = SORTS[f.sort] || 'r.arrival';
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(200, Math.max(1, Number(f.limit) || 25));
  const offset = Math.max(0, Number(f.offset) || 0);
  const base = `FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN bookings b ON b.id = r.booking_id
     JOIN room_types t ON t.id = r.room_type_id JOIN properties p ON p.id = r.property_id
     LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id WHERE ${where.join(' AND ')}`;
  const total = db.value(`SELECT COUNT(*) ${base}`, ...params);
  const rows = db.all(
    `SELECT r.id, r.conf_no, r.property_id, p.code AS property_code, r.status, r.arrival, r.departure,
            r.adults, r.children, r.source, r.channel, r.segment, r.total_minor, r.currency, r.is_complimentary,
            r.room_type_id, t.code AS room_type_code, t.name AS room_type_name, rp.code AS rate_plan_code,
            g.id AS guest_id, g.first_name, g.last_name, g.vip, b.channel_ref, r.created_at,
            julianday(r.departure) - julianday(r.arrival) AS nights,
            COALESCE(
              (SELECT rm.number FROM room_nights rn JOIN rooms rm ON rm.id = rn.room_id
                WHERE rn.reservation_id = r.id AND rn.night >= p.business_date ORDER BY rn.night LIMIT 1),
              (SELECT rm.number FROM room_nights rn JOIN rooms rm ON rm.id = rn.room_id
                WHERE rn.reservation_id = r.id ORDER BY rn.night DESC LIMIT 1)) AS room_number
     ${base} ORDER BY ${sort} ${dir}, r.id ${dir} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return { total, rows, limit, offset };
}

// ---------- assignment ----------
// Assigns nights [from, to) (default: the whole stay, or the remaining stay when in house).
export function assignRoom(db, actor, id, roomId, opts = {}) {
  return db.tx(() => {
    const res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    if (!HOLDING.includes(res.status)) conflict('Only confirmed or in-house reservations can be assigned a room');
    const prop = loadProperty(db, res.property_id);
    const startMin = res.status === 'in_house' ? prop.business_date : res.arrival;
    const from = opts.from && opts.from > startMin ? opts.from : startMin;
    const to = opts.to && opts.to < res.departure ? opts.to : res.departure;
    const nights = nightsOf(from, to);
    if (!nights.length) fail(400, 'No nights to assign');
    if (res.status === 'in_house' && from <= prop.business_date && !opts.force) {
      // Moving a guest who is already in the house: the new room must be ready.
      const room = db.get('SELECT * FROM rooms WHERE id = ?', roomId);
      assertRoomReady(db, prop, room, { exceptReservationId: res.id });
    }
    const before = assignments(db, id).filter((a) => nights.includes(a.night));
    const room = applyAssignment(db, prop, res, roomId, nights, opts);
    db.run('UPDATE reservations SET version = version + 1, updated_at = ? WHERE id = ?', stamp(actor), id);
    record(db, actor, res, 'room_assigned', {
      room: room.number,
      from,
      to,
      previous: [...new Set(before.map((b) => b.number))],
    });
    return reservationDetail(db, id);
  });
}

export function unassignRoom(db, actor, id, opts = {}) {
  return db.tx(() => {
    const res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    if (res.status !== 'confirmed') conflict('Only a confirmed (not yet arrived) reservation can be unassigned');
    const from = opts.from || res.arrival;
    db.run('DELETE FROM room_nights WHERE reservation_id = ? AND night >= ?', id, from);
    db.run('UPDATE reservations SET version = version + 1, updated_at = ? WHERE id = ?', stamp(actor), id);
    record(db, actor, res, 'room_unassigned', { from });
    return reservationDetail(db, id);
  });
}

// Readiness for a guest to move in: not blocked, not occupied by someone else, and clean
// (inspected when the property requires inspection — PRD HK-5).
export function assertRoomReady(db, prop, room, { exceptReservationId = null } = {}) {
  if (!room || room.property_id !== prop.id) fail(400, 'Room not found at this property');
  const block = db.get(
    `SELECT b.kind, b.reason FROM room_nights rn JOIN room_blocks b ON b.id = rn.block_id WHERE rn.room_id = ? AND rn.night = ?`,
    room.id,
    prop.business_date,
  );
  if (block) conflict(`Room ${room.number} is ${block.kind === 'ooo' ? 'out of order' : 'out of service'}: ${block.reason}`, { code: 'room_blocked' });
  const occupant = db.get(
    `SELECT r.conf_no, g.first_name || ' ' || g.last_name AS guest FROM room_nights rn
     JOIN reservations r ON r.id = rn.reservation_id JOIN guests g ON g.id = r.guest_id
     WHERE rn.room_id = ? AND rn.night IN (?, ?) AND r.status = 'in_house' AND r.id IS NOT ?`,
    room.id,
    prop.business_date,
    addDays(prop.business_date, -1),
    exceptReservationId,
  );
  if (occupant)
    conflict(`Room ${room.number} is still occupied by ${occupant.guest} (${occupant.conf_no})`, { code: 'room_occupied' });
  const ready = prop.inspection_required ? room.hk_status === 'inspected' : ['clean', 'inspected'].includes(room.hk_status);
  if (!ready)
    conflict(
      prop.inspection_required && room.hk_status === 'clean'
        ? `Room ${room.number} is clean but not yet inspected; a supervisor must inspect it first`
        : `Room ${room.number} is not ready (${room.hk_status})`,
      { code: 'room_not_ready', details: { hk_status: room.hk_status } },
    );
}

// Assigns free rooms of the booked type to unassigned arrivals on `night` (inspected rooms first).
export function autoAssign(db, actor, propertyId, night, { reservationIds = null } = {}) {
  return db.tx(() => {
    const prop = loadProperty(db, propertyId);
    const list = db.all(
      `SELECT r.* FROM reservations r WHERE r.property_id = ? AND r.arrival = ? AND r.status = 'confirmed'
       AND NOT EXISTS (SELECT 1 FROM room_nights rn WHERE rn.reservation_id = r.id)
       ORDER BY r.departure DESC, r.id`,
      propertyId,
      night,
    );
    const done = [];
    const failed = [];
    for (const res of list) {
      if (reservationIds && !reservationIds.includes(res.id)) continue;
      const nights = nightsOf(res.arrival, res.departure);
      const free = db.all(
        `SELECT r.id, r.number FROM rooms r WHERE r.property_id = ? AND r.room_type_id = ?
           AND r.commissioned_on <= ? AND (r.decommissioned_on IS NULL OR r.decommissioned_on > ?)
           AND NOT EXISTS (SELECT 1 FROM room_nights rn WHERE rn.room_id = r.id AND rn.night >= ? AND rn.night < ?)
         ORDER BY CASE r.hk_status WHEN 'inspected' THEN 0 WHEN 'clean' THEN 1 ELSE 2 END, r.sort, r.number`,
        propertyId,
        res.room_type_id,
        res.arrival,
        res.departure,
        res.arrival,
        res.departure,
      );
      if (!free.length) {
        failed.push({ reservationId: res.id, confNo: res.conf_no, reason: 'No free room of the booked type for the whole stay' });
        continue;
      }
      applyAssignment(db, prop, res, free[0].id, nights, { force: true });
      record(db, actor, res, 'room_assigned', { room: free[0].number, auto: true });
      done.push({ reservationId: res.id, confNo: res.conf_no, room: free[0].number });
    }
    return { assigned: done, unassigned: failed };
  });
}

// ---------- modify ----------
const MODIFIABLE = {
  quote: ['arrival', 'departure', 'room_type_id', 'rate_plan_id', 'adults', 'children', 'company_id', 'source', 'channel', 'segment', 'eta', 'special_requests', 'notes', 'guarantee', 'deposit_required_minor', 'rate_minor', 'is_complimentary', 'room_id'],
  confirmed: ['arrival', 'departure', 'room_type_id', 'rate_plan_id', 'adults', 'children', 'company_id', 'source', 'channel', 'segment', 'eta', 'special_requests', 'notes', 'guarantee', 'deposit_required_minor', 'rate_minor', 'is_complimentary', 'room_id'],
  in_house: ['departure', 'adults', 'children', 'company_id', 'special_requests', 'notes', 'guarantee', 'rate_minor', 'room_id'],
  checked_out: ['notes'],
  closed: ['notes'],
  cancelled: ['notes'],
  no_show: ['notes'],
};

// Changes a reservation. Dates, room type and rate plan re-price affected nights (retained
// nights keep their rate unless a new rate is given), re-check restrictions and inventory and
// keep the room assignment where possible. `version` guards against concurrent edits.
export function modifyReservation(db, actor, id, input, opts = {}) {
  return db.tx(() => {
    const res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    if (opts.version != null && Number(opts.version) !== res.version)
      conflict('This reservation was changed by someone else. Reload it and try again.', {
        code: 'stale_version',
        details: { current: res.version },
      });
    const prop = loadProperty(db, res.property_id);
    const allowed = MODIFIABLE[res.status];
    const changes = {};
    for (const k of Object.keys(input)) {
      if (input[k] === undefined) continue;
      if (!allowed.includes(k)) conflict(`${k.replace(/_/g, ' ')} cannot be changed on a ${res.status.replace('_', '-')} reservation`, { code: 'not_modifiable' });
      changes[k] = input[k];
    }
    if (!Object.keys(changes).length) return reservationDetail(db, id);

    const next = {
      arrival: changes.arrival ?? res.arrival,
      departure: changes.departure ?? res.departure,
      room_type_id: changes.room_type_id ?? res.room_type_id,
      rate_plan_id: changes.rate_plan_id !== undefined ? changes.rate_plan_id : res.rate_plan_id,
      adults: changes.adults ?? res.adults,
      children: changes.children ?? res.children,
      is_complimentary: changes.is_complimentary !== undefined ? (changes.is_complimentary ? 1 : 0) : res.is_complimentary,
    };
    if (!(next.departure > next.arrival)) fail(400, 'Departure must be after arrival');
    if (res.status === 'in_house' && next.departure <= prop.business_date)
      fail(400, `An in-house guest's departure must be after ${prop.business_date}; check the guest out instead`);
    if (['quote', 'confirmed'].includes(res.status) && changes.arrival && next.arrival < prop.business_date)
      fail(400, `Arrival cannot be before the business date ${prop.business_date}`);
    const type = roomTypeOf(db, prop, next.room_type_id);
    validateOccupancy(type, next.adults, next.children);
    const plan = ratePlanOf(db, prop, next.rate_plan_id, type.id);

    const stayChanged =
      next.arrival !== res.arrival || next.departure !== res.departure || next.room_type_id !== res.room_type_id ||
      next.rate_plan_id !== res.rate_plan_id || next.adults !== res.adults || next.children !== res.children ||
      next.is_complimentary !== res.is_complimentary || changes.rate_minor !== undefined;

    if (stayChanged) {
      const old = new Map(db.all('SELECT * FROM reservation_nights WHERE reservation_id = ?', id).map((n) => [n.night, n]));
      const repriceAll =
        next.room_type_id !== res.room_type_id || next.rate_plan_id !== res.rate_plan_id ||
        next.adults !== res.adults || next.children !== res.children || next.is_complimentary !== res.is_complimentary ||
        changes.rate_minor !== undefined;
      const wanted = nightsOf(next.arrival, next.departure);
      // In-house: nights already stayed (before the business date) are history and keep their rate.
      const frozen = (night) => res.status === 'in_house' && night < prop.business_date;
      const toPrice = wanted.filter((n) => !old.has(n) || (repriceAll && !frozen(n)));
      const priced = new Map();
      if (toPrice.length) {
        // Price contiguous runs so derived/weekend logic applies per night.
        const full = priceNights(db, prop, type, {
          ratePlanId: plan?.id,
          arrival: toPrice[0],
          departure: addDays(toPrice[toPrice.length - 1], 1),
          adults: next.adults,
          children: next.children,
          rateMinor: changes.rate_minor,
          isComplimentary: Boolean(next.is_complimentary),
        });
        for (const n of full) priced.set(n.night, n.rate_minor);
      }
      if (['quote', 'confirmed'].includes(res.status) && (next.arrival !== res.arrival || next.departure !== res.departure || next.room_type_id !== res.room_type_id || next.rate_plan_id !== res.rate_plan_id))
        restrictionsOk(db, prop, { roomTypeId: type.id, ratePlanId: plan?.id, arrival: next.arrival, departure: next.departure }, opts.overrideRestrictions);

      // Room assignment: drop nights no longer in the stay; a type change releases rooms of
      // the old type (unless the caller assigns a room).
      const assigned = assignments(db, id);
      const removedNights = [...old.keys()].filter((n) => !wanted.includes(n));
      if (removedNights.length)
        db.run(`DELETE FROM room_nights WHERE reservation_id = ? AND night IN (${removedNights.map(() => '?').join(',')})`, id, ...removedNights);
      if (next.room_type_id !== res.room_type_id && changes.room_id === undefined)
        db.run('DELETE FROM room_nights WHERE reservation_id = ? AND night >= ?', id, res.status === 'in_house' ? prop.business_date : next.arrival);

      db.run('DELETE FROM reservation_nights WHERE reservation_id = ?', id);
      for (const night of wanted) {
        const rate = priced.has(night) ? priced.get(night) : old.get(night).rate_minor;
        db.run(
          'INSERT INTO reservation_nights (reservation_id, property_id, night, room_type_id, rate_minor) VALUES (?, ?, ?, ?, ?)',
          id,
          prop.id,
          night,
          frozen(night) ? old.get(night).room_type_id : type.id,
          rate,
        );
      }
      const total = db.value('SELECT SUM(rate_minor) FROM reservation_nights WHERE reservation_id = ?', id);
      db.update('reservations', id, { ...next, total_minor: total });

      if (HOLDING.includes(res.status)) {
        const newNights = wanted.filter((n) => !frozen(n));
        const fresh = db.get('SELECT * FROM reservations WHERE id = ?', id);
        if (changes.room_id) {
          applyAssignment(db, prop, fresh, changes.room_id, newNights, opts);
        } else if (next.room_type_id === res.room_type_id && assigned.length) {
          // Keep the guest in the same room for added or shifted nights.
          const anchor = assigned.filter((a) => !removedNights.includes(a.night)).at(-1)?.room_id ?? assigned.at(-1).room_id;
          const have = new Set(assignments(db, id).map((a) => a.night));
          const missing = newNights.filter((n) => !have.has(n));
          if (missing.length) {
            try {
              applyAssignment(db, prop, fresh, anchor, missing, { ...opts, allowTypeChange: true });
            } catch (e) {
              if (!(opts.unassignedOk && e.status === 409)) throw e;
              db.run(`DELETE FROM room_nights WHERE reservation_id = ? AND night IN (${missing.map(() => '?').join(',')})`, id, ...missing);
            }
          }
        }
        // Inventory for the nights as they now consume it (assigned room type, else booked type).
        const needs = db.all(
          `SELECT n.night, COALESCE(rm.room_type_id, n.room_type_id) AS t FROM reservation_nights n
           LEFT JOIN room_nights x ON x.reservation_id = n.reservation_id AND x.night = n.night
           LEFT JOIN rooms rm ON rm.id = x.room_id WHERE n.reservation_id = ? AND n.night >= ?`,
          id,
          res.status === 'in_house' ? prop.business_date : next.arrival,
        );
        assertInventory(db, prop, needs.map((n) => ({ roomTypeId: n.t, night: n.night })), {
          allowOverbooking: opts.allowOverbooking,
          excludeReservationIds: [id],
        });
      }
    } else if (changes.room_id) {
      const nights = nightsOf(res.status === 'in_house' ? prop.business_date : res.arrival, res.departure);
      applyAssignment(db, prop, res, changes.room_id, nights, opts);
    }

    const simple = {};
    for (const k of ['company_id', 'source', 'channel', 'segment', 'eta', 'special_requests', 'notes', 'guarantee', 'deposit_required_minor'])
      if (changes[k] !== undefined) simple[k] = changes[k];
    if (simple.source && !SOURCES.includes(simple.source)) fail(400, 'Unknown source');
    if (simple.company_id && !db.value('SELECT 1 FROM companies WHERE id = ? AND org_id = ?', simple.company_id, prop.org_id))
      fail(400, 'Company not found');
    if (stayChanged && next.rate_plan_id !== res.rate_plan_id)
      simple.cancellation_policy = JSON.stringify(policySnapshot(db, prop, next.rate_plan_id));
    db.update('reservations', id, { ...simple, version: res.version + 1, updated_at: stamp(actor) });

    const after = db.get('SELECT * FROM reservations WHERE id = ?', id);
    const diff = {};
    for (const k of [...Object.keys(next), ...Object.keys(simple), 'total_minor'])
      if (after[k] !== res[k] && k !== 'cancellation_policy') diff[k] = { from: res[k], to: after[k] };
    if (changes.room_id) diff.room = { to: db.value('SELECT number FROM rooms WHERE id = ?', changes.room_id) };
    record(db, actor, res, 'modified', diff);
    return reservationDetail(db, id);
  });
}

// Calendar drag: move to another room and/or shift the dates keeping the length of stay.
export function moveReservation(db, actor, id, { roomId, arrival, version, allowTypeChange, allowOverbooking, overrideRestrictions } = {}) {
  const res = db.get('SELECT * FROM reservations WHERE id = ?', id);
  if (!res) notFound('Reservation');
  const input = {};
  if (arrival && arrival !== res.arrival) {
    if (res.status !== 'confirmed') conflict('Only a reservation that has not arrived can change dates on the calendar', { code: 'not_modifiable' });
    input.arrival = arrival;
    input.departure = addDays(arrival, diffDays(res.arrival, res.departure));
  }
  if (roomId) input.room_id = roomId;
  return modifyReservation(db, actor, id, input, { version, allowTypeChange, allowOverbooking, overrideRestrictions, force: false });
}

export function confirmQuote(db, actor, id, opts = {}) {
  return db.tx(() => {
    const res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    assertTransition(res.status, 'confirmed');
    const prop = loadProperty(db, res.property_id);
    if (res.arrival < prop.business_date) conflict('The quote has expired: its arrival date has passed');
    restrictionsOk(db, prop, { roomTypeId: res.room_type_id, ratePlanId: res.rate_plan_id, arrival: res.arrival, departure: res.departure }, opts.overrideRestrictions);
    assertInventory(
      db,
      prop,
      nightsOf(res.arrival, res.departure).map((night) => ({ roomTypeId: res.room_type_id, night })),
      { allowOverbooking: opts.allowOverbooking, excludeReservationIds: [id] },
    );
    db.update('reservations', id, { status: 'confirmed', confirmed_at: stamp(actor), quote_expires_at: null, version: res.version + 1, updated_at: stamp(actor) });
    record(db, actor, res, 'confirmed', { status: { from: 'quote', to: 'confirmed' } });
    return reservationDetail(db, id);
  });
}

// Hours from "now" (property local time) to the arrival date's check-in time.
function hoursBeforeArrival(prop, res, nowLocal) {
  const now = nowLocal || { date: todayIn(prop.timezone), time: timeIn(prop.timezone) };
  const a = Date.parse(`${res.arrival}T${prop.check_in_time}:00Z`);
  const n = Date.parse(`${now.date}T${now.time}:00Z`);
  return (a - n) / 3600000;
}

// Fee due for cancelling now under the reservation's policy snapshot.
export function cancellationFee(db, res, prop, nowLocal) {
  if (res.is_complimentary || res.status === 'quote') return 0;
  const p = json(res.cancellation_policy, null);
  if (!p) return 0;
  const free = !p.non_refundable && hoursBeforeArrival(prop, res, nowLocal) >= p.free_cancel_hours;
  if (free || p.penalty_kind === 'none') return 0;
  const nights = db.all('SELECT rate_minor FROM reservation_nights WHERE reservation_id = ? ORDER BY night', res.id);
  const total = nights.reduce((a, n) => a + n.rate_minor, 0);
  if (p.penalty_kind === 'first_night') return nights[0]?.rate_minor ?? 0;
  if (p.penalty_kind === 'percent') return bpOf(total, p.penalty_bp);
  return total;
}

export function cancelReservation(db, actor, id, { reason, waiveFee = false, nowLocal } = {}) {
  return db.tx(() => {
    const res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    assertTransition(res.status, 'cancelled');
    if (!reason) fail(400, 'A cancellation reason is required');
    const prop = loadProperty(db, res.property_id);
    const fee = cancellationFee(db, res, prop, nowLocal);
    db.run('DELETE FROM room_nights WHERE reservation_id = ?', id);
    db.update('reservations', id, {
      status: 'cancelled',
      cancelled_at: stamp(actor),
      cancel_reason: reason,
      version: res.version + 1,
      updated_at: stamp(actor),
    });
    let posting = null;
    if (fee > 0 && !waiveFee)
      posting = postCharge(db, actor, {
        reservationId: id,
        chargeCode: 'CANCEL',
        unitMinor: fee,
        description: `Cancellation fee (${json(res.cancellation_policy, {})?.name || 'policy'})`,
        source: 'reservation',
        dedupeKey: `cancel:${id}`,
      });
    record(db, actor, res, 'cancelled', { reason, fee_minor: waiveFee ? 0 : fee, fee_waived: waiveFee && fee > 0 });
    return { ...reservationDetail(db, id), feePosted: posting };
  });
}

export function markNoShow(db, actor, id, { waiveFee = false } = {}) {
  return db.tx(() => {
    const res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    assertTransition(res.status, 'no_show');
    const prop = loadProperty(db, res.property_id);
    if (res.arrival > prop.business_date) conflict(`The guest is not due until ${res.arrival}`);
    const p = json(res.cancellation_policy, null);
    let fee = 0;
    if (!res.is_complimentary && res.guarantee !== 'none' && p && p.no_show_kind !== 'none') {
      const nights = db.all('SELECT rate_minor FROM reservation_nights WHERE reservation_id = ? ORDER BY night', id);
      fee = p.no_show_kind === 'first_night' ? nights[0]?.rate_minor ?? 0 : nights.reduce((a, n) => a + n.rate_minor, 0);
    }
    db.run('DELETE FROM room_nights WHERE reservation_id = ?', id);
    db.update('reservations', id, { status: 'no_show', no_show_at: stamp(actor), version: res.version + 1, updated_at: stamp(actor) });
    let posting = null;
    if (fee > 0 && !waiveFee)
      posting = postCharge(db, actor, {
        reservationId: id,
        chargeCode: 'NOSHOW',
        unitMinor: fee,
        description: 'No-show fee',
        source: 'reservation',
        dedupeKey: `noshow:${id}`,
      });
    record(db, actor, res, 'no_show', { fee_minor: waiveFee ? 0 : fee });
    return { ...reservationDetail(db, id), feePosted: posting };
  });
}
