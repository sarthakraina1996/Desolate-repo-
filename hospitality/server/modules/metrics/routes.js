// Metrics API: definitions, KPIs with comparison, time series, breakdowns and drill-down.
import { fail } from '../../core/errors.js';
import { date, int, oneOf } from '../../core/validate.js';
import { perm, redactMoney } from '../../core/http.js';
import { propertyScope } from '../../core/access.js';
import { can } from '../../core/permissions.js';
import { METRICS, METRIC_IDS } from './definitions.js';
import { breakdowns, computeKpis, series } from './engine.js';
import { comparePeriod, PRESETS, resolvePeriod } from './periods.js';
import { drilldown } from './drilldown.js';
import { change } from './formulas.js';

// Period for the scope: presets resolve against the earliest business date in scope so every
// property's "yesterday" is a closed day.
export function periodFor(db, user, pids, q) {
  const bd = db.value(`SELECT MIN(business_date) FROM properties WHERE id IN (${pids.map(() => '?').join(',') || 'NULL'})`, ...pids);
  if (!bd) fail(404, 'No properties in scope');
  return resolvePeriod({
    preset: q.preset ? oneOf(q.preset, PRESETS, { name: 'Period' }) : 'mtd',
    from: date(q.from),
    to: date(q.to),
    businessDate: bd,
    fyStartMonth: user.fyStartMonth,
  });
}

const PERCENT = new Set(['occupancy_pct', 'occupancy_incl_comp_pct', 'cancellation_rate_pct', 'no_show_rate_pct', 'direct_pct']);
export function deltas(cur, prior) {
  const out = {};
  for (const [k, v] of Object.entries(cur)) if (typeof v === 'number' || v === null) out[k] = change(v, prior?.[k] ?? null, { isPercent: PERCENT.has(k) });
  return out;
}

export default function metricRoutes(r, { db }) {
  r.get('/metrics/definitions', (_req, res) => res.json(METRICS));

  r.get('/metrics/kpis', perm('dashboard.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    const period = periodFor(db, req.user, pids, req.query);
    const cmp = comparePeriod(period, req.query.compare || 'previous');
    const current = computeKpis(db, { orgId: req.user.orgId, propertyIds: pids, from: period.from, to: period.to });
    const prior = cmp ? computeKpis(db, { orgId: req.user.orgId, propertyIds: pids, from: cmp.from, to: cmp.to }) : null;
    res.json(
      redactMoney(
        {
          period,
          compare: cmp,
          ...current,
          prior: prior && {
            coverage: prior.coverage,
            consolidated: prior.consolidated.metrics,
            properties: prior.properties.map((p) => ({ id: p.id, coverage: p.coverage, metrics: p.metrics, reporting: p.reporting })),
          },
          deltas: prior ? deltas(current.consolidated.metrics, prior.consolidated.metrics) : null,
        },
        req.user,
      ),
    );
  });

  r.get('/metrics/series', perm('dashboard.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    const period = periodFor(db, req.user, pids, req.query);
    const granularity = req.query.granularity ? oneOf(req.query.granularity, ['day', 'week', 'month']) : 'day';
    res.json(redactMoney({ period, ...series(db, { orgId: req.user.orgId, propertyIds: pids, from: period.from, to: period.to, granularity }) }, req.user));
  });

  r.get('/metrics/breakdowns', perm('dashboard.financial'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    const period = periodFor(db, req.user, pids, req.query);
    res.json({ period, ...breakdowns(db, { orgId: req.user.orgId, propertyIds: pids, from: period.from, to: period.to }) });
  });

  r.get('/metrics/drilldown', perm('dashboard.view'), (req, res) => {
    const metric = String(req.query.metric || '');
    if (!METRIC_IDS.has(metric) && !['arrivals_cancelled', 'no_shows', 'stays_departed', 'arrivals_expected', 'rooms_other_revenue'].includes(metric))
      fail(400, 'Unknown metric');
    const money = !['sold_room_nights', 'occupancy_pct', 'direct_pct', 'arrivals_cancelled', 'cancellation_rate_pct', 'no_shows', 'no_show_rate_pct', 'stays_departed', 'alos', 'arrivals_expected'].includes(metric);
    if (money && !can(req.user, 'dashboard.financial')) fail(403, 'You do not have access to financial figures', { code: 'forbidden' });
    const pids = propertyScope(db, req.user, req.query.property);
    const period = periodFor(db, req.user, pids, req.query);
    res.json({
      period,
      ...drilldown(db, { metric, propertyIds: pids, from: period.from, to: period.to, limit: int(req.query.limit, { min: 1, max: 500 }), offset: int(req.query.offset, { min: 0 }) }),
    });
  });
}
