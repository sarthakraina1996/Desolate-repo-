// Rate plans, the nightly rate grid, derived plans and stay restrictions (MLOS, max LOS, CTA,
// CTD, stop sell). Prices follow the property's convention: tax-exclusive (India) or
// tax-inclusive (EU) — see properties.prices_include_tax.
import { fail, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { addDays, diffDays, dow, nights as nightsOf } from '../../core/dates.js';
import { bpOf } from '../../core/money.js';
import { json } from '../../db/connection.js';

export function listRatePlans(db, propertyId) {
  const plans = db.all(
    `SELECT p.*, cp.name AS cancellation_policy_name, pp.code AS parent_code
     FROM rate_plans p LEFT JOIN cancellation_policies cp ON cp.id = p.cancellation_policy_id
     LEFT JOIN rate_plans pp ON pp.id = p.parent_id
     WHERE p.property_id = ? ORDER BY p.sort, p.code`,
    propertyId,
  );
  const prices = db.all(
    `SELECT rprt.* FROM rate_plan_room_types rprt JOIN rate_plans p ON p.id = rprt.rate_plan_id WHERE p.property_id = ?`,
    propertyId,
  );
  return plans.map((p) => ({ ...p, roomTypes: prices.filter((x) => x.rate_plan_id === p.id) }));
}

export function saveRatePlan(db, actor, propertyId, input, id = null) {
  const FIELDS = [
    'code',
    'name',
    'description',
    'meal_plan',
    'parent_id',
    'derive_kind',
    'derive_value',
    'cancellation_policy_id',
    'is_public',
    'min_los',
    'max_los',
    'commissionable',
    'fnb_component_minor',
    'sort',
    'active',
  ];
  return db.tx(() => {
    const row = {};
    for (const f of FIELDS) if (input[f] !== undefined) row[f] = input[f];
    if (row.parent_id && !db.value('SELECT 1 FROM rate_plans WHERE id = ? AND property_id = ?', row.parent_id, propertyId))
      fail(400, 'Parent rate plan not found');
    if (row.parent_id && id && row.parent_id === id) fail(400, 'A rate plan cannot derive from itself');
    let planId = id;
    if (id) {
      if (!db.value('SELECT 1 FROM rate_plans WHERE id = ? AND property_id = ?', id, propertyId)) notFound('Rate plan');
      db.update('rate_plans', id, row);
    } else {
      if (!row.code || !row.name) fail(400, 'Rate plan code and name are required');
      planId = db.insert('rate_plans', { ...row, property_id: propertyId });
    }
    if (Array.isArray(input.roomTypes)) {
      db.run('DELETE FROM rate_plan_room_types WHERE rate_plan_id = ?', planId);
      for (const rt of input.roomTypes) {
        if (!db.value('SELECT 1 FROM room_types WHERE id = ? AND property_id = ?', rt.room_type_id, propertyId))
          fail(400, 'Room type not found');
        db.insert('rate_plan_room_types', {
          rate_plan_id: planId,
          room_type_id: rt.room_type_id,
          base_minor: rt.base_minor ?? 0,
          weekend_minor: rt.weekend_minor ?? null,
          extra_adult_minor: rt.extra_adult_minor ?? 0,
          extra_child_minor: rt.extra_child_minor ?? 0,
        });
      }
    }
    const after = db.get('SELECT * FROM rate_plans WHERE id = ?', planId);
    audit(db, actor, id ? 'rate_plan.update' : 'rate_plan.create', { entity: 'rate_plan', entityId: planId, propertyId, after });
    emit(db, { propertyId, entity: 'rate_plan', entityUid: after.uid, op: id ? 'update' : 'create', payload: after });
    return after;
  });
}

// Loads what rate resolution needs for one property once (plans, base prices, overrides in range).
export function rateContext(db, propertyId, from, to) {
  const prop = db.get('SELECT weekend_days FROM properties WHERE id = ?', propertyId);
  const plans = new Map(db.all('SELECT * FROM rate_plans WHERE property_id = ?', propertyId).map((p) => [p.id, p]));
  const base = new Map();
  for (const b of db.all(
    `SELECT rprt.* FROM rate_plan_room_types rprt JOIN rate_plans p ON p.id = rprt.rate_plan_id WHERE p.property_id = ?`,
    propertyId,
  ))
    base.set(`${b.rate_plan_id}:${b.room_type_id}`, b);
  const overrides = new Map();
  for (const d of db.all(
    `SELECT d.* FROM daily_rates d JOIN rate_plans p ON p.id = d.rate_plan_id
     WHERE p.property_id = ? AND d.night >= ? AND d.night < ?`,
    propertyId,
    from,
    to,
  ))
    overrides.set(`${d.rate_plan_id}:${d.room_type_id}:${d.night}`, d.amount_minor);
  return { plans, base, overrides, weekend: new Set(json(prop?.weekend_days, [5, 6])) };
}

// Rate for one plan, room type and night (base occupancy), or null when not sold.
// Precedence: explicit daily rate → derived from parent → base / weekend price.
export function rateFor(ctx, planId, roomTypeId, night, depth = 0) {
  const plan = ctx.plans.get(planId);
  if (!plan || depth > 5) return null;
  const override = ctx.overrides.get(`${planId}:${roomTypeId}:${night}`);
  if (override != null) return override;
  if (plan.parent_id && plan.derive_kind !== 'none') {
    const parent = rateFor(ctx, plan.parent_id, roomTypeId, night, depth + 1);
    if (parent == null) return null;
    const v = plan.derive_kind === 'percent' ? parent + bpOf(parent, plan.derive_value) : parent + plan.derive_value;
    return Math.max(0, v);
  }
  const b = ctx.base.get(`${planId}:${roomTypeId}`);
  if (!b) return null;
  return ctx.weekend.has(dow(night)) && b.weekend_minor != null ? b.weekend_minor : b.base_minor;
}

// Extra-person charges come from the plan (or its root parent) for the room type.
function extrasFor(ctx, planId, roomTypeId) {
  let plan = ctx.plans.get(planId);
  for (let i = 0; plan && i < 5; i++) {
    const b = ctx.base.get(`${plan.id}:${roomTypeId}`);
    if (b) return b;
    plan = ctx.plans.get(plan.parent_id);
  }
  return { extra_adult_minor: 0, extra_child_minor: 0 };
}

// Nightly prices for a stay: [{ night, rate_minor }]. Throws when a night has no rate.
export function priceStay(db, { propertyId, ratePlanId, roomTypeId, arrival, departure, adults = 1, children = 0, baseAdults = 2 }) {
  const ctx = rateContext(db, propertyId, arrival, departure);
  const extras = extrasFor(ctx, ratePlanId, roomTypeId);
  return nightsOf(arrival, departure).map((night) => {
    const rate = rateFor(ctx, ratePlanId, roomTypeId, night);
    if (rate == null) fail(409, `No rate is loaded for ${night}`, { code: 'no_rate', details: { night } });
    const extraAdults = Math.max(0, adults - baseAdults);
    return { night, rate_minor: rate + extraAdults * extras.extra_adult_minor + children * extras.extra_child_minor };
  });
}

// Restriction violations for a stay; empty when the stay may be sold.
export function checkRestrictions(db, { propertyId, roomTypeId, ratePlanId, arrival, departure }) {
  const los = diffDays(arrival, departure);
  const plan = ratePlanId ? db.get('SELECT min_los, max_los FROM rate_plans WHERE id = ?', ratePlanId) : null;
  const out = [];
  if (plan?.min_los && los < plan.min_los) out.push({ code: 'min_los', value: plan.min_los, night: arrival });
  if (plan?.max_los && los > plan.max_los) out.push({ code: 'max_los', value: plan.max_los, night: arrival });
  const rows = db.all(
    `SELECT * FROM restrictions WHERE property_id = ? AND room_type_id IN (0, ?) AND rate_plan_id IN (0, ?)
     AND night >= ? AND night <= ?`,
    propertyId,
    roomTypeId,
    ratePlanId || 0,
    arrival,
    departure,
  );
  for (const r of rows) {
    if (r.night === arrival && r.cta) out.push({ code: 'cta', night: r.night });
    if (r.night === departure && r.ctd) out.push({ code: 'ctd', night: r.night });
    if (r.night < departure && r.stop_sell) out.push({ code: 'stop_sell', night: r.night });
    if (r.night === arrival && r.min_los && los < r.min_los) out.push({ code: 'min_los', value: r.min_los, night: r.night });
    if (r.night === arrival && r.max_los && los > r.max_los) out.push({ code: 'max_los', value: r.max_los, night: r.night });
  }
  return out;
}

export const RESTRICTION_TEXT = {
  min_los: (v) => `Minimum stay of ${v.value} nights from ${v.night}`,
  max_los: (v) => `Maximum stay of ${v.value} nights from ${v.night}`,
  cta: (v) => `Closed to arrival on ${v.night}`,
  ctd: (v) => `Closed to departure on ${v.night}`,
  stop_sell: (v) => `Stop sell on ${v.night}`,
};

// Rate grid (ARI): rate plans × room types × nights with availability and restrictions.
export function rateGrid(db, propertyId, from, days, availabilityFn) {
  const to = addDays(from, days);
  const ctx = rateContext(db, propertyId, from, to);
  const nights = nightsOf(from, to);
  const types = db.all('SELECT id, code, name, color FROM room_types WHERE property_id = ? AND active = 1 ORDER BY sort, code', propertyId);
  const plans = [...ctx.plans.values()].filter((p) => p.active).sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
  const restrictions = db.all(
    'SELECT * FROM restrictions WHERE property_id = ? AND night >= ? AND night < ?',
    propertyId,
    from,
    to,
  );
  const avail = availabilityFn(db, propertyId, from, to);
  return {
    from,
    to,
    nights,
    roomTypes: types.map((t) => ({
      ...t,
      availability: nights.map((n) => avail[t.id]?.[n] ?? null),
      plans: plans
        .filter((p) => ctx.base.has(`${p.id}:${t.id}`) || p.parent_id)
        .map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          meal_plan: p.meal_plan,
          derived: Boolean(p.parent_id && p.derive_kind !== 'none'),
          rates: nights.map((n) => ({
            night: n,
            rate_minor: rateFor(ctx, p.id, t.id, n),
            override: ctx.overrides.has(`${p.id}:${t.id}:${n}`),
          })),
        }))
        .filter((p) => p.rates.some((r) => r.rate_minor != null)),
      restrictions: nights.map((n) =>
        restrictions.filter((r) => r.night === n && (r.room_type_id === 0 || r.room_type_id === t.id)),
      ),
    })),
  };
}

// Sets explicit rates for a plan and room type over a date range (optionally only some weekdays).
export function setDailyRates(db, actor, propertyId, { ratePlanId, roomTypeId, from, to, amountMinor, weekdays = null }) {
  const plan = db.get('SELECT * FROM rate_plans WHERE id = ? AND property_id = ?', ratePlanId, propertyId);
  if (!plan) notFound('Rate plan');
  if (plan.parent_id && plan.derive_kind !== 'none')
    fail(400, 'This plan is derived from another plan; change the parent rate instead');
  if (!db.value('SELECT 1 FROM room_types WHERE id = ? AND property_id = ?', roomTypeId, propertyId)) notFound('Room type');
  if (!(to > from) || diffDays(from, to) > 730) fail(400, 'Choose a range of up to two years');
  return db.tx(() => {
    let n = 0;
    for (const night of nightsOf(from, to)) {
      if (weekdays && !weekdays.includes(dow(night))) continue;
      if (amountMinor == null) {
        db.run('DELETE FROM daily_rates WHERE rate_plan_id = ? AND room_type_id = ? AND night = ?', ratePlanId, roomTypeId, night);
      } else {
        db.run(
          `INSERT INTO daily_rates (rate_plan_id, room_type_id, night, amount_minor, updated_by) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(rate_plan_id, room_type_id, night) DO UPDATE SET amount_minor = excluded.amount_minor,
             updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
          ratePlanId,
          roomTypeId,
          night,
          amountMinor,
          actor?.id ?? null,
        );
      }
      n++;
    }
    audit(db, actor, 'rates.set', {
      entity: 'rate_plan',
      entityId: ratePlanId,
      propertyId,
      after: { roomTypeId, from, to, amountMinor, weekdays, nights: n },
    });
    emit(db, { propertyId, entity: 'rates', op: 'set', payload: { ratePlanId, roomTypeId, from, to, amountMinor, weekdays } });
    return { nights: n };
  });
}

export function setRestrictions(db, actor, propertyId, { roomTypeId = 0, ratePlanId = 0, from, to, values }) {
  if (!(to > from) || diffDays(from, to) > 730) fail(400, 'Choose a range of up to two years');
  const v = {
    min_los: values.min_los ?? null,
    max_los: values.max_los ?? null,
    cta: values.cta ? 1 : 0,
    ctd: values.ctd ? 1 : 0,
    stop_sell: values.stop_sell ? 1 : 0,
  };
  return db.tx(() => {
    const clear = !v.min_los && !v.max_los && !v.cta && !v.ctd && !v.stop_sell;
    for (const night of nightsOf(from, to)) {
      if (clear)
        db.run(
          'DELETE FROM restrictions WHERE property_id = ? AND room_type_id = ? AND rate_plan_id = ? AND night = ?',
          propertyId,
          roomTypeId,
          ratePlanId,
          night,
        );
      else
        db.run(
          `INSERT INTO restrictions (property_id, room_type_id, rate_plan_id, night, min_los, max_los, cta, ctd, stop_sell)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(property_id, room_type_id, rate_plan_id, night) DO UPDATE SET min_los = excluded.min_los,
             max_los = excluded.max_los, cta = excluded.cta, ctd = excluded.ctd, stop_sell = excluded.stop_sell`,
          propertyId,
          roomTypeId,
          ratePlanId,
          night,
          v.min_los,
          v.max_los,
          v.cta,
          v.ctd,
          v.stop_sell,
        );
    }
    audit(db, actor, 'restrictions.set', { entity: 'restrictions', propertyId, after: { roomTypeId, ratePlanId, from, to, ...v } });
    emit(db, { propertyId, entity: 'restrictions', op: 'set', payload: { roomTypeId, ratePlanId, from, to, ...v } });
    return { ok: true };
  });
}
