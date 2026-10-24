// Drill-down: the source rows behind a metric. Sums of the rows equal the metric (tested).
import { fail } from '../../core/errors.js';
import { inList } from '../../core/access.js';

const REVENUE_FILTERS = {
  room_revenue: "fp.department = 'rooms' AND fp.category = 'room'",
  rooms_other_revenue: "fp.department = 'rooms' AND fp.category = 'fee'",
  fnb_revenue: "fp.department = 'fnb'",
  banquet_revenue: "fp.department = 'banquets'",
  spa_revenue: "fp.department = 'spa'",
  other_revenue: "fp.department IN ('other','misc')",
  total_operating_revenue: 'fp.department IS NOT NULL',
};

export function drilldown(db, { metric, propertyIds, from, to, limit = 50, offset = 0 }) {
  const ids = inList(propertyIds);
  const page = [Math.min(500, Math.max(1, Number(limit) || 50)), Math.max(0, Number(offset) || 0)];
  if (REVENUE_FILTERS[metric]) {
    const where = `fp.property_id IN ${ids} AND fp.business_date BETWEEN ? AND ? AND ${REVENUE_FILTERS[metric]} AND fp.net_minor <> 0`;
    const params = [...propertyIds, from, to];
    const totals = db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(fp.net_minor), 0) AS net FROM folio_postings fp WHERE ${where}`, ...params);
    const rows = db.all(
      `SELECT fp.id, fp.business_date, p.code AS property, fp.posting_no, f.folio_no, r.conf_no, fp.department, fp.charge_code,
              fp.description, fp.net_minor, fp.tax_minor, fp.currency, fp.kind,
              g.first_name || ' ' || g.last_name AS guest
       FROM folio_postings fp JOIN properties p ON p.id = fp.property_id JOIN folios f ON f.id = fp.folio_id
       LEFT JOIN reservations r ON r.id = fp.reservation_id LEFT JOIN guests g ON g.id = fp.guest_id
       WHERE ${where} ORDER BY fp.business_date DESC, fp.id DESC LIMIT ? OFFSET ?`,
      ...params,
      ...page,
    );
    return { metric, kind: 'postings', total: totals.n, sum_minor: totals.net, rows, note: 'Amounts are in each property’s currency.' };
  }
  if (['sold_room_nights', 'occupancy_pct', 'adr', 'direct_pct'].includes(metric)) {
    const where = `n.property_id IN ${ids} AND n.night BETWEEN ? AND ? AND r.is_complimentary = 0 AND r.is_house_use = 0
      AND (r.status IN ('checked_out','closed') OR (r.status = 'in_house' AND n.night <= p.business_date))`;
    const params = [...propertyIds, from, to];
    const total = db.value(
      `SELECT COUNT(*) FROM reservation_nights n JOIN reservations r ON r.id = n.reservation_id JOIN properties p ON p.id = n.property_id WHERE ${where}`,
      ...params,
    );
    const rows = db.all(
      `SELECT n.night, p.code AS property, r.id AS reservation_id, r.conf_no, g.first_name || ' ' || g.last_name AS guest,
              t.code AS room_type, rm.number AS room, n.rate_minor, r.currency, r.source, r.channel, r.status
       FROM reservation_nights n JOIN reservations r ON r.id = n.reservation_id JOIN properties p ON p.id = n.property_id
       JOIN guests g ON g.id = r.guest_id JOIN room_types t ON t.id = n.room_type_id
       LEFT JOIN room_nights x ON x.reservation_id = n.reservation_id AND x.night = n.night LEFT JOIN rooms rm ON rm.id = x.room_id
       WHERE ${where} ORDER BY n.night DESC, p.code, rm.number LIMIT ? OFFSET ?`,
      ...params,
      ...page,
    );
    return { metric, kind: 'room_nights', total, rows };
  }
  const STAY = {
    arrivals_cancelled: "r.arrival BETWEEN ? AND ? AND r.status = 'cancelled'",
    cancellation_rate_pct: "r.arrival BETWEEN ? AND ? AND r.status = 'cancelled'",
    no_shows: "r.arrival BETWEEN ? AND ? AND r.status = 'no_show'",
    no_show_rate_pct: "r.arrival BETWEEN ? AND ? AND r.status = 'no_show'",
    stays_departed: "r.departure BETWEEN ? AND ? AND r.status IN ('checked_out','closed')",
    alos: "r.departure BETWEEN ? AND ? AND r.status IN ('checked_out','closed')",
    arrivals_expected: "r.arrival BETWEEN ? AND ? AND r.status NOT IN ('quote','cancelled')",
  };
  if (STAY[metric]) {
    const where = `r.property_id IN ${ids} AND ${STAY[metric]}`;
    const params = [...propertyIds, from, to];
    const total = db.value(`SELECT COUNT(*) FROM reservations r WHERE ${where}`, ...params);
    const rows = db.all(
      `SELECT r.id AS reservation_id, r.conf_no, p.code AS property, g.first_name || ' ' || g.last_name AS guest, r.arrival,
              r.departure, julianday(r.departure) - julianday(r.arrival) AS nights, r.status, r.source, r.channel,
              r.cancel_reason, r.total_minor, r.currency
       FROM reservations r JOIN properties p ON p.id = r.property_id JOIN guests g ON g.id = r.guest_id
       WHERE ${where} ORDER BY r.arrival DESC LIMIT ? OFFSET ?`,
      ...params,
      ...page,
    );
    return { metric, kind: 'reservations', total, rows };
  }
  fail(400, `No drill-down for ${metric}`);
}
