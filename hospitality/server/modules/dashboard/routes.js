// Dashboard: one call that assembles KPIs (with comparison), trend, revenue mix, channel and
// room-type breakdowns, today's operations and alerts for the user's scope and role.
import { perm, redactMoney } from '../../core/http.js';
import { propertyScope, inList } from '../../core/access.js';
import { can } from '../../core/permissions.js';
import { oneOf } from '../../core/validate.js';
import { addDays, addMonths, monthEnd, monthStart } from '../../core/dates.js';
import { breakdowns, computeKpis, series } from '../metrics/engine.js';
import { comparePeriod } from '../metrics/periods.js';
import { deltas, periodFor } from '../metrics/routes.js';
import { availability } from '../reservations/inventory.js';

const ROLE_VIEW = {
  owner: 'executive',
  ceo: 'executive',
  cfo: 'finance',
  finance: 'finance',
  gm: 'executive',
  revenue_manager: 'revenue',
  front_office_manager: 'operations',
  front_desk: 'operations',
  housekeeping_manager: 'housekeeping',
  housekeeping_attendant: 'housekeeping',
  fnb_manager: 'fnb',
  procurement_manager: 'procurement',
  banquet_manager: 'banquets',
  admin: 'operations',
};

function todayOps(db, pids) {
  return db.all(
    `SELECT p.id, p.code, p.name, p.business_date, p.currency,
       (SELECT COUNT(*) FROM reservations r WHERE r.property_id = p.id AND r.arrival = p.business_date AND r.status IN ('confirmed','in_house','checked_out','closed')) AS arrivals,
       (SELECT COUNT(*) FROM reservations r WHERE r.property_id = p.id AND r.arrival = p.business_date AND r.status IN ('in_house','checked_out','closed')) AS arrived,
       (SELECT COUNT(*) FROM reservations r WHERE r.property_id = p.id AND r.departure = p.business_date AND r.status IN ('in_house','checked_out','closed')) AS departures,
       (SELECT COUNT(*) FROM reservations r WHERE r.property_id = p.id AND r.departure = p.business_date AND r.status IN ('checked_out','closed')) AS departed,
       (SELECT COUNT(*) FROM reservations r WHERE r.property_id = p.id AND r.status = 'in_house') AS in_house,
       (SELECT COUNT(*) FROM rooms rm WHERE rm.property_id = p.id AND rm.commissioned_on <= p.business_date AND (rm.decommissioned_on IS NULL OR rm.decommissioned_on > p.business_date)) AS rooms,
       (SELECT COUNT(*) FROM reservation_nights n JOIN reservations r ON r.id = n.reservation_id WHERE n.property_id = p.id AND n.night = p.business_date AND r.status IN ('confirmed','in_house')) AS rooms_tonight,
       (SELECT COUNT(*) FROM room_nights x JOIN room_blocks b ON b.id = x.block_id WHERE x.property_id = p.id AND x.night = p.business_date AND b.kind = 'ooo') AS ooo,
       (SELECT COUNT(*) FROM rooms rm WHERE rm.property_id = p.id AND rm.hk_status IN ('dirty','cleaning')) AS dirty,
       (SELECT COUNT(*) FROM guest_requests q WHERE q.property_id = p.id AND q.status IN ('open','in_progress')) AS open_requests,
       (SELECT COUNT(*) FROM reservations r WHERE r.property_id = p.id AND r.arrival = p.business_date AND r.status = 'confirmed'
          AND NOT EXISTS (SELECT 1 FROM room_nights x WHERE x.reservation_id = r.id AND x.night = p.business_date)) AS unassigned_arrivals
     FROM properties p WHERE p.id IN ${inList(pids)} ORDER BY p.id`,
    ...pids,
  );
}

function alerts(db, pids, ops) {
  const out = [];
  for (const p of ops) {
    if (p.unassigned_arrivals) out.push({ level: 'warning', propertyId: p.id, text: `${p.code}: ${p.unassigned_arrivals} arrival(s) today without a room`, link: `/front-desk?property=${p.id}` });
    if (p.ooo) out.push({ level: 'info', propertyId: p.id, text: `${p.code}: ${p.ooo} room(s) out of order tonight`, link: `/rooms?property=${p.id}&code=OOO` });
    const avail = availability(db, p.id, p.business_date, addDays(p.business_date, 14));
    let over = 0;
    for (const t of Object.values(avail)) for (const c of Object.values(t)) if (c.available < 0) over++;
    if (over) out.push({ level: 'danger', propertyId: p.id, text: `${p.code}: overbooked on ${over} room-type night(s) in the next 14 days`, link: `/calendar?property=${p.id}` });
  }
  const failed = db.value(`SELECT COUNT(*) FROM night_audits WHERE property_id IN ${inList(pids)} AND status = 'failed' AND started_at > ?`, ...pids, new Date(Date.now() - 86400000).toISOString());
  if (failed) out.push({ level: 'danger', text: `${failed} night audit attempt(s) failed in the last 24 hours`, link: '/front-desk?tab=audit' });
  return out;
}

export default function dashboardRoutes(r, { db }) {
  r.get('/dashboard', perm('dashboard.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    const period = periodFor(db, req.user, pids, req.query);
    const cmpMode = req.query.compare ? oneOf(req.query.compare, ['previous', 'last_year', 'none']) : 'previous';
    const cmp = comparePeriod(period, cmpMode);
    const orgId = req.user.orgId;
    const current = computeKpis(db, { orgId, propertyIds: pids, from: period.from, to: period.to });
    const prior = cmp ? computeKpis(db, { orgId, propertyIds: pids, from: cmp.from, to: cmp.to }) : null;
    const trendFrom = monthStart(addMonths(period.to, -11));
    const trend = series(db, { orgId, propertyIds: pids, from: trendFrom, to: period.to, granularity: 'month' });
    const trendPrior = series(db, { orgId, propertyIds: pids, from: addMonths(trendFrom, -12), to: addMonths(period.to, -12), granularity: 'month' });
    // Twelve month slots; a month without records is null (a gap), never zero.
    const byBucket = (pts) => new Map(pts.map((p) => [p.bucket, p]));
    const cur = byBucket(trend.points);
    const pri = byBucket(trendPrior.points);
    const months = Array.from({ length: 12 }, (_, i) => addMonths(trendFrom, i).slice(0, 7));
    const slot = (m, p, lastDay) => (p?.nights ? { ...p, partial: p.nights < Number(lastDay.slice(8, 10)) } : null);
    const trendMonths = months.map((m, i) => ({
      bucket: m,
      current: slot(m, cur.get(m), i === 11 ? period.to : monthEnd(`${m}-01`)),
      prior: slot(m, pri.get(addMonths(`${m}-01`, -12).slice(0, 7)), i === 11 ? addMonths(period.to, -12) : monthEnd(addMonths(`${m}-01`, -12))),
      monthToDate: i === 11 && period.to < monthEnd(period.to),
    }));
    const daily = series(db, { orgId, propertyIds: pids, from: period.from, to: period.to, granularity: 'day' });
    const ops = todayOps(db, pids);
    const payload = {
      role: req.user.role,
      view: ROLE_VIEW[req.user.role] || 'operations',
      demo: Boolean(db.value('SELECT is_demo FROM organizations WHERE id = ?', orgId)),
      period,
      compare: cmp,
      reportingCurrency: current.reportingCurrency,
      fx: current.fx,
      provisional: current.provisional,
      kpis: current.consolidated.metrics,
      prior: prior?.consolidated.metrics ?? null,
      deltas: prior ? deltas(current.consolidated.metrics, prior.consolidated.metrics, current.coverage, prior.coverage) : null,
      properties: current.properties.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        currency: p.currency,
        businessDate: p.businessDate,
        metrics: p.metrics,
        reporting: p.reporting,
        prior: prior?.properties.find((x) => x.id === p.id)?.reporting ?? null,
        deltas: prior ? deltas(p.reporting, prior.properties.find((x) => x.id === p.id).reporting, p.coverage, prior.properties.find((x) => x.id === p.id).coverage) : null,
      })),
      coverage: current.coverage,
      priorCoverage: prior?.coverage ?? null,
      trend: trendMonths,
      daily: daily.points,
      breakdowns: can(req.user, 'dashboard.financial') ? breakdowns(db, { orgId, propertyIds: pids, from: period.from, to: period.to }) : null,
      today: ops,
      alerts: alerts(db, pids, ops),
      unavailable: [
        { metric: 'GOP / GOP margin / GOPPAR', reason: 'Needs departmental and undistributed expenses (Finance module, Phase 4)' },
        { metric: 'EBITDA / EBIT / Net profit', reason: 'Needs the full general ledger with expenses, depreciation and financing (Phase 4)' },
        { metric: 'OPEX / CAPEX / Budget variance', reason: 'Expense capture, asset register and budgets are Phase 4' },
        { metric: 'CPOR', reason: 'Needs rooms department expenses (Phase 4)' },
        { metric: 'MPI / RGI / ARI', reason: 'Needs licensed competitive-set data' },
      ],
    };
    res.json(redactMoney(payload, req.user));
  });
}
