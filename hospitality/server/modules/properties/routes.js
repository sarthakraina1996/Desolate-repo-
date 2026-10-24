// Property master, buildings and floors; the organisation and amenity catalogue.
import { notFound } from '../../core/errors.js';
import { str, int, date, oneOf } from '../../core/validate.js';
import { perm, propertyOf } from '../../core/http.js';
import { propertyIds, inList } from '../../core/access.js';
import { createBuilding, createFloor, createProperty, getProperty, propertySetup, updateProperty } from './service.js';

export default function propertyRoutes(r, { db }) {
  r.get('/org', (req, res) => {
    const org = db.get('SELECT id, name, reporting_currency, fy_start_month, is_demo, mfa_required_privileged FROM organizations WHERE id = ?', req.user.orgId);
    res.json({ ...org, departments: db.all('SELECT code, name, kind FROM departments WHERE org_id = ? ORDER BY sort', req.user.orgId) });
  });

  r.get('/amenities', (req, res) =>
    res.json(db.all('SELECT * FROM amenities WHERE org_id = ? ORDER BY category, name', req.user.orgId)),
  );

  r.get('/properties', perm('property.view'), (req, res) => {
    const ids = propertyIds(db, req.user);
    if (!ids.length) return res.json([]);
    res.json(
      db.all(
        `SELECT p.*, (SELECT COUNT(*) FROM rooms r WHERE r.property_id = p.id AND r.decommissioned_on IS NULL) AS room_count,
                (SELECT COUNT(*) FROM room_types t WHERE t.property_id = p.id) AS room_type_count,
                (SELECT COUNT(*) FROM buildings b WHERE b.property_id = p.id) AS building_count
         FROM properties p WHERE p.id IN ${inList(ids)} ORDER BY p.id`,
        ...ids,
      ),
    );
  });

  r.get('/properties/:propertyId', perm('property.view'), (req, res) => {
    const id = propertyOf(db, req);
    res.json({ property: getProperty(db, id), ...propertySetup(db, id) });
  });

  r.post('/properties', perm('property.manage'), (req, res) => {
    const b = req.body || {};
    const input = {
      code: str(b.code, { required: true, max: 8, name: 'Code' })?.toUpperCase(),
      name: str(b.name, { required: true, max: 120, name: 'Name' }),
      brand: str(b.brand, { max: 80 }),
      category: str(b.category, { max: 40 }),
      city: str(b.city, { max: 80 }),
      state: str(b.state, { max: 80 }),
      state_code: str(b.state_code, { max: 4 }),
      country: str(b.country, { required: true, max: 2, name: 'Country' })?.toUpperCase(),
      address: str(b.address, { max: 300 }),
      timezone: str(b.timezone, { required: true, max: 60, name: 'Time zone' }),
      currency: str(b.currency, { required: true, max: 3, name: 'Currency' })?.toUpperCase(),
      locale: str(b.locale, { max: 12 }) || 'en-IN',
      tax_regime: oneOf(b.tax_regime, ['IN_GST', 'EU_VAT', 'NONE'], { required: true, name: 'Tax regime' }),
      prices_include_tax: b.prices_include_tax ? 1 : 0,
      business_date: date(b.business_date, { required: true, name: 'Business date' }),
      invoice_prefix: str(b.invoice_prefix, { max: 6 }) || undefined,
    };
    res.status(201).json(createProperty(db, req.user, req.user.orgId, input, { specifiedPremises: Boolean(b.specified_premises) }));
  });

  r.put('/properties/:propertyId', perm('property.manage'), (req, res) => {
    const id = propertyOf(db, req);
    const b = req.body || {};
    const input = {};
    for (const k of ['name', 'brand', 'category', 'address', 'city', 'state', 'state_code', 'postal_code', 'phone', 'email', 'description', 'invoice_prefix'])
      if (b[k] !== undefined) input[k] = str(b[k], { max: 300, name: k });
    if (b.timezone !== undefined) input.timezone = str(b.timezone, { required: true, max: 60 });
    if (b.check_in_time !== undefined) input.check_in_time = str(b.check_in_time, { required: true, max: 5 });
    if (b.check_out_time !== undefined) input.check_out_time = str(b.check_out_time, { required: true, max: 5 });
    for (const k of ['inspection_required', 'require_id_at_checkin', 'exclude_ooo_from_available', 'prices_include_tax'])
      if (b[k] !== undefined) input[k] = b[k] ? 1 : 0;
    if (b.overbooking_pct !== undefined) input.overbooking_pct = int(b.overbooking_pct, { min: 0, max: 20, name: 'Overbooking %' });
    if (b.weekend_days !== undefined) input.weekend_days = (b.weekend_days || []).map((d) => int(d, { min: 0, max: 6 }));
    res.json(updateProperty(db, req.user, id, input));
  });

  r.post('/properties/:propertyId/buildings', perm('property.manage'), (req, res) => {
    const id = propertyOf(db, req);
    res.status(201).json(
      createBuilding(db, req.user, id, {
        code: str(req.body?.code, { required: true, max: 10, name: 'Code' }),
        name: str(req.body?.name, { required: true, max: 80, name: 'Name' }),
        description: str(req.body?.description, { max: 300 }),
        floors: (req.body?.floors || []).map((f) => ({ level: int(f.level, { required: true, min: -5, max: 200 }), name: str(f.name, { max: 40 }) })),
      }),
    );
  });

  r.post('/properties/:propertyId/floors', perm('property.manage'), (req, res) => {
    const id = propertyOf(db, req);
    const buildingId = int(req.body?.buildingId, { required: true, name: 'Building' });
    if (!db.value('SELECT 1 FROM buildings WHERE id = ? AND property_id = ?', buildingId, id)) notFound('Building');
    res.status(201).json(
      createFloor(db, req.user, id, { buildingId, level: int(req.body?.level, { required: true, min: -5, max: 200 }), name: str(req.body?.name, { max: 40 }) }),
    );
  });
}
