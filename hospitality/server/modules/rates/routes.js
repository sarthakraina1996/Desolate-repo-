// Rate plans, rate grid (ARI), daily rates, restrictions, quotes and availability.
import { str, int, date, oneOf, bool, money } from '../../core/validate.js';
import { perm, propertyOf } from '../../core/http.js';
import { scopedRow } from '../../core/access.js';
import { fail } from '../../core/errors.js';
import { addDays } from '../../core/dates.js';
import { availability } from '../reservations/inventory.js';
import { checkRestrictions, listRatePlans, priceStay, rateGrid, saveRatePlan, setDailyRates, setRestrictions, RESTRICTION_TEXT } from './service.js';

function planInput(b, currency) {
  const out = {};
  for (const k of ['code', 'name', 'description']) if (b[k] !== undefined) out[k] = str(b[k], { max: k === 'description' ? 1000 : 80, name: k });
  if (b.meal_plan !== undefined) out.meal_plan = oneOf(b.meal_plan, ['RO', 'BB', 'HB', 'FB', 'AI'], { required: true, name: 'Meal plan' });
  if (b.parent_id !== undefined) out.parent_id = b.parent_id ? int(b.parent_id, { min: 1 }) : null;
  if (b.derive_kind !== undefined) out.derive_kind = oneOf(b.derive_kind, ['none', 'percent', 'amount'], { required: true });
  if (b.derive_value !== undefined) out.derive_value = int(b.derive_value, { min: -1_000_000_00, max: 1_000_000_00, name: 'Derivation' });
  if (b.cancellation_policy_id !== undefined) out.cancellation_policy_id = b.cancellation_policy_id ? int(b.cancellation_policy_id, { min: 1 }) : null;
  for (const k of ['is_public', 'commissionable', 'active']) if (b[k] !== undefined) out[k] = bool(b[k]) ? 1 : 0;
  if (b.min_los !== undefined) out.min_los = int(b.min_los, { min: 1, max: 365, name: 'Min LOS' });
  if (b.max_los !== undefined) out.max_los = b.max_los ? int(b.max_los, { min: 1, max: 365, name: 'Max LOS' }) : null;
  if (b.fnb_component !== undefined) out.fnb_component_minor = money(b.fnb_component, currency, { name: 'F&B component' }) ?? 0;
  if (Array.isArray(b.roomTypes))
    out.roomTypes = b.roomTypes.map((rt) => ({
      room_type_id: int(rt.room_type_id, { required: true, min: 1 }),
      base_minor: money(rt.base, currency, { required: true, name: 'Base rate' }),
      weekend_minor: money(rt.weekend, currency, { name: 'Weekend rate' }),
      extra_adult_minor: money(rt.extra_adult, currency) ?? 0,
      extra_child_minor: money(rt.extra_child, currency) ?? 0,
    }));
  return out;
}

const currencyOf = (db, pid) => db.value('SELECT currency FROM properties WHERE id = ?', pid);

export default function rateRoutes(r, { db }) {
  r.get('/rate-plans', perm('rates.view'), (req, res) => {
    const pid = propertyOf(db, req);
    res.json({ plans: listRatePlans(db, pid), policies: db.all('SELECT * FROM cancellation_policies WHERE property_id = ?', pid) });
  });
  r.post('/rate-plans', perm('rates.manage'), (req, res) => {
    const pid = propertyOf(db, req);
    res.status(201).json(saveRatePlan(db, req.user, pid, planInput(req.body || {}, currencyOf(db, pid))));
  });
  r.put('/rate-plans/:id', perm('rates.manage'), (req, res) => {
    const plan = scopedRow(db, req.user, 'rate_plans', int(req.params.id, { min: 1 }), 'Rate plan');
    res.json(saveRatePlan(db, req.user, plan.property_id, planInput(req.body || {}, currencyOf(db, plan.property_id)), plan.id));
  });

  r.get('/rates/grid', perm('rates.view'), (req, res) => {
    const pid = propertyOf(db, req);
    const from = date(req.query.from, { name: 'From' }) || db.value('SELECT business_date FROM properties WHERE id = ?', pid);
    const days = int(req.query.days, { min: 1, max: 62 }) || 14;
    res.json(rateGrid(db, pid, from, days, availability));
  });
  r.put('/rates/daily', perm('rates.manage'), (req, res) => {
    const pid = propertyOf(db, req);
    const b = req.body || {};
    res.json(
      setDailyRates(db, req.user, pid, {
        ratePlanId: int(b.ratePlanId, { required: true, min: 1, name: 'Rate plan' }),
        roomTypeId: int(b.roomTypeId, { required: true, min: 1, name: 'Room type' }),
        from: date(b.from, { required: true, name: 'From' }),
        to: date(b.to, { required: true, name: 'To' }),
        amountMinor: b.amount === null || b.amount === '' ? null : money(b.amount, currencyOf(db, pid), { required: true }),
        weekdays: Array.isArray(b.weekdays) ? b.weekdays.map((d) => int(d, { min: 0, max: 6 })) : null,
      }),
    );
  });
  r.put('/rates/restrictions', perm('rates.manage'), (req, res) => {
    const pid = propertyOf(db, req);
    const b = req.body || {};
    res.json(
      setRestrictions(db, req.user, pid, {
        roomTypeId: int(b.roomTypeId, { min: 0 }) || 0,
        ratePlanId: int(b.ratePlanId, { min: 0 }) || 0,
        from: date(b.from, { required: true, name: 'From' }),
        to: date(b.to, { required: true, name: 'To' }),
        values: {
          min_los: b.min_los ? int(b.min_los, { min: 1, max: 365 }) : null,
          max_los: b.max_los ? int(b.max_los, { min: 1, max: 365 }) : null,
          cta: bool(b.cta),
          ctd: bool(b.ctd),
          stop_sell: bool(b.stop_sell),
        },
      }),
    );
  });

  // Price and availability check for a prospective stay (used by the booking form).
  r.get('/rates/quote', perm('reservations.view'), (req, res) => {
    const pid = propertyOf(db, req);
    const q = req.query;
    const arrival = date(q.arrival, { required: true, name: 'Arrival' });
    const departure = date(q.departure, { required: true, name: 'Departure' });
    if (!(departure > arrival)) fail(400, 'Departure must be after arrival');
    const roomTypeId = int(q.roomTypeId, { required: true, min: 1 });
    const ratePlanId = int(q.ratePlanId, { required: true, min: 1 });
    const type = scopedRow(db, req.user, 'room_types', roomTypeId, 'Room type');
    const nights = priceStay(db, {
      propertyId: pid,
      ratePlanId,
      roomTypeId,
      arrival,
      departure,
      adults: int(q.adults, { min: 1, max: 20 }) || 1,
      children: int(q.children, { min: 0, max: 20 }) || 0,
      baseAdults: type.base_adults,
    });
    const avail = availability(db, pid, arrival, departure)[roomTypeId] || {};
    const restrictions = checkRestrictions(db, { propertyId: pid, roomTypeId, ratePlanId, arrival, departure });
    res.json({
      nights: nights.map((n) => ({ ...n, available: avail[n.night]?.available ?? 0 })),
      total_minor: nights.reduce((a, n) => a + n.rate_minor, 0),
      minAvailable: Math.min(...nights.map((n) => avail[n.night]?.available ?? 0)),
      restrictions: restrictions.map((v) => ({ ...v, text: RESTRICTION_TEXT[v.code](v) })),
    });
  });

  r.get('/availability', perm('reservations.view'), (req, res) => {
    const pid = propertyOf(db, req);
    const from = date(req.query.from, { required: true, name: 'From' });
    const to = date(req.query.to, { name: 'To' }) || addDays(from, 14);
    if (!(to > from)) fail(400, 'To must be after From');
    res.json(availability(db, pid, from, to));
  });
}
