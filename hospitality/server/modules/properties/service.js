// Organisations, legal entities, properties, buildings, floors, cost centres and the property's
// financial configuration (tax rules, charge codes, payment methods). Creating a property
// provisions its starting configuration from templates.js in one transaction.
import { fail, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { json } from '../../db/connection.js';
import {
  ACCOUNTS,
  AMENITIES,
  CHARGE_CODES,
  DEPARTMENTS,
  paymentMethodsFor,
  taxRulesFor,
} from './templates.js';

export function createOrganization(db, { name, reportingCurrency = 'INR', fyStartMonth = 4, isDemo = false }) {
  return db.tx(() => {
    const orgId = db.insert('organizations', {
      name,
      reporting_currency: reportingCurrency,
      fy_start_month: fyStartMonth,
      is_demo: isDemo ? 1 : 0,
    });
    DEPARTMENTS.forEach(([code, dname, kind], i) =>
      db.insert('departments', { org_id: orgId, code, name: dname, kind, sort: i }),
    );
    for (const [code, aname, type, usali, department] of ACCOUNTS)
      db.insert('accounts', { org_id: orgId, code, name: aname, type, usali_section: usali, department });
    for (const [code, aname, category, icon] of AMENITIES)
      db.insert('amenities', { org_id: orgId, code, name: aname, category, icon });
    return orgId;
  });
}

export const PROPERTY_FIELDS = [
  'code',
  'name',
  'brand',
  'category',
  'star_rating',
  'address',
  'city',
  'state',
  'state_code',
  'postal_code',
  'country',
  'phone',
  'email',
  'timezone',
  'currency',
  'locale',
  'tax_regime',
  'prices_include_tax',
  'check_in_time',
  'check_out_time',
  'business_date',
  'records_from',
  'inspection_required',
  'require_id_at_checkin',
  'overbooking_pct',
  'exclude_ooo_from_available',
  'invoice_prefix',
  'description',
  'opened_on',
  'legal_entity_id',
];

// Creates a property with its departments' cost centres, charge codes, payment methods and
// tax rules. `specifiedPremises` selects the 18 % GST restaurant rate for Indian hotels.
export function createProperty(db, actor, orgId, input, { specifiedPremises = false } = {}) {
  return db.tx(() => {
    const row = {};
    for (const f of PROPERTY_FIELDS) if (input[f] !== undefined) row[f] = input[f];
    if (!row.code || !row.name || !row.country || !row.timezone || !row.currency || !row.business_date)
      fail(400, 'Code, name, country, time zone, currency and business date are required');
    row.records_from ??= row.business_date;
    if (row.records_from > row.business_date) fail(400, 'Records cannot start after the business date');
    const id = db.insert('properties', { ...row, org_id: orgId });
    for (const [code, name] of DEPARTMENTS.filter((d) => d[2] !== 'non_operating'))
      db.insert('cost_centres', { property_id: id, code: `${row.code}-${code.toUpperCase()}`, name, department: code });
    for (const [code, name, department, category, taxCategory, account, sac, manual] of CHARGE_CODES)
      db.insert('charge_codes', {
        property_id: id,
        code,
        name,
        department,
        category,
        tax_category: taxCategory,
        account_code: account,
        hsn_sac: row.tax_regime === 'IN_GST' ? sac : null,
        manual,
      });
    for (const [code, name, kind, account] of paymentMethodsFor(row.country))
      db.insert('payment_methods', { property_id: id, code, name, kind, account_code: account });
    for (const t of taxRulesFor(row.tax_regime || 'IN_GST', { specifiedPremises }))
      db.insert('tax_rules', {
        property_id: id,
        category: t.category,
        name: t.name,
        rate_bp: t.rate_bp,
        slab_min_minor: t.slab_min_minor ?? null,
        slab_max_minor: t.slab_max_minor ?? null,
        components: t.components,
        effective_from: t.effective_from,
        effective_to: t.effective_to ?? null,
        note: t.note ?? null,
      });
    const policy = db.insert('cancellation_policies', {
      property_id: id,
      code: 'FLEX24',
      name: 'Free cancellation until 24 hours before arrival',
      free_cancel_hours: 24,
      penalty_kind: 'first_night',
      no_show_kind: 'first_night',
    });
    db.insert('cancellation_policies', {
      property_id: id,
      code: 'NONREF',
      name: 'Non-refundable',
      free_cancel_hours: 0,
      penalty_kind: 'full_stay',
      no_show_kind: 'full_stay',
      non_refundable: 1,
    });
    db.run('UPDATE properties SET default_cancellation_policy_id = ? WHERE id = ?', policy, id);
    const created = getProperty(db, id);
    audit(db, actor, 'property.create', { entity: 'property', entityId: id, propertyId: id, after: created });
    emit(db, { propertyId: id, entity: 'property', entityUid: created.uid, op: 'create', payload: created });
    return created;
  });
}

export function getProperty(db, id) {
  const p = db.get('SELECT * FROM properties WHERE id = ?', id);
  if (!p) notFound('Property');
  p.weekend_days = json(p.weekend_days, [5, 6]);
  return p;
}

const EDITABLE = PROPERTY_FIELDS.filter((f) => !['code', 'business_date', 'records_from', 'currency', 'tax_regime'].includes(f));

// Updates property settings. Currency, tax regime and business date are not editable here:
// changing them would re-interpret posted transactions (business date moves only by night audit).
export function updateProperty(db, actor, id, input) {
  return db.tx(() => {
    const before = getProperty(db, id);
    const row = {};
    for (const f of EDITABLE) if (input[f] !== undefined) row[f] = input[f];
    if (input.weekend_days !== undefined) row.weekend_days = JSON.stringify(input.weekend_days);
    db.update('properties', id, row);
    const after = getProperty(db, id);
    audit(db, actor, 'property.update', { entity: 'property', entityId: id, propertyId: id, before, after });
    emit(db, { propertyId: id, entity: 'property', entityUid: after.uid, op: 'update', payload: row });
    return after;
  });
}

export function propertySetup(db, propertyId) {
  return {
    buildings: db.all('SELECT * FROM buildings WHERE property_id = ? ORDER BY sort, code', propertyId),
    floors: db.all(
      'SELECT f.*, b.code AS building_code FROM floors f JOIN buildings b ON b.id = f.building_id WHERE f.property_id = ? ORDER BY b.sort, f.level',
      propertyId,
    ),
    costCentres: db.all('SELECT * FROM cost_centres WHERE property_id = ? ORDER BY code', propertyId),
    chargeCodes: db.all('SELECT * FROM charge_codes WHERE property_id = ? AND active = 1 ORDER BY department, code', propertyId),
    paymentMethods: db.all('SELECT * FROM payment_methods WHERE property_id = ? AND active = 1 ORDER BY id', propertyId),
    bankAccounts: db.all('SELECT * FROM bank_accounts WHERE property_id = ? AND active = 1', propertyId),
    taxRules: db
      .all('SELECT * FROM tax_rules WHERE property_id = ? ORDER BY category, effective_from, slab_min_minor', propertyId)
      .map((t) => ({ ...t, components: json(t.components, []) })),
    cancellationPolicies: db.all('SELECT * FROM cancellation_policies WHERE property_id = ? ORDER BY id', propertyId),
  };
}

export function createBuilding(db, actor, propertyId, { code, name, description, floors = [] }) {
  return db.tx(() => {
    const id = db.insert('buildings', { property_id: propertyId, code, name, description: description ?? null });
    for (const f of floors)
      db.insert('floors', { property_id: propertyId, building_id: id, level: f.level, name: f.name || `Floor ${f.level}` });
    audit(db, actor, 'building.create', { entity: 'building', entityId: id, propertyId, after: { code, name } });
    return db.get('SELECT * FROM buildings WHERE id = ?', id);
  });
}

export function createFloor(db, actor, propertyId, { buildingId, level, name }) {
  const b = db.get('SELECT * FROM buildings WHERE id = ? AND property_id = ?', buildingId, propertyId);
  if (!b) notFound('Building');
  const id = db.insert('floors', { property_id: propertyId, building_id: buildingId, level, name: name || `Floor ${level}` });
  audit(db, actor, 'floor.create', { entity: 'floor', entityId: id, propertyId, after: { buildingId, level } });
  return db.get('SELECT * FROM floors WHERE id = ?', id);
}
