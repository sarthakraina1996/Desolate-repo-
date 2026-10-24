// Metrics engine: aggregates base measures from source rows (rooms, room locks, reservation
// nights, folio postings), converts to the reporting currency per month, then applies the
// formulas. Ratios are always computed from summed numerators and denominators (weighted).
import { fail } from '../../core/errors.js';
import { addDays, diffDays, monthEnd } from '../../core/dates.js';
import { convert } from '../../core/money.js';
import { inList } from '../../core/access.js';
import { DIRECT_SOURCES } from '../reservations/service.js';
import { computeTax, rulesFor } from '../folios/tax.js';
import * as F from './formulas.js';

const REVENUE_KEYS = ['room_revenue', 'rooms_other_revenue', 'fnb_revenue', 'banquet_revenue', 'spa_revenue', 'other_revenue', 'misc_revenue'];
const MONEY_KEYS = [...REVENUE_KEYS, 'total_operating_revenue', 'commission_cost', 'provisional_room_revenue'];
const DEPT_KEY = { fnb: 'fnb_revenue', banquets: 'banquet_revenue', spa: 'spa_revenue', other: 'other_revenue', misc: 'misc_revenue' };

const emptyFacts = () => ({
  room_inventory_nights: 0,
  ooo_room_nights: 0,
  oos_room_nights: 0,
  sold_room_nights: 0,
  comp_room_nights: 0,
  house_use_room_nights: 0,
  direct_room_nights: 0,
  otb_room_nights: 0,
  room_revenue: 0,
  rooms_other_revenue: 0,
  fnb_revenue: 0,
  banquet_revenue: 0,
  spa_revenue: 0,
  other_revenue: 0,
  misc_revenue: 0,
  commission_cost: 0,
  provisional_room_revenue: 0,
});

// Exchange rate (×1e6) on or before `date`; identical currencies are 1.
export function fxRate(db, fromCcy, toCcy, date, cache = new Map()) {
  if (fromCcy === toCcy) return 1_000_000;
  const key = `${fromCcy}|${toCcy}|${date.slice(0, 7)}`;
  if (cache.has(key)) return cache.get(key);
  const r = db.value(
    'SELECT rate_micros FROM fx_rates WHERE from_currency = ? AND to_currency = ? AND rate_date <= ? ORDER BY rate_date DESC LIMIT 1',
    fromCcy,
    toCcy,
    monthEnd(date),
  );
  if (!r) fail(409, `No ${fromCcy}→${toCcy} exchange rate is loaded for ${date}`, { code: 'missing_fx' });
  cache.set(key, r);
  return r;
}

// Per property, per night facts for [from, to] inclusive.
export function dailyFacts(db, propertyIds, from, to) {
  const out = new Map();
  if (!propertyIds.length) return out;
  const props = db.all(
    `SELECT id, business_date, records_from, currency, prices_include_tax, exclude_ooo_from_available FROM properties WHERE id IN ${inList(propertyIds)}`,
    ...propertyIds,
  );
  const cell = (pid, night) => {
    let m = out.get(pid);
    if (!m) out.set(pid, (m = new Map()));
    let c = m.get(night);
    if (!c) m.set(night, (c = emptyFacts()));
    return c;
  };
  const end = addDays(to, 1);
  const ids = inList(propertyIds);
  for (const r of db.all(
    `WITH RECURSIVE d(night) AS (SELECT ? UNION ALL SELECT date(night, '+1 day') FROM d WHERE date(night, '+1 day') < ?)
     SELECT r.property_id AS pid, d.night, COUNT(*) AS n FROM d JOIN rooms r
       ON r.commissioned_on <= d.night AND (r.decommissioned_on IS NULL OR r.decommissioned_on > d.night)
     JOIN properties p ON p.id = r.property_id AND d.night >= p.records_from
     WHERE r.property_id IN ${ids} GROUP BY 1, 2`,
    from,
    end,
    ...propertyIds,
  ))
    cell(r.pid, r.night).room_inventory_nights = r.n;
  for (const r of db.all(
    `SELECT rn.property_id AS pid, rn.night, b.kind, COUNT(*) AS n FROM room_nights rn JOIN room_blocks b ON b.id = rn.block_id
     WHERE rn.property_id IN ${ids} AND rn.night >= ? AND rn.night <= ? GROUP BY 1, 2, 3`,
    ...propertyIds,
    from,
    to,
  ))
    cell(r.pid, r.night)[r.kind === 'ooo' ? 'ooo_room_nights' : 'oos_room_nights'] = r.n;
  // Stayed nights: checked-out/closed stays, and in-house stays up to tonight.
  for (const r of db.all(
    `SELECT n.property_id AS pid, n.night,
            SUM(CASE WHEN r.is_complimentary = 0 AND r.is_house_use = 0 THEN 1 ELSE 0 END) AS sold,
            SUM(CASE WHEN r.is_complimentary = 1 AND r.is_house_use = 0 THEN 1 ELSE 0 END) AS comp,
            SUM(r.is_house_use) AS house,
            SUM(CASE WHEN r.is_complimentary = 0 AND r.is_house_use = 0 AND r.source IN ${inList(DIRECT_SOURCES)} THEN 1 ELSE 0 END) AS direct
     FROM reservation_nights n JOIN reservations r ON r.id = n.reservation_id JOIN properties p ON p.id = n.property_id
     WHERE n.property_id IN ${ids} AND n.night >= ? AND n.night <= ?
       AND (r.status IN ('checked_out','closed') OR (r.status = 'in_house' AND n.night <= p.business_date))
     GROUP BY 1, 2`,
    ...DIRECT_SOURCES,
    ...propertyIds,
    from,
    to,
  )) {
    const c = cell(r.pid, r.night);
    c.sold_room_nights = r.sold;
    c.comp_room_nights = r.comp;
    c.house_use_room_nights = r.house;
    c.direct_room_nights = r.direct;
  }
  // On the books: future nights (from the open business date) of confirmed/in-house stays.
  for (const r of db.all(
    `SELECT n.property_id AS pid, n.night, COUNT(*) AS n FROM reservation_nights n JOIN reservations r ON r.id = n.reservation_id
     JOIN properties p ON p.id = n.property_id
     WHERE n.property_id IN ${ids} AND n.night >= ? AND n.night <= ? AND n.night >= p.business_date
       AND r.status IN ('confirmed','in_house') AND r.is_house_use = 0
     GROUP BY 1, 2`,
    ...propertyIds,
    from,
    to,
  ))
    cell(r.pid, r.night).otb_room_nights = r.n;
  // Posted net revenue by business date and department.
  for (const r of db.all(
    `SELECT property_id AS pid, business_date AS night, department, category, SUM(net_minor) AS net
     FROM folio_postings WHERE property_id IN ${ids} AND business_date >= ? AND business_date <= ? AND department IS NOT NULL
     GROUP BY 1, 2, 3, 4`,
    ...propertyIds,
    from,
    to,
  )) {
    const c = cell(r.pid, r.night);
    if (r.department === 'rooms') c[r.category === 'fee' ? 'rooms_other_revenue' : 'room_revenue'] += r.net;
    else c[DEPT_KEY[r.department] || 'other_revenue'] += r.net;
  }
  // Commission (estimated): posted room revenue × the reservation's commission rate.
  for (const r of db.all(
    `SELECT p.property_id AS pid, p.business_date AS night, SUM(p.net_minor * r.commission_bp) AS c
     FROM folio_postings p JOIN reservations r ON r.id = p.reservation_id
     WHERE p.property_id IN ${ids} AND p.business_date >= ? AND p.business_date <= ? AND p.department = 'rooms'
       AND p.category = 'room' AND r.commission_bp > 0 GROUP BY 1, 2`,
    ...propertyIds,
    from,
    to,
  ))
    cell(r.pid, r.night).commission_cost += Math.round(r.c / 10000);
  // Open business day: room revenue not yet posted by the night audit, estimated from rates.
  for (const p of props) {
    if (p.business_date < from || p.business_date > to) continue;
    const rows = db.all(
      `SELECT n.rate_minor, r.adults, COALESCE(rp.fnb_component_minor, 0) AS fnb FROM reservation_nights n
       JOIN reservations r ON r.id = n.reservation_id LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id
       WHERE n.property_id = ? AND n.night = ? AND r.status = 'in_house' AND r.is_complimentary = 0 AND r.is_house_use = 0
       AND NOT EXISTS (SELECT 1 FROM folio_postings x WHERE x.dedupe_key = 'room:' || r.id || ':' || n.night)`,
      p.id,
      p.business_date,
    );
    const rules = rulesFor(db, p.id, 'room', p.business_date);
    let est = 0;
    for (const r of rows) {
      const unit = r.rate_minor - Math.min(r.rate_minor, r.fnb * r.adults);
      est += p.prices_include_tax ? computeTax(rules, { amountMinor: unit, unitMinor: unit, inclusive: true }).net : unit;
    }
    cell(p.id, p.business_date).provisional_room_revenue = est;
  }
  // Available rooms per property policy.
  const policy = new Map(props.map((p) => [p.id, p.exclude_ooo_from_available]));
  for (const [pid, m] of out)
    for (const c of m.values()) c.available_room_nights = c.room_inventory_nights - (policy.get(pid) ? c.ooo_room_nights : 0);
  return out;
}

// Stay-level counts (arrivals, cancellations, no-shows, departed stays) per property.
function stayCounts(db, propertyIds, from, to) {
  const ids = inList(propertyIds);
  const rows = db.all(
    `SELECT property_id AS pid,
       SUM(CASE WHEN arrival BETWEEN ? AND ? AND status NOT IN ('quote','cancelled') THEN 1 ELSE 0 END) AS arrivals_expected,
       SUM(CASE WHEN arrival BETWEEN ? AND ? AND status = 'cancelled' THEN 1 ELSE 0 END) AS arrivals_cancelled,
       SUM(CASE WHEN arrival BETWEEN ? AND ? AND status = 'no_show' THEN 1 ELSE 0 END) AS no_shows,
       SUM(CASE WHEN departure BETWEEN ? AND ? AND status IN ('checked_out','closed') THEN 1 ELSE 0 END) AS stays_departed,
       SUM(CASE WHEN departure BETWEEN ? AND ? AND status IN ('checked_out','closed')
                THEN julianday(departure) - julianday(arrival) ELSE 0 END) AS stay_nights_departed
     FROM reservations WHERE property_id IN ${ids} GROUP BY property_id`,
    from,
    to,
    from,
    to,
    from,
    to,
    from,
    to,
    from,
    to,
    ...propertyIds,
  );
  return new Map(rows.map((r) => [r.pid, r]));
}

const STAY_KEYS = ['arrivals_expected', 'arrivals_cancelled', 'no_shows', 'stays_departed', 'stay_nights_departed'];

function sumFacts(list) {
  const t = { ...emptyFacts(), available_room_nights: 0 };
  for (const c of list) for (const k of Object.keys(t)) t[k] += c[k] || 0;
  return t;
}

// KPIs from base measures (FINANCIAL_METRICS.md §3.1–3.2).
export function deriveMetrics(m, { includeProvisional = true } = {}) {
  const roomRevenue = m.room_revenue + (includeProvisional ? m.provisional_room_revenue : 0);
  const total = REVENUE_KEYS.reduce((a, k) => a + m[k], 0) + (includeProvisional ? m.provisional_room_revenue : 0);
  return {
    available_room_nights: m.available_room_nights,
    sold_room_nights: m.sold_room_nights,
    occupied_room_nights: m.sold_room_nights + m.comp_room_nights,
    comp_room_nights: m.comp_room_nights,
    house_use_room_nights: m.house_use_room_nights,
    ooo_room_nights: m.ooo_room_nights,
    otb_room_nights: m.otb_room_nights,
    occupancy_pct: F.occupancyPct(m.sold_room_nights, m.available_room_nights),
    occupancy_incl_comp_pct: F.occupancyPct(m.sold_room_nights + m.comp_room_nights, m.available_room_nights),
    adr: F.adr(roomRevenue, m.sold_room_nights),
    revpar: F.revpar(roomRevenue, m.available_room_nights),
    trevpar: F.trevpar(total, m.available_room_nights),
    alos: m.stays_departed != null ? F.alos(m.stay_nights_departed, m.stays_departed) : null,
    cancellation_rate_pct: m.arrivals_expected != null ? F.cancellationRatePct(m.arrivals_cancelled, m.arrivals_expected) : null,
    no_show_rate_pct: m.arrivals_expected != null ? F.noShowRatePct(m.no_shows, m.arrivals_expected) : null,
    direct_pct: F.directPct(m.direct_room_nights, m.sold_room_nights),
    room_revenue: roomRevenue,
    rooms_other_revenue: m.rooms_other_revenue,
    fnb_revenue: m.fnb_revenue,
    banquet_revenue: m.banquet_revenue,
    spa_revenue: m.spa_revenue,
    other_revenue: m.other_revenue + m.misc_revenue,
    total_operating_revenue: total,
    commission_cost: m.commission_cost,
    net_room_revenue: roomRevenue - m.commission_cost,
    provisional_room_revenue: includeProvisional ? m.provisional_room_revenue : 0,
    arrivals_expected: m.arrivals_expected ?? null,
    arrivals_cancelled: m.arrivals_cancelled ?? null,
    no_shows: m.no_shows ?? null,
    stays_departed: m.stays_departed ?? null,
  };
}

// Converts a property's money facts to the reporting currency night by night (monthly rate).
function convertFacts(db, nightsMap, fromCcy, toCcy, cache, fxUsed) {
  const out = [];
  for (const [night, c] of nightsMap) {
    // Nights with no money need no rate (rates may not exist before trading started).
    if (!MONEY_KEYS.some((k) => c[k])) {
      out.push({ ...c });
      continue;
    }
    const rate = fxRate(db, fromCcy, toCcy, night, cache);
    if (fromCcy !== toCcy) fxUsed.set(`${fromCcy}→${toCcy} ${night.slice(0, 7)}`, rate);
    const x = { ...c };
    for (const k of MONEY_KEYS) if (k in x) x[k] = convert(c[k], rate, fromCcy, toCcy);
    out.push(x);
  }
  return out;
}

// Full KPI result for a scope and period, per property and consolidated.
export function computeKpis(db, { orgId, propertyIds, from, to }) {
  const org = db.get('SELECT reporting_currency FROM organizations WHERE id = ?', orgId);
  const props = db.all(
    `SELECT id, code, name, currency, business_date, records_from, exclude_ooo_from_available FROM properties WHERE id IN ${inList(propertyIds)} ORDER BY id`,
    ...propertyIds,
  );
  const facts = dailyFacts(db, propertyIds, from, to);
  const stays = stayCounts(db, propertyIds, from, to);
  const cache = new Map();
  const fxUsed = new Map();
  const perProperty = [];
  const consolidatedParts = [];
  for (const p of props) {
    const nightsMap = facts.get(p.id) || new Map();
    const local = sumFacts([...nightsMap.values()]);
    const s = stays.get(p.id) || {};
    for (const k of STAY_KEYS) local[k] = s[k] || 0;
    const converted = sumFacts(convertFacts(db, nightsMap, p.currency, org.reporting_currency, cache, fxUsed));
    for (const k of STAY_KEYS) converted[k] = s[k] || 0;
    const coverage = coverageOf(p, from, to);
    if (coverage) consolidatedParts.push(converted);
    perProperty.push({
      id: p.id,
      code: p.code,
      name: p.name,
      currency: p.currency,
      businessDate: p.business_date,
      recordsFrom: p.records_from,
      oooPolicy: p.exclude_ooo_from_available ? 'excluded' : 'included',
      coverage,
      measures: local,
      metrics: coverage ? deriveMetrics(local) : noData(deriveMetrics(local)),
      reporting: coverage ? deriveMetrics(converted) : noData(deriveMetrics(converted)),
    });
  }
  const consolidated = sumFacts(consolidatedParts);
  for (const k of STAY_KEYS) consolidated[k] = consolidatedParts.reduce((a, c) => a + (c[k] || 0), 0);
  const covered = perProperty.filter((p) => p.coverage);
  const coverage = covered.length
    ? {
        from: covered.reduce((a, p) => (p.coverage.from < a ? p.coverage.from : a), to),
        to,
        partial: covered.length < perProperty.length || covered.some((p) => p.coverage.partial),
        days: covered.reduce((a, p) => a + p.coverage.days, 0), // property-days with records
      }
    : null;
  return {
    from,
    to,
    reportingCurrency: org.reporting_currency,
    fx: [...fxUsed.entries()].map(([k, rate]) => ({ pair: k, rate: rate / 1e6 })),
    provisional: props.some((p) => p.business_date >= from && p.business_date <= to),
    coverage,
    consolidated: { measures: consolidated, metrics: coverage ? deriveMetrics(consolidated) : noData(deriveMetrics(consolidated)) },
    properties: perProperty,
  };
}

// Part of [from, to] for which the property has records (null when none): days before
// records_from are unknown, not zero, so they are left out of every measure.
function coverageOf(p, from, to) {
  const start = p.records_from > from ? p.records_from : from;
  if (start > to) return null;
  return { from: start, to, partial: start > from, days: diffDays(start, to) + 1 };
}

const noData = (m) => Object.fromEntries(Object.keys(m).map((k) => [k, null]));

const bucketOf = (night, granularity) => (granularity === 'month' ? night.slice(0, 7) : granularity === 'week' ? weekOf(night) : night);
function weekOf(night) {
  const d = new Date(`${night}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday start
  return addDays(night, -day);
}

// Time series in the reporting currency: revenue by department, rooms sold and occupancy.
export function series(db, { orgId, propertyIds, from, to, granularity = 'day' }) {
  const org = db.get('SELECT reporting_currency FROM organizations WHERE id = ?', orgId);
  const props = db.all(`SELECT id, currency FROM properties WHERE id IN ${inList(propertyIds)}`, ...propertyIds);
  const facts = dailyFacts(db, propertyIds, from, to);
  const cache = new Map();
  const buckets = new Map();
  for (const p of props) {
    const m = facts.get(p.id) || new Map();
    for (const [night, c] of m) {
      const hasMoney = MONEY_KEYS.some((k) => c[k]);
      const rate = hasMoney ? fxRate(db, p.currency, org.reporting_currency, night, cache) : 1_000_000;
      const key = bucketOf(night, granularity);
      const b = buckets.get(key) || { ...emptyFacts(), available_room_nights: 0, nights: new Set() };
      for (const k of Object.keys(b)) if (k !== 'nights') b[k] += MONEY_KEYS.includes(k) ? convert(c[k] || 0, rate, p.currency, org.reporting_currency) : c[k] || 0;
      if (c.room_inventory_nights) b.nights.add(night);
      buckets.set(key, b);
    }
  }
  return {
    reportingCurrency: org.reporting_currency,
    granularity,
    points: [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, b]) => {
        const m = deriveMetrics(b);
        return {
          bucket,
          nights: b.nights.size, // distinct dates with records in this bucket
          room_revenue: m.room_revenue,
          fnb_revenue: m.fnb_revenue,
          banquet_revenue: m.banquet_revenue,
          spa_revenue: m.spa_revenue,
          other_revenue: m.other_revenue + m.rooms_other_revenue,
          total_operating_revenue: m.total_operating_revenue,
          sold_room_nights: m.sold_room_nights,
          available_room_nights: m.available_room_nights,
          occupancy_pct: m.occupancy_pct,
          adr: m.adr,
          revpar: m.revpar,
        };
      }),
  };
}

// Room revenue and nights by booking source and by room type, in the reporting currency.
export function breakdowns(db, { orgId, propertyIds, from, to }) {
  const org = db.get('SELECT reporting_currency FROM organizations WHERE id = ?', orgId);
  const ids = inList(propertyIds);
  const cache = new Map();
  const conv = (rows) =>
    rows.map((r) => ({ ...r, revenue: convert(r.revenue, fxRate(db, r.currency, org.reporting_currency, `${r.month}-01`, cache), r.currency, org.reporting_currency) }));
  const fold = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[key];
      const x = m.get(k) || { [key]: k, revenue: 0, nights: 0, commission: 0 };
      x.revenue += r.revenue;
      x.nights += r.nights || 0;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  };
  const bySource = conv(
    db.all(
      `SELECT COALESCE(r.channel, r.source) AS source, p.currency, substr(fp.business_date, 1, 7) AS month,
              SUM(fp.net_minor) AS revenue, SUM(CASE WHEN fp.kind = 'charge' THEN 1 WHEN fp.kind = 'reversal' THEN -1 ELSE 0 END) AS nights
       FROM folio_postings fp JOIN reservations r ON r.id = fp.reservation_id JOIN properties p ON p.id = fp.property_id
       WHERE fp.property_id IN ${ids} AND fp.business_date BETWEEN ? AND ? AND fp.department = 'rooms' AND fp.category = 'room'
         AND fp.charge_code = 'ROOM'
       GROUP BY 1, 2, 3`,
      ...propertyIds,
      from,
      to,
    ),
  );
  const byRoomType = conv(
    db.all(
      `SELECT t.name AS room_type, p.currency, substr(fp.business_date, 1, 7) AS month,
              SUM(fp.net_minor) AS revenue, SUM(CASE WHEN fp.kind = 'charge' THEN 1 WHEN fp.kind = 'reversal' THEN -1 ELSE 0 END) AS nights
       FROM folio_postings fp JOIN reservations r ON r.id = fp.reservation_id JOIN room_types t ON t.id = r.room_type_id
       JOIN properties p ON p.id = fp.property_id
       WHERE fp.property_id IN ${ids} AND fp.business_date BETWEEN ? AND ? AND fp.department = 'rooms' AND fp.category = 'room'
         AND fp.charge_code = 'ROOM'
       GROUP BY 1, 2, 3`,
      ...propertyIds,
      from,
      to,
    ),
  );
  return {
    reportingCurrency: org.reporting_currency,
    bySource: fold(bySource, 'source'),
    byRoomType: fold(byRoomType, 'room_type'),
  };
}
