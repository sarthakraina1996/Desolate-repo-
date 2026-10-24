// Reservations API: search, create (single, multi-room, group), modify, move, assign,
// confirm quotes, cancel, no-show and booking lookup.
import { fail } from '../../core/errors.js';
import { str, int, date, oneOf, bool, money } from '../../core/validate.js';
import { perm, propertyOf } from '../../core/http.js';
import { propertyScope, scopedRow, requirePermission } from '../../core/access.js';
import { can } from '../../core/permissions.js';
import { guestInput } from '../guests/routes.js';
import {
  assignRoom,
  autoAssign,
  bookingDetail,
  cancelReservation,
  confirmQuote,
  createBooking,
  listReservations,
  markNoShow,
  modifyReservation,
  moveReservation,
  reservationDetail,
  SEGMENTS,
  SOURCES,
  STATUSES,
  unassignRoom,
} from './service.js';

// Hides money from users who may see reservations but not folios (e.g. banquets).
function present(detail, user) {
  if (can(user, 'folio.view')) return detail;
  const { folios, balance_minor, ...rest } = detail;
  return { ...rest, nights: rest.nights?.map(({ rate_minor, ...n }) => n), total_minor: null };
}

function overrides(req) {
  const b = req.body || {};
  const want = { allowOverbooking: bool(b.allowOverbooking), overrideRestrictions: bool(b.overrideRestrictions) };
  if ((want.allowOverbooking || want.overrideRestrictions) && !can(req.user, 'reservations.override'))
    fail(403, 'Overbooking and restriction overrides need a manager', { code: 'forbidden' });
  return want;
}

function roomLine(b, currency, user) {
  const line = {
    roomTypeId: int(b.roomTypeId, { required: true, min: 1, name: 'Room type' }),
    ratePlanId: b.ratePlanId ? int(b.ratePlanId, { min: 1, name: 'Rate plan' }) : null,
    arrival: date(b.arrival, { required: true, name: 'Arrival' }),
    departure: date(b.departure, { required: true, name: 'Departure' }),
    adults: int(b.adults, { min: 1, max: 20, name: 'Adults' }) || 1,
    children: int(b.children, { min: 0, max: 20, name: 'Children' }) || 0,
    roomId: b.roomId ? int(b.roomId, { min: 1, name: 'Room' }) : null,
    allowTypeChange: bool(b.allowTypeChange),
    guestId: b.guestId ? int(b.guestId, { min: 1 }) : null,
    rateMinor: b.rate !== undefined && b.rate !== null && b.rate !== '' ? money(b.rate, currency, { name: 'Rate' }) : null,
    isComplimentary: bool(b.isComplimentary),
    isHouseUse: bool(b.isHouseUse),
    specialRequests: str(b.specialRequests, { max: 1000 }),
    eta: str(b.eta, { max: 5 }),
    depositRequiredMinor: money(b.deposit, currency, { name: 'Deposit' }) ?? 0,
  };
  if ((line.rateMinor != null || line.isComplimentary || line.isHouseUse) && !can(user, 'reservations.override'))
    fail(403, 'Manual rates and complimentary stays need a manager', { code: 'forbidden' });
  return line;
}

export default function reservationRoutes(r, { db }) {
  r.get('/meta/reservations', (_req, res) => res.json({ sources: SOURCES, segments: SEGMENTS, statuses: STATUSES }));

  r.get('/reservations', perm('reservations.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    const q = req.query;
    const out = listReservations(db, pids, {
      status: q.status,
      arrivalFrom: date(q.arrivalFrom),
      arrivalTo: date(q.arrivalTo),
      stayOn: date(q.stayOn),
      source: q.source && SOURCES.includes(q.source) ? q.source : null,
      roomTypeId: int(q.roomTypeId, { min: 1 }),
      q: str(q.q, { max: 80 }),
      sort: q.sort,
      dir: q.dir,
      limit: int(q.limit, { min: 1, max: 200 }),
      offset: int(q.offset, { min: 0 }),
    });
    if (!can(req.user, 'folio.view')) out.rows = out.rows.map((x) => ({ ...x, total_minor: null }));
    res.json(out);
  });

  r.post('/reservations', perm('reservations.create'), (req, res) => {
    const pid = propertyOf(db, req);
    const b = req.body || {};
    const currency = db.value('SELECT currency FROM properties WHERE id = ?', pid);
    const rooms = Array.isArray(b.rooms) ? b.rooms : [];
    if (!rooms.length) fail(400, 'Add at least one room');
    const input = {
      propertyId: pid,
      guestId: b.guestId ? int(b.guestId, { min: 1 }) : null,
      guest: b.guestId ? null : b.guest ? guestInput(b.guest) : null,
      companyId: b.companyId ? int(b.companyId, { min: 1 }) : null,
      source: oneOf(b.source || 'Direct', SOURCES, { name: 'Source' }),
      channel: str(b.channel, { max: 40 }),
      channelRef: str(b.channelRef, { max: 60 }),
      segment: b.segment ? oneOf(b.segment, SEGMENTS, { name: 'Segment' }) : null,
      notes: str(b.notes, { max: 2000 }),
      groupName: str(b.groupName, { max: 120 }),
      status: oneOf(b.status || 'confirmed', ['confirmed', 'quote'], { name: 'Status' }),
      guarantee: oneOf(b.guarantee || 'none', ['none', 'card', 'deposit', 'company', 'ota_prepaid'], { name: 'Guarantee' }),
      commissionBp: b.commissionBp != null ? int(b.commissionBp, { min: 0, max: 5000 }) : undefined,
      rooms: rooms.map((l) => roomLine(l, currency, req.user)),
    };
    if (input.guest && !input.guest.first_name) fail(400, 'Guest first name is required');
    res.status(201).json(createBooking(db, req.user, input, { ...overrides(req), idempotencyKey: req.idempotencyKey }));
  });

  r.get('/bookings/:id', perm('reservations.view'), (req, res) => {
    const b = scopedRow(db, req.user, 'bookings', int(req.params.id, { min: 1 }), 'Booking');
    const d = bookingDetail(db, b.id);
    res.json({ ...d, reservations: d.reservations.map((x) => present(x, req.user)) });
  });

  r.get('/reservations/:id', perm('reservations.view'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    res.json(present(reservationDetail(db, row.id), req.user));
  });

  r.put('/reservations/:id', perm('reservations.modify'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    const b = req.body || {};
    const currency = row.currency;
    const input = {};
    if (b.arrival !== undefined) input.arrival = date(b.arrival, { required: true, name: 'Arrival' });
    if (b.departure !== undefined) input.departure = date(b.departure, { required: true, name: 'Departure' });
    if (b.roomTypeId !== undefined) input.room_type_id = int(b.roomTypeId, { required: true, min: 1 });
    if (b.ratePlanId !== undefined) input.rate_plan_id = b.ratePlanId ? int(b.ratePlanId, { min: 1 }) : null;
    if (b.adults !== undefined) input.adults = int(b.adults, { required: true, min: 1, max: 20 });
    if (b.children !== undefined) input.children = int(b.children, { required: true, min: 0, max: 20 });
    if (b.companyId !== undefined) input.company_id = b.companyId ? int(b.companyId, { min: 1 }) : null;
    if (b.source !== undefined) input.source = oneOf(b.source, SOURCES, { required: true });
    if (b.segment !== undefined) input.segment = b.segment ? oneOf(b.segment, SEGMENTS) : null;
    if (b.eta !== undefined) input.eta = str(b.eta, { max: 5 });
    if (b.specialRequests !== undefined) input.special_requests = str(b.specialRequests, { max: 1000 });
    if (b.notes !== undefined) input.notes = str(b.notes, { max: 2000 });
    if (b.guarantee !== undefined) input.guarantee = oneOf(b.guarantee, ['none', 'card', 'deposit', 'company', 'ota_prepaid'], { required: true });
    if (b.deposit !== undefined) input.deposit_required_minor = money(b.deposit, currency) ?? 0;
    if (b.roomId !== undefined && b.roomId) input.room_id = int(b.roomId, { min: 1 });
    if (b.rate !== undefined && b.rate !== null && b.rate !== '') {
      requirePermission(req, 'reservations.override');
      input.rate_minor = money(b.rate, currency, { name: 'Rate' });
    }
    if (b.isComplimentary !== undefined) {
      requirePermission(req, 'reservations.override');
      input.is_complimentary = bool(b.isComplimentary);
    }
    res.json(
      present(
        modifyReservation(db, req.user, row.id, input, {
          ...overrides(req),
          version: b.version,
          allowTypeChange: bool(b.allowTypeChange),
          unassignedOk: bool(b.unassignedOk),
        }),
        req.user,
      ),
    );
  });

  // Calendar drag-and-drop: new room and/or new arrival date, validated on the server.
  r.post('/reservations/:id/move', perm('reservations.modify'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    const b = req.body || {};
    res.json(
      present(
        moveReservation(db, req.user, row.id, {
          roomId: b.roomId ? int(b.roomId, { min: 1 }) : null,
          arrival: date(b.arrival),
          version: b.version,
          allowTypeChange: bool(b.allowTypeChange),
          ...overrides(req),
        }),
        req.user,
      ),
    );
  });

  r.post('/reservations/:id/assign', perm('reservations.modify'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    const b = req.body || {};
    res.json(
      present(
        assignRoom(db, req.user, row.id, int(b.roomId, { required: true, min: 1, name: 'Room' }), {
          from: date(b.from),
          to: date(b.to),
          allowTypeChange: bool(b.allowTypeChange),
          ...overrides(req),
        }),
        req.user,
      ),
    );
  });
  r.post('/reservations/:id/unassign', perm('reservations.modify'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    res.json(present(unassignRoom(db, req.user, row.id, { from: date(req.body?.from) }), req.user));
  });
  r.post('/reservations/auto-assign', perm('frontdesk.operate'), (req, res) => {
    const pid = propertyOf(db, req);
    const night = date(req.body?.night) || db.value('SELECT business_date FROM properties WHERE id = ?', pid);
    res.json(autoAssign(db, req.user, pid, night));
  });
  r.post('/reservations/:id/confirm', perm('reservations.modify'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    res.json(present(confirmQuote(db, req.user, row.id, overrides(req)), req.user));
  });
  r.post('/reservations/:id/cancel', perm('reservations.cancel'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    const waiveFee = bool(req.body?.waiveFee);
    if (waiveFee && !can(req.user, 'reservations.override') && !can(req.user, 'folio.adjust'))
      fail(403, 'Waiving a cancellation fee needs a manager', { code: 'forbidden' });
    res.json(present(cancelReservation(db, req.user, row.id, { reason: str(req.body?.reason, { required: true, max: 300, name: 'Reason' }), waiveFee }), req.user));
  });
  r.post('/reservations/:id/no-show', perm('frontdesk.operate'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    const waiveFee = bool(req.body?.waiveFee);
    if (waiveFee && !can(req.user, 'folio.adjust')) fail(403, 'Waiving a no-show fee needs a manager', { code: 'forbidden' });
    res.json(present(markNoShow(db, req.user, row.id, { waiveFee }), req.user));
  });
}
