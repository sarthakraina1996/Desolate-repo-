// Front office: arrivals / in-house / departures boards, check-in (room readiness, identity
// policy, early arrival), walk-ins, room moves, checkout with settlement (payment or city
// ledger), guest requests and cashier shifts.
import { stamp } from '../../core/clock.js';
import { conflict, fail, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { addDays, nights as nightsOf, timeIn } from '../../core/dates.js';
import {
  assertRoomReady,
  assertTransition,
  assignRoom,
  createBooking,
  loadProperty,
  reservationDetail,
} from '../reservations/service.js';
import { verifyIdentity } from '../guests/service.js';
import { createTask, setRoomStatus } from '../housekeeping/service.js';
import {
  closeFolio,
  folioBalance,
  issueInvoice,
  postCharge,
  transferBalanceToCompany,
} from '../folios/service.js';

function history(db, actor, res, action, changes) {
  db.run(
    'INSERT INTO reservation_history (reservation_id, action, changes, user_id, at) VALUES (?, ?, ?, ?, ?)',
    res.id,
    action,
    changes ? JSON.stringify(changes) : null,
    actor?.id ?? null,
    stamp(actor),
  );
  audit(db, actor, `reservation.${action}`, { entity: 'reservation', entityId: res.id, propertyId: res.property_id, after: changes });
  emit(db, { propertyId: res.property_id, entity: 'reservation', entityUid: res.uid, op: action, payload: { conf_no: res.conf_no, ...changes } });
}

const BOARD_SQL = `
  SELECT r.id, r.conf_no, r.status, r.arrival, r.departure, r.adults, r.children, r.eta, r.source, r.channel,
         r.special_requests, r.is_complimentary, r.room_type_id, t.code AS room_type_code, t.name AS room_type_name,
         r.checked_in_at, r.checked_out_at, r.total_minor, r.currency, r.version,
         g.id AS guest_id, g.first_name, g.last_name, g.vip, g.id_verified_at, g.nationality, g.preferences,
         c.name AS company_name,
         (SELECT rm.number FROM room_nights rn JOIN rooms rm ON rm.id = rn.room_id WHERE rn.reservation_id = r.id
            ORDER BY ABS(julianday(rn.night) - julianday(:bd)) LIMIT 1) AS room_number,
         (SELECT rm.id FROM room_nights rn JOIN rooms rm ON rm.id = rn.room_id WHERE rn.reservation_id = r.id
            ORDER BY ABS(julianday(rn.night) - julianday(:bd)) LIMIT 1) AS room_id,
         (SELECT rm.hk_status FROM room_nights rn JOIN rooms rm ON rm.id = rn.room_id WHERE rn.reservation_id = r.id
            ORDER BY ABS(julianday(rn.night) - julianday(:bd)) LIMIT 1) AS room_hk_status,
         (SELECT COALESCE(SUM(p.amount_minor), 0) FROM folio_postings p JOIN folios f ON f.id = p.folio_id
            WHERE f.reservation_id = r.id) AS balance_minor,
         (SELECT COUNT(*) FROM guest_requests q WHERE q.reservation_id = r.id AND q.status IN ('open','in_progress')) AS open_requests
  FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN room_types t ON t.id = r.room_type_id
  LEFT JOIN companies c ON c.id = r.company_id`;

// Boards for one business date (default: the property's). done/total counts as on a PMS.
export function boards(db, propertyId, date) {
  const prop = loadProperty(db, propertyId);
  const bd = date || prop.business_date;
  const arrivals = db.all(
    `${BOARD_SQL} WHERE r.property_id = :pid AND r.arrival = :bd AND r.status IN ('confirmed','in_house','checked_out','closed') ORDER BY r.status = 'in_house', g.vip DESC, r.eta, r.id`,
    { pid: propertyId, bd },
  );
  const departures = db.all(
    `${BOARD_SQL} WHERE r.property_id = :pid AND r.departure = :bd AND r.status IN ('in_house','checked_out','closed') ORDER BY r.status <> 'in_house', r.id`,
    { pid: propertyId, bd },
  );
  const inHouse = db.all(
    `${BOARD_SQL} WHERE r.property_id = :pid AND r.status = 'in_house' ORDER BY room_number`,
    { pid: propertyId, bd },
  );
  const noShows = db.all(
    `${BOARD_SQL} WHERE r.property_id = :pid AND r.arrival = :bd AND r.status = 'no_show'`,
    { pid: propertyId, bd },
  );
  const present = (list) => list.map((r) => ({ ...r, preferences: r.preferences ? JSON.parse(r.preferences) : [] }));
  return {
    businessDate: bd,
    property: { id: prop.id, name: prop.name, check_in_time: prop.check_in_time, check_out_time: prop.check_out_time, inspection_required: prop.inspection_required, require_id_at_checkin: prop.require_id_at_checkin },
    arrivals: present(arrivals),
    departures: present(departures),
    inHouse: present(inHouse),
    noShows: present(noShows),
    counts: {
      arrivals: { done: arrivals.filter((a) => a.status !== 'confirmed').length, total: arrivals.length },
      departures: { done: departures.filter((d) => d.status !== 'in_house').length, total: departures.length },
      inHouse: inHouse.length,
      guestsInHouse: inHouse.reduce((a, r) => a + r.adults + r.children, 0),
    },
  };
}

// Forward view for the next `days` days (like a hotel "house forecast"): rooms occupied,
// available, arrivals, departures and guests per night from reservations on the books.
export function houseForecast(db, propertyId, days = 14) {
  const prop = loadProperty(db, propertyId);
  const from = prop.business_date;
  const to = addDays(from, days);
  const total = (night) =>
    db.value(
      'SELECT COUNT(*) FROM rooms WHERE property_id = ? AND commissioned_on <= ? AND (decommissioned_on IS NULL OR decommissioned_on > ?)',
      propertyId,
      night,
      night,
    );
  const occ = new Map(
    db
      .all(
        `SELECT n.night, COUNT(*) AS rooms, SUM(r.adults + r.children) AS guests FROM reservation_nights n
         JOIN reservations r ON r.id = n.reservation_id WHERE n.property_id = ? AND n.night >= ? AND n.night < ?
         AND r.status IN ('confirmed','in_house') GROUP BY n.night`,
        propertyId,
        from,
        to,
      )
      .map((r) => [r.night, r]),
  );
  const ooo = new Map(
    db
      .all(
        'SELECT night, COUNT(*) AS n FROM room_nights WHERE property_id = ? AND block_id IS NOT NULL AND night >= ? AND night < ? GROUP BY night',
        propertyId,
        from,
        to,
      )
      .map((r) => [r.night, r.n]),
  );
  const count = (col, night) =>
    db.value(
      `SELECT COUNT(*) FROM reservations WHERE property_id = ? AND ${col} = ? AND status IN ('confirmed','in_house','checked_out','closed')`,
      propertyId,
      night,
    );
  return nightsOf(from, to).map((night) => {
    const t = total(night);
    const o = occ.get(night);
    const sold = o?.rooms || 0;
    const blocked = ooo.get(night) || 0;
    return {
      night,
      total: t,
      blocked,
      occupied: sold,
      available: t - blocked - sold,
      occupancy_pct: t ? Math.round((sold / t) * 1000) / 10 : null,
      arrivals: count('arrival', night),
      departures: count('departure', night),
      guests: o?.guests || 0,
    };
  });
}

// Check-in: the reservation must be due today, have a ready room for tonight and (by policy)
// a verified identity document.
export function checkIn(db, actor, id, { roomId, idType, idNumber, idCountry, earlyFeeMinor, nowTime } = {}) {
  return db.tx(() => {
    let res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    assertTransition(res.status, 'in_house');
    const prop = loadProperty(db, res.property_id);
    if (res.arrival > prop.business_date)
      conflict(`This reservation arrives on ${res.arrival}. Change the arrival date to check in today.`, { code: 'not_due' });
    if (res.arrival < prop.business_date)
      conflict(`This reservation was due on ${res.arrival}; mark it as a no-show or change the dates`, { code: 'past_arrival' });
    if (roomId) assignRoom(db, actor, id, roomId, { allowTypeChange: true });
    const tonight = db.get(
      'SELECT rn.room_id FROM room_nights rn WHERE rn.reservation_id = ? AND rn.night = ?',
      id,
      prop.business_date,
    );
    if (!tonight) conflict('Assign a room before checking in', { code: 'no_room' });
    const room = db.get('SELECT * FROM rooms WHERE id = ?', tonight.room_id);
    assertRoomReady(db, prop, room, { exceptReservationId: id });
    const guest = db.get('SELECT * FROM guests WHERE id = ?', res.guest_id);
    if (idType && idNumber) verifyIdentity(db, actor, guest.id, { idType, idNumber, idCountry });
    else if (prop.require_id_at_checkin && !guest.id_verified_at)
      conflict('Record the guest’s identity document to check in', { code: 'id_required' });
    const local = nowTime || timeIn(prop.timezone);
    const early = local < prop.check_in_time;
    db.update('reservations', id, {
      status: 'in_house',
      checked_in_at: stamp(actor),
      early_checkin: early ? 1 : 0,
      version: res.version + 1,
      updated_at: stamp(actor),
    });
    if (early && earlyFeeMinor > 0)
      postCharge(db, actor, { reservationId: id, chargeCode: 'EARLYCI', unitMinor: earlyFeeMinor, source: 'frontdesk' });
    if (room.dnd) setRoomStatus(db, actor, room, { dnd: false, reason: 'New arrival' });
    res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    history(db, actor, res, 'checked_in', { room: room.number, early_checkin: early });
    return reservationDetail(db, id);
  });
}

// Walk-in: books from today and checks in at once (room required).
export function walkIn(db, actor, input) {
  return db.tx(() => {
    const prop = loadProperty(db, input.propertyId);
    if (!input.roomId) fail(400, 'Choose a room for the walk-in');
    const room = db.get('SELECT * FROM rooms WHERE id = ? AND property_id = ?', input.roomId, prop.id);
    assertRoomReady(db, prop, room);
    const booking = createBooking(db, actor, {
      ...input,
      source: 'Walk-in',
      status: 'confirmed',
      guarantee: input.guarantee || 'deposit',
      rooms: [{ ...input.room, arrival: prop.business_date, roomId: input.roomId, allowTypeChange: true }],
    });
    const resId = booking.reservations[0].id;
    return checkIn(db, actor, resId, { idType: input.idType, idNumber: input.idNumber, idCountry: input.idCountry });
  });
}

// Moves an in-house guest to another room from tonight; the old room goes for cleaning.
export function roomMove(db, actor, id, roomId, reason) {
  return db.tx(() => {
    const res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    if (res.status !== 'in_house') conflict('Room moves are for in-house guests; use the calendar to reassign future stays');
    if (!reason) fail(400, 'A reason is required for a room move');
    const prop = loadProperty(db, res.property_id);
    const old = db.get(
      `SELECT rm.* FROM room_nights rn JOIN rooms rm ON rm.id = rn.room_id WHERE rn.reservation_id = ? AND rn.night IN (?, ?) ORDER BY rn.night DESC LIMIT 1`,
      id,
      prop.business_date,
      addDays(prop.business_date, -1),
    );
    if (old?.id === roomId) fail(400, 'The guest is already in that room');
    assignRoom(db, actor, id, roomId, { from: prop.business_date, allowTypeChange: true });
    if (old) {
      setRoomStatus(db, actor, old, { hk_status: 'dirty', dnd: false, reason: `Guest moved: ${reason}` });
      createTask(db, actor, prop.id, { roomId: old.id, kind: 'departure', priority: 1, reservationId: id, notes: 'Room move' });
    }
    history(db, actor, res, 'room_move', { from: old?.number, to: db.value('SELECT number FROM rooms WHERE id = ?', roomId), reason });
    return reservationDetail(db, id);
  });
}

// Checkout. Early departures release the unstayed nights. Every folio must be settled: paid
// to zero, or (billTo: 'company') invoiced to the company and moved to its city-ledger account.
export function checkOut(db, actor, id, { billTo = 'guest', companyId, lateFeeMinor, invoice = true, nowTime, deferSettlement = false } = {}) {
  return db.tx(() => {
    let res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    if (!res) notFound('Reservation');
    assertTransition(res.status, 'checked_out');
    const prop = loadProperty(db, res.property_id);
    const bd = prop.business_date;
    if (res.departure > bd) {
      // Early departure: a same-day check-in-and-out still pays for the night it used.
      const keepFrom = res.arrival === bd ? addDays(bd, 1) : bd;
      if (res.arrival === bd && !res.is_complimentary && !res.is_house_use) {
        const night = db.get('SELECT * FROM reservation_nights WHERE reservation_id = ? AND night = ?', id, bd);
        postCharge(db, actor, { reservationId: id, chargeCode: 'ROOM', unitMinor: night.rate_minor, description: `Room charge ${bd} (same-day departure)`, source: 'frontdesk', dedupeKey: `room:${id}:${bd}` });
      }
      db.run('DELETE FROM room_nights WHERE reservation_id = ? AND night >= ?', id, keepFrom);
      db.run('DELETE FROM reservation_nights WHERE reservation_id = ? AND night >= ?', id, keepFrom);
      db.update('reservations', id, {
        departure: keepFrom,
        total_minor: db.value('SELECT COALESCE(SUM(rate_minor), 0) FROM reservation_nights WHERE reservation_id = ?', id),
      });
    }
    const local = nowTime || timeIn(prop.timezone);
    const late = local > prop.check_out_time;
    if (late && lateFeeMinor > 0)
      postCharge(db, actor, { reservationId: id, chargeCode: 'LATECO', unitMinor: lateFeeMinor, source: 'frontdesk' });

    const folios = db.all("SELECT * FROM folios WHERE reservation_id = ? AND status = 'open' ORDER BY folio_window", id);
    const invoices = [];
    const deferred = [];
    for (const f of folios) {
      const bal = folioBalance(db, f.id);
      const toCompany = billTo === 'company' || (f.company_id && f.folio_window > 1);
      const company = toCompany ? companyId || f.company_id || res.company_id : null;
      if (bal > 0 && !company && deferSettlement) {
        // Guest left with a balance (authorised): the folio stays open for later settlement.
        deferred.push({ folioId: f.id, folio_no: f.folio_no, balance_minor: bal });
        continue;
      }
      if (bal > 0 && !company)
        conflict(`Folio ${f.folio_no} has a balance to settle`, { code: 'balance_due', details: { folioId: f.id, balance_minor: bal } });
      if (bal < 0) conflict(`Folio ${f.folio_no} is in credit; refund the guest first`, { code: 'credit_balance', details: { folioId: f.id, balance_minor: bal } });
      let inv = null;
      const hasCharges = db.value(
        "SELECT COUNT(*) FROM folio_postings WHERE folio_id = ? AND invoice_id IS NULL AND (net_minor <> 0 OR tax_minor <> 0)",
        f.id,
      );
      if (invoice && hasCharges) inv = issueInvoice(db, actor, f.id, company ? { companyId: company } : {});
      if (inv) invoices.push(inv);
      if (bal > 0 && company) transferBalanceToCompany(db, actor, f.id, company, { invoiceNo: inv?.invoice_no });
      closeFolio(db, actor, f.id);
    }

    // Room goes for a departure clean; priority if someone arrives into it today.
    const room = db.get(
      `SELECT rm.* FROM room_nights rn JOIN rooms rm ON rm.id = rn.room_id WHERE rn.reservation_id = ? ORDER BY rn.night DESC LIMIT 1`,
      id,
    );
    if (room) {
      setRoomStatus(db, actor, room, { hk_status: 'dirty', dnd: false, reason: `Checkout ${res.conf_no}` });
      const arrivalToday = db.value(
        "SELECT 1 FROM room_nights rn JOIN reservations r ON r.id = rn.reservation_id WHERE rn.room_id = ? AND rn.night = ? AND r.status = 'confirmed'",
        room.id,
        bd,
      );
      createTask(db, actor, prop.id, { roomId: room.id, kind: 'departure', priority: arrivalToday ? 2 : 1, reservationId: id });
    }
    db.update('reservations', id, {
      status: deferred.length ? 'checked_out' : 'closed',
      checked_out_at: stamp(actor),
      late_checkout: late ? 1 : 0,
      version: res.version + 1,
      updated_at: stamp(actor),
    });
    res = db.get('SELECT * FROM reservations WHERE id = ?', id);
    history(db, actor, res, 'checked_out', {
      room: room?.number,
      late_checkout: late,
      invoices: invoices.map((i) => i.invoice_no),
      bill_to: billTo,
      deferred_settlement: deferred.length ? deferred : undefined,
    });
    return { ...reservationDetail(db, id), invoices, deferred };
  });
}

// ---------- guest requests ----------
export function createRequest(db, actor, propertyId, input) {
  const kinds = ['request', 'complaint', 'wake_up', 'transport', 'luggage', 'room_service', 'maintenance'];
  if (!kinds.includes(input.kind)) fail(400, 'Unknown request type');
  if (!input.description) fail(400, 'Describe the request');
  let roomId = input.roomId ?? null;
  if (input.reservationId) {
    const r = db.get('SELECT * FROM reservations WHERE id = ? AND property_id = ?', input.reservationId, propertyId);
    if (!r) notFound('Reservation');
    roomId ||= db.value('SELECT room_id FROM room_nights WHERE reservation_id = ? ORDER BY night DESC LIMIT 1', r.id);
  }
  const id = db.insert('guest_requests', {
    property_id: propertyId,
    reservation_id: input.reservationId ?? null,
    room_id: roomId,
    kind: input.kind,
    description: input.description,
    due_at: input.dueAt ?? null,
    priority: input.priority ?? (input.kind === 'complaint' ? 1 : 0),
    assigned_to: input.assignedTo ?? null,
    created_by: actor?.id ?? null,
  });
  if (input.kind === 'maintenance' && roomId) {
    const room = db.get('SELECT * FROM rooms WHERE id = ?', roomId);
    setRoomStatus(db, actor, room, { maintenance_flag: 'required', maintenance_note: input.description, reason: 'Guest request' });
  }
  audit(db, actor, 'guest_request.create', { entity: 'guest_request', entityId: id, propertyId, after: input });
  return db.get('SELECT * FROM guest_requests WHERE id = ?', id);
}

export function updateRequest(db, actor, request, { status, resolution, assignedTo }) {
  if (status && !['open', 'in_progress', 'done', 'cancelled'].includes(status)) fail(400, 'Unknown status');
  db.update('guest_requests', request.id, {
    ...(status ? { status } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(assignedTo !== undefined ? { assigned_to: assignedTo } : {}),
    ...(status === 'done' ? { resolved_at: stamp(actor) } : {}),
  });
  audit(db, actor, 'guest_request.update', { entity: 'guest_request', entityId: request.id, propertyId: request.property_id, after: { status, resolution } });
  return db.get('SELECT * FROM guest_requests WHERE id = ?', request.id);
}

export function listRequests(db, propertyId, { status } = {}) {
  const st = status ? String(status).split(',') : ['open', 'in_progress'];
  return db.all(
    `SELECT q.*, rm.number AS room_number, r.conf_no, g.first_name || ' ' || g.last_name AS guest, u.name AS assigned_name
     FROM guest_requests q LEFT JOIN rooms rm ON rm.id = q.room_id LEFT JOIN reservations r ON r.id = q.reservation_id
     LEFT JOIN guests g ON g.id = r.guest_id LEFT JOIN users u ON u.id = q.assigned_to
     WHERE q.property_id = ? AND q.status IN (${st.map(() => '?').join(',')}) ORDER BY q.priority DESC, COALESCE(q.due_at, q.created_at)`,
    propertyId,
    ...st,
  );
}

// ---------- cashier shifts ----------
export function openShift(db, actor, propertyId, { openingFloatMinor = 0 }) {
  const prop = loadProperty(db, propertyId);
  if (db.value("SELECT 1 FROM cashier_shifts WHERE property_id = ? AND user_id = ? AND status = 'open'", propertyId, actor.id))
    conflict('You already have an open cashier shift');
  const id = db.insert('cashier_shifts', { property_id: propertyId, user_id: actor.id, business_date: prop.business_date, opening_float_minor: openingFloatMinor });
  audit(db, actor, 'cashier.open', { entity: 'cashier_shift', entityId: id, propertyId, after: { openingFloatMinor } });
  return shiftSummary(db, id);
}

export function shiftSummary(db, id) {
  const s = db.get('SELECT s.*, u.name AS user_name FROM cashier_shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?', id);
  if (!s) notFound('Shift');
  const byMethod = db.all(
    `SELECT payment_method, kind, COUNT(*) AS n, -SUM(amount_minor) AS amount_minor FROM folio_postings
     WHERE cashier_shift_id = ? AND kind IN ('payment','refund') GROUP BY payment_method, kind`,
    id,
  );
  const cash = byMethod.filter((m) => m.payment_method === 'CASH').reduce((a, m) => a + m.amount_minor, 0);
  return { ...s, byMethod, expected_cash_now_minor: s.opening_float_minor + cash };
}

export function closeShift(db, actor, id, { countedCashMinor }) {
  return db.tx(() => {
    const s = shiftSummary(db, id);
    if (s.status !== 'open') conflict('This shift is already closed');
    if (s.user_id !== actor.id && !actor.permissions?.includes('folio.adjust')) fail(403, 'Only the cashier or a manager can close this shift');
    if (!Number.isInteger(countedCashMinor) || countedCashMinor < 0) fail(400, 'Enter the cash counted');
    db.run(
      "UPDATE cashier_shifts SET status = 'closed', closed_at = ?, expected_cash_minor = ?, counted_cash_minor = ?, variance_minor = ? WHERE id = ?",
      stamp(actor),
      s.expected_cash_now_minor,
      countedCashMinor,
      countedCashMinor - s.expected_cash_now_minor,
      id,
    );
    audit(db, actor, 'cashier.close', { entity: 'cashier_shift', entityId: id, propertyId: s.property_id, after: { counted: countedCashMinor, expected: s.expected_cash_now_minor } });
    return shiftSummary(db, id);
  });
}

// After a deferred settlement is paid and its folios closed, the reservation is closed.
export function completeSettlement(db, actor, reservationId) {
  const res = db.get('SELECT * FROM reservations WHERE id = ?', reservationId);
  if (!res || res.status !== 'checked_out') return res;
  if (db.value("SELECT COUNT(*) FROM folios WHERE reservation_id = ? AND status = 'open'", reservationId)) return res;
  db.update('reservations', reservationId, { status: 'closed', version: res.version + 1, updated_at: stamp(actor) });
  history(db, actor, res, 'settled', { status: { from: 'checked_out', to: 'closed' } });
  return db.get('SELECT * FROM reservations WHERE id = ?', reservationId);
}
