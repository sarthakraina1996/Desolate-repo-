// Room-type inventory per night (ADR-4). A night of a reservation consumes the type of the room
// it is assigned to, or its booked type while unassigned. Sellable rooms = active rooms of the
// type − rooms blocked (OOO/OOS) that night. Physical overlaps are prevented separately by the
// room_nights primary key.
import { conflict } from '../../core/errors.js';
import { inList } from '../../core/access.js';

export const HOLDING = ['confirmed', 'in_house'];

// { [roomTypeId]: { [night]: { total, blocked, sellable, consumed, available } } } for [from, to).
export function availability(db, propertyId, from, to, { excludeReservationIds = [] } = {}) {
  const out = {};
  const types = db.all('SELECT id FROM room_types WHERE property_id = ?', propertyId);
  for (const t of types) out[t.id] = {};
  // Active rooms per type for each night of the range.
  const rows = db.all(
    `WITH RECURSIVE d(night) AS (SELECT ? UNION ALL SELECT date(night, '+1 day') FROM d WHERE date(night, '+1 day') < ?)
     SELECT r.room_type_id AS t, d.night, COUNT(*) AS n FROM d JOIN rooms r
       ON r.property_id = ? AND r.commissioned_on <= d.night AND (r.decommissioned_on IS NULL OR r.decommissioned_on > d.night)
     GROUP BY r.room_type_id, d.night`,
    from,
    to,
    propertyId,
  );
  const cell = (t, night) =>
    (out[t][night] ||= { total: 0, blocked: 0, sellable: 0, consumed: 0, available: 0 });
  for (const r of rows) cell(r.t, r.night).total = r.n;
  for (const b of db.all(
    `SELECT rm.room_type_id AS t, rn.night, COUNT(*) AS n FROM room_nights rn JOIN rooms rm ON rm.id = rn.room_id
     WHERE rn.property_id = ? AND rn.block_id IS NOT NULL AND rn.night >= ? AND rn.night < ?
     GROUP BY rm.room_type_id, rn.night`,
    propertyId,
    from,
    to,
  ))
    cell(b.t, b.night).blocked = b.n;
  const excl = excludeReservationIds.length ? `AND r.id NOT IN ${inList(excludeReservationIds)}` : '';
  for (const c of db.all(
    `SELECT COALESCE(rm.room_type_id, n.room_type_id) AS t, n.night, COUNT(*) AS n
     FROM reservation_nights n JOIN reservations r ON r.id = n.reservation_id
     LEFT JOIN room_nights x ON x.reservation_id = n.reservation_id AND x.night = n.night
     LEFT JOIN rooms rm ON rm.id = x.room_id
     WHERE n.property_id = ? AND n.night >= ? AND n.night < ? AND r.status IN ('confirmed','in_house') ${excl}
     GROUP BY 1, n.night`,
    propertyId,
    from,
    to,
    ...excludeReservationIds,
  ))
    cell(c.t, c.night).consumed = c.n;
  for (const t of Object.keys(out))
    for (const night of Object.keys(out[t])) {
      const x = out[t][night];
      x.sellable = Math.max(0, x.total - x.blocked);
      x.available = x.sellable - x.consumed;
    }
  return out;
}

// Checks that `needs` ([{ roomTypeId, night }], one entry per room night requested) fit the
// inventory. Beyond capacity needs explicit overbooking (permission + property allowance).
export function assertInventory(db, prop, needs, { allowOverbooking = false, excludeReservationIds = [] } = {}) {
  if (!needs.length) return;
  const nights = needs.map((n) => n.night).sort();
  const from = nights[0];
  const to = new Date(Date.parse(`${nights[nights.length - 1]}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const avail = availability(db, prop.id, from, to, { excludeReservationIds });
  const want = new Map();
  for (const n of needs) want.set(`${n.roomTypeId}|${n.night}`, (want.get(`${n.roomTypeId}|${n.night}`) || 0) + 1);
  const short = [];
  for (const [key, qty] of want) {
    const [t, night] = key.split('|');
    const a = avail[t]?.[night] || { sellable: 0, available: 0 };
    const allowance = allowOverbooking ? Math.floor((a.sellable * prop.overbooking_pct) / 100) : 0;
    if (a.available - qty < -allowance)
      short.push({ roomTypeId: Number(t), night, available: a.available, requested: qty, allowance });
  }
  if (short.length) {
    const names = new Map(
      db.all('SELECT id, name FROM room_types WHERE property_id = ?', prop.id).map((r) => [r.id, r.name]),
    );
    const first = short[0];
    conflict(
      `${names.get(first.roomTypeId) || 'This room type'} is sold out on ${first.night}` +
        (short.length > 1 ? ` (and ${short.length - 1} more night${short.length > 2 ? 's' : ''})` : ''),
      { code: 'sold_out', details: { nights: short } },
    );
  }
}
