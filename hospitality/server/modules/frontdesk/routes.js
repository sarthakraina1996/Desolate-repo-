// Front desk: boards, forecast, check-in/out, walk-ins, room moves, guest requests, cashier.
import { fail } from '../../core/errors.js';
import { str, int, date, oneOf, bool, money } from '../../core/validate.js';
import { perm, propertyOf } from '../../core/http.js';
import { scopedRow, requirePermission } from '../../core/access.js';
import { can } from '../../core/permissions.js';
import { guestInput } from '../guests/routes.js';
import { reservationDetail } from '../reservations/service.js';
import {
  boards,
  checkIn,
  checkOut,
  closeShift,
  createRequest,
  houseForecast,
  listRequests,
  openShift,
  roomMove,
  shiftSummary,
  updateRequest,
  walkIn,
} from './service.js';

const ID_TYPES = ['passport', 'aadhaar', 'driving_licence', 'voter_id', 'national_id', 'other'];

export default function frontdeskRoutes(r, { db }) {
  r.get('/frontdesk/boards', perm('reservations.view'), (req, res) => {
    const out = boards(db, propertyOf(db, req), date(req.query.date));
    if (!can(req.user, 'folio.view'))
      for (const k of ['arrivals', 'departures', 'inHouse', 'noShows']) out[k] = out[k].map((x) => ({ ...x, balance_minor: null, total_minor: null }));
    res.json(out);
  });
  r.get('/frontdesk/forecast', perm('reservations.view'), (req, res) =>
    res.json(houseForecast(db, propertyOf(db, req), int(req.query.days, { min: 1, max: 60 }) || 14)),
  );

  r.post('/frontdesk/:id/check-in', perm('frontdesk.operate'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    const b = req.body || {};
    res.json(
      checkIn(db, req.user, row.id, {
        roomId: b.roomId ? int(b.roomId, { min: 1 }) : null,
        idType: b.idType ? oneOf(b.idType, ID_TYPES, { name: 'Document type' }) : null,
        idNumber: str(b.idNumber, { max: 40 }),
        idCountry: str(b.idCountry, { max: 2 }),
        earlyFeeMinor: money(b.earlyFee, row.currency) ?? 0,
      }),
    );
  });

  r.post('/frontdesk/:id/check-out', perm('frontdesk.operate'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    const b = req.body || {};
    const deferSettlement = bool(b.deferSettlement);
    if (deferSettlement) requirePermission(req, 'folio.adjust');
    const billTo = oneOf(b.billTo || 'guest', ['guest', 'company'], { name: 'Bill to' });
    if (billTo === 'company') requirePermission(req, 'folio.post');
    res.json(
      checkOut(db, req.user, row.id, {
        billTo,
        companyId: b.companyId ? int(b.companyId, { min: 1 }) : null,
        lateFeeMinor: money(b.lateFee, row.currency) ?? 0,
        deferSettlement,
      }),
    );
  });

  r.post('/frontdesk/walk-in', perm('frontdesk.operate', 'reservations.create'), (req, res) => {
    const pid = propertyOf(db, req);
    const b = req.body || {};
    const prop = db.get('SELECT currency, business_date FROM properties WHERE id = ?', pid);
    if (!b.guestId && !b.guest?.first_name) fail(400, 'Guest first name is required');
    const rate = b.rate !== undefined && b.rate !== '' && b.rate !== null ? money(b.rate, prop.currency) : null;
    if (rate != null) requirePermission(req, 'reservations.override');
    res.status(201).json(
      walkIn(db, req.user, {
        propertyId: pid,
        guestId: b.guestId ? int(b.guestId, { min: 1 }) : null,
        guest: b.guestId ? null : guestInput(b.guest),
        roomId: int(b.roomId, { required: true, min: 1, name: 'Room' }),
        idType: b.idType ? oneOf(b.idType, ID_TYPES) : null,
        idNumber: str(b.idNumber, { max: 40 }),
        idCountry: str(b.idCountry, { max: 2 }),
        room: {
          roomTypeId: int(b.roomTypeId, { required: true, min: 1, name: 'Room type' }),
          ratePlanId: b.ratePlanId ? int(b.ratePlanId, { min: 1 }) : null,
          departure: date(b.departure, { required: true, name: 'Departure' }),
          adults: int(b.adults, { min: 1, max: 20 }) || 1,
          children: int(b.children, { min: 0, max: 20 }) || 0,
          rateMinor: rate,
        },
      }),
    );
  });

  r.post('/frontdesk/:id/room-move', perm('frontdesk.operate'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    res.json(roomMove(db, req.user, row.id, int(req.body?.roomId, { required: true, min: 1, name: 'Room' }), str(req.body?.reason, { required: true, max: 300, name: 'Reason' })));
  });

  // Guest services
  r.get('/guest-requests', perm('reservations.view'), (req, res) => res.json(listRequests(db, propertyOf(db, req), { status: req.query.status })));
  r.post('/guest-requests', perm('frontdesk.operate'), (req, res) => {
    const pid = propertyOf(db, req);
    const b = req.body || {};
    res.status(201).json(
      createRequest(db, req.user, pid, {
        kind: oneOf(b.kind, ['request', 'complaint', 'wake_up', 'transport', 'luggage', 'room_service', 'maintenance'], { required: true, name: 'Type' }),
        description: str(b.description, { required: true, max: 1000, name: 'Description' }),
        reservationId: b.reservationId ? int(b.reservationId, { min: 1 }) : null,
        roomId: b.roomId ? int(b.roomId, { min: 1 }) : null,
        dueAt: str(b.dueAt, { max: 30 }),
        priority: int(b.priority, { min: 0, max: 2 }),
        assignedTo: b.assignedTo ? int(b.assignedTo, { min: 1 }) : null,
      }),
    );
  });
  r.put('/guest-requests/:id', perm('frontdesk.operate'), (req, res) => {
    const q = scopedRow(db, req.user, 'guest_requests', int(req.params.id, { min: 1 }), 'Request');
    res.json(updateRequest(db, req.user, q, { status: req.body?.status, resolution: str(req.body?.resolution, { max: 1000 }), assignedTo: req.body?.assignedTo }));
  });

  // Cashier shifts
  r.get('/cashier/shift', perm('cashier.operate'), (req, res) => {
    const pid = propertyOf(db, req);
    const id = db.value("SELECT id FROM cashier_shifts WHERE property_id = ? AND user_id = ? AND status = 'open'", pid, req.user.id);
    res.json({
      current: id ? shiftSummary(db, id) : null,
      recent: db.all(
        `SELECT s.*, u.name AS user_name FROM cashier_shifts s JOIN users u ON u.id = s.user_id WHERE s.property_id = ? ORDER BY s.id DESC LIMIT 20`,
        pid,
      ),
    });
  });
  r.post('/cashier/open', perm('cashier.operate'), (req, res) => {
    const pid = propertyOf(db, req);
    const currency = db.value('SELECT currency FROM properties WHERE id = ?', pid);
    res.status(201).json(openShift(db, req.user, pid, { openingFloatMinor: money(req.body?.openingFloat, currency) ?? 0 }));
  });
  r.post('/cashier/:id/close', perm('cashier.operate'), (req, res) => {
    const s = scopedRow(db, req.user, 'cashier_shifts', int(req.params.id, { min: 1 }), 'Shift');
    const currency = db.value('SELECT currency FROM properties WHERE id = ?', s.property_id);
    res.json(closeShift(db, req.user, s.id, { countedCashMinor: money(req.body?.countedCash, currency, { required: true, name: 'Counted cash' }) }));
  });

  r.get('/frontdesk/:id', perm('reservations.view'), (req, res) => {
    const row = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    res.json(reservationDetail(db, row.id));
  });
}
