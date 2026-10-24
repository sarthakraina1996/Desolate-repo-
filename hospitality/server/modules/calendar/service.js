// Booking calendar data: one row per room (grouped by room type), reservation segments built
// from the per-night room locks, maintenance blocks, unassigned reservations, availability per
// room type per night, occupancy per night and overbooking alerts.
import { addDays, nights as nightsOf } from '../../core/dates.js';
import { availability } from '../reservations/inventory.js';
import { loadProperty } from '../reservations/service.js';

export function timeline(db, propertyId, from, days) {
  const prop = loadProperty(db, propertyId);
  const to = addDays(from, days);
  const nights = nightsOf(from, to);
  const roomTypes = db.all(
    'SELECT id, code, name, color, sort FROM room_types WHERE property_id = ? AND active = 1 ORDER BY sort, code',
    propertyId,
  );
  const rooms = db.all(
    `SELECT r.id, r.number, r.room_type_id, r.hk_status, r.dnd, r.maintenance_flag, r.accessible,
            COALESCE(r.max_adults, t.max_adults) AS max_adults, f.level AS floor_level, f.name AS floor_name,
            b.code AS building_code, r.commissioned_on, r.decommissioned_on
     FROM rooms r JOIN room_types t ON t.id = r.room_type_id JOIN floors f ON f.id = r.floor_id JOIN buildings b ON b.id = r.building_id
     WHERE r.property_id = ? AND r.commissioned_on < ? AND (r.decommissioned_on IS NULL OR r.decommissioned_on > ?)
     ORDER BY t.sort, t.code, b.sort, f.level, r.sort, r.number`,
    propertyId,
    to,
    from,
  );
  // Room nights in the window joined with their reservation; consecutive nights of the same
  // reservation in the same room become one segment.
  const cells = db.all(
    `SELECT rn.room_id, rn.night, rn.reservation_id, rn.block_id
     FROM room_nights rn WHERE rn.property_id = ? AND rn.night >= ? AND rn.night < ? ORDER BY rn.room_id, rn.night`,
    propertyId,
    from,
    to,
  );
  const resIds = [...new Set(cells.filter((c) => c.reservation_id).map((c) => c.reservation_id))];
  const unassignedIds = db
    .all(
      `SELECT DISTINCT n.reservation_id AS id FROM reservation_nights n JOIN reservations r ON r.id = n.reservation_id
       LEFT JOIN room_nights x ON x.reservation_id = n.reservation_id AND x.night = n.night
       WHERE n.property_id = ? AND n.night >= ? AND n.night < ? AND r.status IN ('confirmed','in_house') AND x.room_id IS NULL`,
      propertyId,
      from,
      to,
    )
    .map((r) => r.id);
  const allIds = [...new Set([...resIds, ...unassignedIds])];
  const info = new Map();
  if (allIds.length) {
    // Chunked to stay well under SQLite's parameter limit.
    for (let i = 0; i < allIds.length; i += 500) {
      const chunk = allIds.slice(i, i + 500);
      for (const r of db.all(
        `SELECT r.id, r.conf_no, r.status, r.arrival, r.departure, r.adults, r.children, r.source, r.channel,
                r.room_type_id, r.total_minor, r.currency, r.is_complimentary, r.version, r.booking_id,
                g.first_name, g.last_name, g.vip, rp.code AS rate_plan_code, b.group_name,
                (SELECT COUNT(*) FROM reservations x WHERE x.booking_id = r.booking_id) AS booking_rooms,
                (SELECT COALESCE(SUM(p.amount_minor), 0) FROM folio_postings p JOIN folios f ON f.id = p.folio_id WHERE f.reservation_id = r.id) AS balance_minor
         FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN bookings b ON b.id = r.booking_id
         LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id WHERE r.id IN (${chunk.map(() => '?').join(',')})`,
        ...chunk,
      ))
        info.set(r.id, r);
    }
  }
  // Blocks as they actually lock rooms (released nights are gone from room_nights).
  const blockInfo = new Map(
    db
      .all('SELECT id, kind, reason, start_date, end_date FROM room_blocks WHERE property_id = ? AND start_date < ? AND end_date > ?', propertyId, to, from)
      .map((b) => [b.id, b]),
  );
  const blocks = [];
  let bcur = null;
  for (const c of cells) {
    if (!c.block_id) continue;
    if (bcur && bcur.roomId === c.room_id && bcur.id === c.block_id && bcur.end === c.night) {
      bcur.end = addDays(c.night, 1);
      continue;
    }
    const b = blockInfo.get(c.block_id);
    bcur = { id: c.block_id, roomId: c.room_id, kind: b?.kind, reason: b?.reason, start: c.night, end: addDays(c.night, 1), blockStart: b?.start_date, blockEnd: b?.end_date };
    blocks.push(bcur);
  }
  const segments = [];
  let cur = null;
  for (const c of cells) {
    if (!c.reservation_id) continue;
    if (cur && cur.roomId === c.room_id && cur.reservationId === c.reservation_id && cur.end === c.night) {
      cur.end = addDays(c.night, 1);
      continue;
    }
    cur = { reservationId: c.reservation_id, roomId: c.room_id, start: c.night, end: addDays(c.night, 1) };
    segments.push(cur);
  }
  const present = (r) => ({
    confNo: r.conf_no,
    status: r.status,
    arrival: r.arrival,
    departure: r.departure,
    guest: `${r.first_name} ${r.last_name}`.trim(),
    vip: r.vip,
    adults: r.adults,
    children: r.children,
    source: r.source,
    channel: r.channel,
    roomTypeId: r.room_type_id,
    ratePlan: r.rate_plan_code,
    totalMinor: r.total_minor,
    balanceMinor: r.balance_minor,
    complimentary: Boolean(r.is_complimentary),
    groupName: r.group_name,
    bookingRooms: r.booking_rooms,
    bookingId: r.booking_id,
    version: r.version,
  });
  for (const s of segments) {
    const r = info.get(s.reservationId);
    Object.assign(s, present(r), {
      startsHere: s.start === r.arrival,
      endsHere: s.end === r.departure,
      split: s.start !== r.arrival || s.end !== r.departure,
    });
  }
  const unassigned = unassignedIds.map((id) => {
    const r = info.get(id);
    const missing = db
      .all(
        `SELECT n.night FROM reservation_nights n LEFT JOIN room_nights x ON x.reservation_id = n.reservation_id AND x.night = n.night
         WHERE n.reservation_id = ? AND x.room_id IS NULL AND n.night >= ? AND n.night < ? ORDER BY n.night`,
        id,
        from,
        to,
      )
      .map((n) => n.night);
    return { reservationId: id, ...present(r), nights: missing };
  });

  const avail = availability(db, propertyId, from, to);
  const occupancy = nights.map((night) => {
    let total = 0;
    let blocked = 0;
    let consumed = 0;
    for (const t of roomTypes) {
      const a = avail[t.id]?.[night];
      if (!a) continue;
      total += a.total;
      blocked += a.blocked;
      consumed += a.consumed;
    }
    return { night, total, blocked, sold: consumed, available: total - blocked - consumed, pct: total ? Math.round((consumed / total) * 1000) / 10 : null };
  });
  const overbooked = [];
  for (const t of roomTypes)
    for (const night of nights) {
      const a = avail[t.id]?.[night];
      if (a && a.available < 0) overbooked.push({ roomTypeId: t.id, night, by: -a.available });
    }
  return {
    property: { id: prop.id, code: prop.code, name: prop.name, currency: prop.currency, businessDate: prop.business_date, locale: prop.locale },
    from,
    to,
    nights,
    roomTypes: roomTypes.map((t) => ({
      ...t,
      availability: nights.map((n) => avail[t.id]?.[n] || { total: 0, blocked: 0, sellable: 0, consumed: 0, available: 0 }),
    })),
    rooms,
    segments,
    blocks,
    unassigned,
    occupancy,
    overbooked,
  };
}
