// The organiser console: event configuration, registrations, exhibitors, floor plan, agenda,
// finance, live operations, communications, staff, reports and the audit log.
// Every route goes through orgEvent(), which scopes the request to the organiser and edition.
import { Router } from 'express';
import path from 'node:path';
import { json } from '../db.js';
import {
  addDays,
  audit,
  bool,
  date,
  DEFAULT_EVENT_SETTINGS,
  email as vEmail,
  eventSettings,
  fail,
  GATE_ROLES,
  id,
  memberships,
  nowIso,
  num,
  oneOf,
  ORG_ROLES,
  orgEvent,
  paging,
  phone as vPhone,
  randomRef,
  randomToken,
  requireUser,
  sendCsv,
  str,
  strList,
  time,
  touchGuide,
  ymdIn,
  zonedToUtc,
} from '../core.js';
import { checkPasswordStrength, destroyUserSessions, findOrCreateUser, hashPassword } from '../auth.js';
import { eventSummary, planImageUrl } from '../services/guide.js';
import {
  advance,
  cancelRegistration,
  decideRegistration,
  ensureRegistrationOrder,
  registrationState,
  rotateAccess,
} from '../services/registrations.js';
import {
  allocateBooth,
  confirmAssignment,
  exhibitorView,
  lapseHolds,
  refreshChecklist,
  releaseAssignment,
  reviewApplication,
} from '../services/exhibitors.js';
import { invoiceData, orderView, recordManualPayment, recordRefund, reconcilePayment, reconciliation } from '../services/payments.js';
import { printJobs } from '../services/scans.js';
import { mail } from '../services/mail.js';

// snake_case row -> camelCase object, parsing the named JSON columns.
function camel(row, jsonCols = []) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
    out[key] = jsonCols.includes(k) ? json(v, []) : v;
  }
  return out;
}

// Largest hall and stall the floor plan accepts, in metres.
const MAX_HALL_M = 1000;
const MAX_STALL_M = 200;

export default function orgRoutes(ctx) {
  const { db, adapters } = ctx;
  const r = Router();
  const ev = (req, perm) => orgEvent(db, req, id(req.params.eid), perm);
  // A row of `table` that belongs to this event, or 404.
  const owned = (table, event, rid, what) => {
    const row = db.get(`SELECT * FROM ${table} WHERE id = ? AND event_id = ?`, id(rid), event.id);
    if (!row) fail(404, `${what} not found`);
    return row;
  };
  const zoneOf = (event, zid) => owned('zones', event, zid, 'Hall').id;
  // The first stall in a hall that would not fit a hall of this size, if any.
  const stallOutside = (zoneId, cols, rows) =>
    db.get(
      'SELECT code, x, y, w, h FROM booths WHERE zone_id = ? AND (x + w > ? + 0.01 OR y + h > ? + 0.01) ORDER BY code LIMIT 1',
      zoneId,
      cols,
      rows,
    ) || null;
  // Metres, rounded to the nearest 10 cm.
  const metres = (v, opts) => {
    const n = num(v, opts);
    return n == null ? null : Math.round(n * 10) / 10;
  };
  // Checks a stall against its hall and the other stalls there; returns the problem, if any.
  const layoutProblem = (zone, stall, others) => {
    const plan = json(zone.plan, {});
    if (plan.cols && (stall.x + stall.w > plan.cols + 0.01 || stall.y + stall.h > plan.rows + 0.01))
      return `Stall ${stall.code} goes outside ${zone.name} (${plan.cols} × ${plan.rows} m)`;
    const hit = others.find(
      (o) =>
        o.zone_id === stall.zone_id &&
        o.x < stall.x + stall.w - 0.01 &&
        stall.x < o.x + o.w - 0.01 &&
        o.y < stall.y + stall.h - 0.01 &&
        stall.y < o.y + o.h - 0.01,
    );
    return hit ? `Stall ${stall.code} overlaps stall ${hit.code}` : null;
  };
  // Validates one stall. Sizes are in metres; the area is width × depth.
  const boothRow = (event, b, selfId) => {
    const w = metres(b.w, { min: 0.5, max: MAX_STALL_M, required: true, name: 'Width' });
    const h = metres(b.h, { min: 0.5, max: MAX_STALL_M, required: true, name: 'Depth' });
    const row = {
      code: code(b.code),
      zone_id: zoneOf(event, b.zoneId),
      kind: oneOf(b.kind, ['shell', 'raw', 'premium']) || 'shell',
      size_sqm: Math.max(1, Math.round(w * h)),
      price_paise: num(b.pricePaise, { min: 0, int: true, name: 'Price' }) || 0,
      x: metres(b.x, { min: 0, max: MAX_HALL_M, required: true, name: 'Position from left' }),
      y: metres(b.y, { min: 0, max: MAX_HALL_M, required: true, name: 'Position from top' }),
      w,
      h,
      blocked: bool(b.blocked),
      note: str(b.note, { max: 200 }),
    };
    const zone = db.get('SELECT * FROM zones WHERE id = ?', row.zone_id);
    const others = db.all('SELECT * FROM booths WHERE event_id = ? AND id != ?', event.id, selfId ?? 0);
    const problem = layoutProblem(zone, row, others);
    if (problem) fail(409, problem);
    return row;
  };

  // ---------- events ----------
  r.get('/org/events', (req, res) => {
    requireUser(req);
    const seen = new Map();
    for (const m of memberships(db, req).filter((x) => ORG_ROLES.includes(x.role)))
      for (const e of db.all(
        'SELECT * FROM events WHERE organiser_id = ? AND (? IS NULL OR id = ?) ORDER BY starts_on DESC',
        m.organiser_id,
        m.event_id,
        m.event_id,
      ))
        if (!seen.has(e.id)) seen.set(e.id, { ...eventSummary(e), role: m.role });
    res.json([...seen.values()]);
  });

  const readEvent = (body) => ({
    name: str(body.name, { max: 120, required: true, name: 'Event name' }),
    edition: str(body.edition, { max: 40 }) || '',
    kind: oneOf(body.kind, ['exhibition', 'conference', 'combined']) || 'combined',
    tagline: str(body.tagline, { max: 200 }),
    description: str(body.description, { max: 4000 }),
    venue_name: str(body.venueName, { max: 160 }),
    venue_address: str(body.venueAddress, { max: 300 }),
    city: str(body.city, { max: 80 }),
    timezone: str(body.timezone, { max: 60 }) || 'Asia/Kolkata',
    starts_on: date(body.startsOn, { required: true, name: 'Start date' }),
    ends_on: date(body.endsOn, { required: true, name: 'End date' }),
    open_time: time(body.openTime) || '10:00',
    close_time: time(body.closeTime) || '18:00',
    accessibility: str(body.accessibility, { max: 4000 }),
  });

  // New draft edition for an organiser the user administers.
  r.post('/org/events', (req, res) => {
    requireUser(req);
    const admin = memberships(db, req).find((m) => m.role === 'organiser_admin' && m.event_id == null);
    if (!admin) fail(403, 'Only an organiser administrator can create events');
    const row = readEvent(req.body);
    if (row.ends_on < row.starts_on) fail(400, 'End date is before the start date');
    const slug = str(req.body.slug, { max: 60, required: true, name: 'Web address' }).toLowerCase();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(400, 'Web address may use letters, numbers and hyphens');
    if (db.value('SELECT 1 FROM events WHERE slug = ?', slug)) fail(409, 'That web address is taken');
    const eid = db.insert('events', {
      organiser_id: admin.organiser_id,
      slug,
      ...row,
      qr_secret: randomToken(32),
      updated_at: nowIso(),
      created_at: nowIso(),
    });
    const event = db.get('SELECT * FROM events WHERE id = ?', eid);
    audit(db, req, 'event.create', { event, entity: 'event', entityId: eid });
    res.status(201).json(eventSummary(event));
  });

  // Everything the configuration screens need in one call.
  r.get('/org/events/:eid', (req, res) => {
    const event = ev(req, 'event.view');
    const list = (table, order = 'id') => db.all(`SELECT * FROM ${table} WHERE event_id = ? ORDER BY ${order}`, event.id);
    res.json({
      event: {
        ...eventSummary(event),
        description: event.description,
        accessibility: event.accessibility,
        faqs: json(event.faqs, []),
        publishedAt: event.published_at,
      },
      role: req.orgRole,
      settings: eventSettings(event),
      invoiceProfile: json(db.value('SELECT invoice_profile FROM organisers WHERE id = ?', event.organiser_id), {}),
      zones: list('zones', 'sort, id').map((z) => ({ ...camel(z), ...json(z.plan, {}) })),
      gates: list('gates', 'code').map((g) => camel(g)),
      passClasses: list('pass_classes', 'sort, id').map((c) => camel(c, ['zone_ids'])),
      formFields: list('form_fields', 'sort, id').map((f) => camel(f, ['options'])),
      printers: list('printers').map((p) => camel(p)),
      kiosks: list('kiosks', 'code').map((k) => camel(k)),
      tracks: list('tracks', 'sort, id').map((t) => camel(t)),
      rooms: list('rooms').map((x) => camel(x)),
      serviceItems: list('service_items', 'category, name').map((s) => camel(s)),
      adapters: {
        email: adapters.email.label,
        payments: adapters.payments.label,
        printer: adapters.printer.label,
        push: adapters.push.label,
      },
    });
  });

  r.put('/org/events/:eid', (req, res) => {
    const event = ev(req, 'event.manage');
    const row = readEvent({ ...eventSummary(event), ...req.body });
    if (row.ends_on < row.starts_on) fail(400, 'End date is before the start date');
    const patch = { ...row, updated_at: nowIso() };
    if (Array.isArray(req.body.faqs))
      patch.faqs = JSON.stringify(
        req.body.faqs.slice(0, 30).map((f) => ({
          q: str(f?.q, { max: 200, required: true, name: 'Question' }),
          a: str(f?.a, { max: 1000, required: true, name: 'Answer' }),
        })),
      );
    if (req.body.settings && typeof req.body.settings === 'object') {
      const s = req.body.settings;
      const cur = eventSettings(event);
      const allowed = ['name', 'company', 'jobTitle', 'email', 'phone'];
      patch.settings = JSON.stringify({
        ...json(event.settings, {}),
        leadSharing: {
          fields: Array.isArray(s.leadSharing?.fields) ? s.leadSharing.fields.filter((f) => allowed.includes(f)) : cur.leadSharing.fields,
          notice: str(s.leadSharing?.notice, { max: 500 }) || cur.leadSharing.notice,
        },
        retentionDays: num(s.retentionDays, { min: 30, max: 3650, int: true, name: 'Retention' }) ?? cur.retentionDays,
        repeatWindowSeconds: num(s.repeatWindowSeconds, { min: 10, max: 3600, int: true }) ?? cur.repeatWindowSeconds,
        bundleHours: num(s.bundleHours, { min: 1, max: 72, int: true }) ?? cur.bundleHours,
        boothHoldHours: num(s.boothHoldHours, { min: 1, max: 720, int: true }) ?? cur.boothHoldHours,
        defaultBadgeQuota: num(s.defaultBadgeQuota, { min: 1, max: 200, int: true }) ?? cur.defaultBadgeQuota,
        interestTags: s.interestTags ? strList(s.interestTags, { max: 20, itemMax: 40 }) : cur.interestTags,
        gateInstructions: str(s.gateInstructions, { max: 300 }) || cur.gateInstructions,
        features: Object.fromEntries(
          Object.keys(DEFAULT_EVENT_SETTINGS.features).map((k) => [k, s.features?.[k] != null ? bool(s.features[k]) : cur.features[k]]),
        ),
      });
    }
    db.update('events', event.id, patch);
    touchGuide(db, event.id);
    audit(db, req, 'event.update', { event, entity: 'event', entityId: event.id });
    res.json({ ok: true });
  });

  // GST invoice profile (legal name, GSTIN, address, numbering) agreed with finance.
  r.put('/org/events/:eid/invoice-profile', (req, res) => {
    const event = ev(req, 'finance.manage');
    const b = req.body;
    db.run(
      'UPDATE organisers SET invoice_profile = ? WHERE id = ?',
      JSON.stringify({
        legalName: str(b.legalName, { max: 160, required: true, name: 'Legal name' }),
        gstin: str(b.gstin, { max: 15 })?.toUpperCase() ?? null,
        stateCode: str(b.stateCode, { max: 2 }),
        address: str(b.address, { max: 400 }),
        sac: str(b.sac, { max: 10 }),
        invoicePrefix: str(b.invoicePrefix, { max: 20 }) || 'INV',
        notes: str(b.notes, { max: 400 }),
      }),
      event.organiser_id,
    );
    audit(db, req, 'finance.invoice_profile', { event });
    res.json({ ok: true });
  });

  r.post('/org/events/:eid/publish', (req, res) => {
    const event = ev(req, 'event.manage');
    const publish = req.body.published !== false;
    if (publish && !db.value('SELECT 1 FROM pass_classes WHERE event_id = ? AND active = 1', event.id))
      fail(409, 'Add at least one pass type before publishing');
    db.update('events', event.id, {
      status: publish ? 'published' : 'draft',
      published_at: publish ? nowIso() : event.published_at,
      updated_at: nowIso(),
    });
    touchGuide(db, event.id);
    audit(db, req, publish ? 'event.publish' : 'event.unpublish', { event, entity: 'event', entityId: event.id });
    res.json({ ok: true });
  });

  // ---------- configuration lists ----------
  // One small CRUD per configuration table. `read` validates the body into a row.
  function resource(name, table, perm, read, { jsonCols = [], guide = true } = {}) {
    r.post(`/org/events/:eid/${name}`, (req, res) => {
      const event = ev(req, perm);
      let rid;
      try {
        rid = db.insert(table, { event_id: event.id, ...read(req.body, event, null) });
      } catch (e) {
        if (/UNIQUE/.test(e.message)) fail(409, 'That code is already in use');
        throw e;
      }
      if (guide) touchGuide(db, event.id);
      audit(db, req, `${name}.create`, { event, entity: table, entityId: rid });
      res.status(201).json(camel(db.get(`SELECT * FROM ${table} WHERE id = ?`, rid), jsonCols));
    });
    r.put(`/org/events/:eid/${name}/:rid`, (req, res) => {
      const event = ev(req, perm);
      const row = owned(table, event, req.params.rid, 'Record');
      try {
        db.update(table, row.id, read(req.body, event, row));
      } catch (e) {
        if (/UNIQUE/.test(e.message)) fail(409, 'That code is already in use');
        throw e;
      }
      if (guide) touchGuide(db, event.id);
      audit(db, req, `${name}.update`, { event, entity: table, entityId: row.id });
      res.json(camel(db.get(`SELECT * FROM ${table} WHERE id = ?`, row.id), jsonCols));
    });
    r.delete(`/org/events/:eid/${name}/:rid`, (req, res) => {
      const event = ev(req, perm);
      const row = owned(table, event, req.params.rid, 'Record');
      try {
        db.run(`DELETE FROM ${table} WHERE id = ?`, row.id);
      } catch {
        fail(409, 'This is in use and cannot be deleted. Deactivate it instead.');
      }
      if (guide) touchGuide(db, event.id);
      audit(db, req, `${name}.delete`, { event, entity: table, entityId: row.id });
      res.json({ ok: true });
    });
  }
  const code = (v) => str(v, { max: 24, required: true, name: 'Code' }).toUpperCase().replace(/\s+/g, '-');

  // A hall's plan is measured in metres: cols is its width and rows its depth.
  resource('zones', 'zones', 'floor.manage', (b, _event, existing) => {
    const cols = num(b.cols, { min: 0, max: MAX_HALL_M, name: 'Hall width' }) || 0;
    const rows = num(b.rows, { min: 0, max: MAX_HALL_M, name: 'Hall depth' }) || 0;
    // A hall cannot shrink past the stalls already placed in it.
    const out = existing && cols ? stallOutside(existing.id, cols, rows) : null;
    if (out)
      fail(
        409,
        `Stall ${out.code} would be outside the hall. Move it first, or keep the hall at least ${Math.max(out.x + out.w, 0)} × ${out.y + out.h} m.`,
      );
    return {
      code: code(b.code),
      name: str(b.name, { max: 80, required: true, name: 'Name' }),
      kind: oneOf(b.kind, ['hall', 'conference', 'restricted', 'service']) || 'hall',
      restricted: bool(b.restricted),
      capacity: num(b.capacity, { min: 0, int: true }),
      plan: JSON.stringify({ ...json(existing?.plan, {}), cols, rows }),
      sort: num(b.sort, { int: true }) || 0,
    };
  });
  resource('gates', 'gates', 'floor.manage', (b, event) => ({
    code: code(b.code),
    name: str(b.name, { max: 80, required: true, name: 'Name' }),
    zone_id: zoneOf(event, b.zoneId),
    direction: oneOf(b.direction, ['in', 'out']) || 'in',
    x: num(b.x),
    y: num(b.y),
    active: b.active == null ? 1 : bool(b.active),
  }));
  resource(
    'pass-classes',
    'pass_classes',
    'event.manage',
    (b, event) => {
      const zones = db.all('SELECT id FROM zones WHERE event_id = ?', event.id).map((z) => z.id);
      const from = date(b.validFrom) || event.starts_on;
      const to = date(b.validTo) || event.ends_on;
      if (to < from) fail(400, 'Valid-to date is before valid-from');
      const price = num(b.pricePaise, { min: 0, int: true, name: 'Price' }) || 0;
      const mode = oneOf(b.mode, ['free', 'paid', 'invited', 'approval', 'internal']) || 'free';
      if (mode === 'paid' && price <= 0) fail(400, 'A paid pass needs a price');
      return {
        code: code(b.code),
        name: str(b.name, { max: 80, required: true, name: 'Name' }),
        kind: oneOf(b.kind, ['visitor', 'delegate', 'vip', 'media', 'exhibitor', 'speaker', 'staff']) || 'visitor',
        mode,
        description: str(b.description, { max: 300 }),
        price_paise: price,
        gst_percent: num(b.gstPercent, { min: 0, max: 28, int: true }) ?? 18,
        zone_ids: JSON.stringify((Array.isArray(b.zoneIds) ? b.zoneIds : []).map(Number).filter((z) => zones.includes(z))),
        valid_from: from,
        valid_to: to,
        reentry: b.reentry == null ? 1 : bool(b.reentry),
        lead_scannable: bool(b.leadScannable),
        capacity: num(b.capacity, { min: 1, int: true }),
        active: b.active == null ? 1 : bool(b.active),
        sort: num(b.sort, { int: true }) || 0,
      };
    },
    { jsonCols: ['zone_ids'] },
  );
  resource(
    'form-fields',
    'form_fields',
    'event.manage',
    (b) => ({
      key: str(b.key, { max: 40, required: true, name: 'Key' }).replace(/[^a-zA-Z0-9_]/g, ''),
      label: str(b.label, { max: 120, required: true, name: 'Label' }),
      type: oneOf(b.type, ['text', 'select', 'checkbox']) || 'text',
      options: JSON.stringify(strList(b.options, { max: 20 })),
      required: bool(b.required),
      active: b.active == null ? 1 : bool(b.active),
      sort: num(b.sort, { int: true }) || 0,
    }),
    { jsonCols: ['options'] },
  );
  resource('booths', 'booths', 'floor.manage', (b, event, existing) =>
    boothRow(event, { ...b, code: b.code ?? existing?.code }, existing?.id ?? null),
  );
  resource(
    'kiosks',
    'kiosks',
    'floor.manage',
    (b, event) => ({
      code: code(b.code),
      name: str(b.name, { max: 80, required: true, name: 'Name' }),
      zone_id: zoneOf(event, b.zoneId),
      mode: oneOf(b.mode, ['map', 'agenda', 'both']) || 'both',
      x: num(b.x, { min: 0, max: 60, required: true, name: 'Column' }),
      y: num(b.y, { min: 0, max: 60, required: true, name: 'Row' }),
    }),
    { guide: false },
  );
  resource(
    'printers',
    'printers',
    'floor.manage',
    (b, event) => ({
      name: str(b.name, { max: 80, required: true, name: 'Name' }),
      model: str(b.model, { max: 80 }),
      gate_id: b.gateId ? owned('gates', event, b.gateId, 'Gate').id : null,
      is_spare: bool(b.isSpare),
      status: oneOf(b.status, ['ready', 'error', 'offline']) || 'ready',
      last_error: str(b.lastError, { max: 200 }),
    }),
    { guide: false },
  );
  resource('tracks', 'tracks', 'agenda.manage', (b) => ({
    name: str(b.name, { max: 80, required: true, name: 'Name' }),
    description: str(b.description, { max: 300 }),
    sort: num(b.sort, { int: true }) || 0,
  }));
  resource('rooms', 'rooms', 'agenda.manage', (b, event) => ({
    name: str(b.name, { max: 80, required: true, name: 'Name' }),
    zone_id: b.zoneId ? zoneOf(event, b.zoneId) : null,
    capacity: num(b.capacity, { min: 1, int: true }),
  }));
  resource(
    'sessions',
    'agenda_sessions',
    'agenda.manage',
    (b, event, existing) => {
      const row = {
        title: str(b.title, { max: 160, required: true, name: 'Title' }),
        description: str(b.description, { max: 2000 }),
        speakers: JSON.stringify(
          (Array.isArray(b.speakers) ? b.speakers : [])
            .slice(0, 8)
            .map((s) => ({ name: str(s?.name, { max: 80, required: true, name: 'Speaker name' }), title: str(s?.title, { max: 120 }) })),
        ),
        day: date(b.day, { required: true, name: 'Day' }),
        start_time: time(b.startTime, { required: true, name: 'Start time' }),
        end_time: time(b.endTime, { required: true, name: 'End time' }),
        track_id: b.trackId ? owned('tracks', event, b.trackId, 'Track').id : null,
        room_id: b.roomId ? owned('rooms', event, b.roomId, 'Room').id : null,
        capacity: num(b.capacity, { min: 1, int: true }),
        seats_taken: num(b.seatsTaken, { min: 0, int: true }) ?? existing?.seats_taken ?? 0,
        status: oneOf(b.status, ['scheduled', 'cancelled']) || 'scheduled',
        updated_at: nowIso(),
      };
      if (row.day < event.starts_on || row.day > event.ends_on) fail(400, 'The session day is outside the event dates');
      if (row.end_time <= row.start_time) fail(400, 'End time must be after the start time');
      // Two sessions cannot share a room at the same time.
      const clash =
        row.room_id && row.status === 'scheduled'
          ? db.get(
              "SELECT title FROM agenda_sessions WHERE event_id = ? AND room_id = ? AND day = ? AND status = 'scheduled' AND id != ? AND start_time < ? AND end_time > ?",
              event.id,
              row.room_id,
              row.day,
              existing?.id ?? 0,
              row.end_time,
              row.start_time,
            )
          : null;
      if (clash) fail(409, `That room is already booked for "${clash.title}" at this time`);
      return row;
    },
    { jsonCols: ['speakers'] },
  );
  resource(
    'service-items',
    'service_items',
    'event.manage',
    (b) => ({
      code: code(b.code),
      category: str(b.category, { max: 60, required: true, name: 'Category' }),
      name: str(b.name, { max: 120, required: true, name: 'Name' }),
      unit: str(b.unit, { max: 30 }) || 'each',
      price_paise: num(b.pricePaise, { min: 0, int: true, required: true, name: 'Price' }),
      active: b.active == null ? 1 : bool(b.active),
    }),
    { guide: false },
  );

  r.get('/org/events/:eid/sessions', (req, res) => {
    const event = ev(req, 'event.view');
    res.json(
      db.all('SELECT * FROM agenda_sessions WHERE event_id = ? ORDER BY day, start_time', event.id).map((s) => camel(s, ['speakers'])),
    );
  });

  // Invitation codes for invited pass types.
  r.get('/org/events/:eid/invites', (req, res) => {
    const event = ev(req, 'reg.view');
    res.json(
      db
        .all(
          'SELECT i.*, c.name AS pass_class FROM invites i JOIN pass_classes c ON c.id = i.pass_class_id WHERE i.event_id = ? ORDER BY i.id DESC',
          event.id,
        )
        .map((i) => camel(i)),
    );
  });
  r.post('/org/events/:eid/invites', (req, res) => {
    const event = ev(req, 'reg.manage');
    const cls = owned('pass_classes', event, req.body.passClassId, 'Pass type');
    if (cls.mode !== 'invited') fail(400, 'Invitation codes are for invited pass types');
    const iid = db.insert('invites', {
      event_id: event.id,
      pass_class_id: cls.id,
      code: randomRef('INV', 8).toUpperCase(),
      email: vEmail(req.body.email),
      note: str(req.body.note, { max: 200 }),
      max_uses: num(req.body.maxUses, { min: 1, max: 1000, int: true }) || 1,
      expires_at: req.body.expiresOn ? zonedToUtc(addDays(date(req.body.expiresOn), 1), '00:00', event.timezone).toISOString() : null,
      created_at: nowIso(),
    });
    audit(db, req, 'invite.create', { event, entity: 'invite', entityId: iid });
    res.status(201).json(camel(db.get('SELECT * FROM invites WHERE id = ?', iid)));
  });

  // ---------- live operations ----------
  r.get('/org/events/:eid/live', (req, res) => {
    const event = ev(req, 'event.view');
    lapseHolds(db, event.id);
    const one = (sql, ...p) => db.value(sql, event.id, ...p) || 0;
    const today = ymdIn(event.timezone);
    const dayStart = zonedToUtc(today, '00:00', event.timezone).toISOString();
    const recently = new Date(Date.now() - 2 * 60000).toISOString();
    const hm = (iso) =>
      iso
        ? new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(
            new Date(iso),
          )
        : null;
    const gates = db
      .all(
        'SELECT g.*, z.name AS zone_name FROM gates g JOIN zones z ON z.id = g.zone_id WHERE g.event_id = ? AND g.active = 1 ORDER BY g.code',
        event.id,
      )
      .map((g) => {
        const devices = db.all("SELECT * FROM devices WHERE gate_id = ? AND status = 'active'", g.id);
        const queued = devices.reduce((a, d) => a + d.queued_count, 0);
        const online = devices.filter((d) => d.last_seen_at && d.last_seen_at > recently).length;
        const lastSeen = devices
          .map((d) => d.last_seen_at)
          .filter(Boolean)
          .sort()
          .pop();
        let status = 'none';
        let statusText = 'No device';
        if (queued > 0) [status, statusText] = ['pending', `${queued} scans pending`];
        else if (online) [status, statusText] = ['online', 'Online'];
        else if (devices.length) [status, statusText] = ['offline', `Offline since ${hm(lastSeen) || 'enrolment'}`];
        return {
          id: g.id,
          code: g.code,
          name: g.name,
          zone: g.zone_name,
          status,
          statusText,
          devices: devices.length,
          queued,
          scansToday: db.value('SELECT COUNT(*) FROM scan_events WHERE gate_id = ? AND scanned_at >= ?', g.id, dayStart),
          admittedToday: db.value('SELECT COUNT(*) FROM scan_events WHERE gate_id = ? AND scanned_at >= ? AND counted = 1', g.id, dayStart),
          lastScanAt: db.value('SELECT MAX(scanned_at) FROM scan_events WHERE gate_id = ?', g.id) || null,
        };
      });
    const attention = [
      {
        key: 'print',
        n: one("SELECT COUNT(*) FROM print_jobs WHERE event_id = ? AND status = 'failed'"),
        one: 'printer job failed',
        many: 'printer jobs failed',
        link: 'gates',
      },
      {
        key: 'exhibitors',
        n: one("SELECT COUNT(*) FROM exhibitors WHERE event_id = ? AND status = 'submitted'"),
        one: 'exhibitor approval',
        many: 'exhibitor approvals',
        link: 'exhibitors?status=submitted',
      },
      {
        key: 'registrations',
        n: one("SELECT COUNT(*) FROM registrations WHERE event_id = ? AND status = 'pending_review'"),
        one: 'registration to review',
        many: 'registrations to review',
        link: 'registrations?status=pending_review',
      },
      {
        key: 'conflicts',
        n: one('SELECT COUNT(*) FROM scan_events WHERE event_id = ? AND conflict = 1'),
        one: 'scan conflict',
        many: 'scan conflicts',
        link: 'gates',
      },
      {
        key: 'drawings',
        n: one("SELECT COUNT(*) FROM checklist_items WHERE event_id = ? AND status = 'awaiting_review'"),
        one: 'exhibitor upload to review',
        many: 'exhibitor uploads to review',
        link: 'exhibitors',
      },
      {
        key: 'finance',
        n: reconciliation(db, event).issues.length,
        one: 'finance item to reconcile',
        many: 'finance items to reconcile',
        link: 'finance',
      },
    ]
      .filter((a) => a.n > 0)
      .map((a) => ({ key: a.key, count: a.n, text: `${a.n} ${a.n === 1 ? a.one : a.many}`, link: a.link }));
    const exits = one("SELECT COUNT(*) FROM scan_events WHERE event_id = ? AND direction = 'out' AND scanned_at >= ?", dayStart);
    res.json({
      today,
      metrics: {
        registered: one("SELECT COUNT(*) FROM registrations WHERE event_id = ? AND status IN ('pending_review','confirmed')"),
        passesIssued: one("SELECT COUNT(*) FROM passes WHERE event_id = ? AND status = 'active'"),
        // Unique entries: each pass counts once however many times or gates it was scanned at.
        checkedIn: one('SELECT COUNT(DISTINCT pass_id) FROM scan_events WHERE event_id = ? AND counted = 1'),
        checkedInToday: one(
          'SELECT COUNT(DISTINCT pass_id) FROM scan_events WHERE event_id = ? AND counted = 1 AND scanned_at >= ?',
          dayStart,
        ),
        boothsConfirmed: one("SELECT COUNT(*) FROM booth_assignments WHERE event_id = ? AND status = 'confirmed'"),
        boothsTotal: one('SELECT COUNT(*) FROM booths WHERE event_id = ? AND blocked = 0'),
      },
      // Occupancy is only an estimate, and only when exits are scanned too.
      occupancy: exits
        ? {
            tracked: true,
            estimate: Math.max(
              0,
              one('SELECT COUNT(DISTINCT pass_id) FROM scan_events WHERE event_id = ? AND counted = 1 AND scanned_at >= ?', dayStart) -
                exits,
            ),
          }
        : { tracked: false, estimate: null },
      gates,
      attention,
      recentScans: db
        .all(
          `SELECT s.id, s.result, s.scanned_at, s.mode, s.conflict, g.name AS gate, p.holder_name, c.name AS class_name
           FROM scan_events s JOIN gates g ON g.id = s.gate_id LEFT JOIN passes p ON p.id = s.pass_id LEFT JOIN pass_classes c ON c.id = p.pass_class_id
           WHERE s.event_id = ? ORDER BY s.scanned_at DESC LIMIT 12`,
          event.id,
        )
        .map((s) => camel(s)),
    });
  });

  // Gate operations detail: devices, failed print jobs, scan conflicts.
  r.get('/org/events/:eid/gate-ops', (req, res) => {
    const event = ev(req, 'gate.view');
    res.json({
      devices: db
        .all(
          'SELECT d.*, g.name AS gate_name, u.name AS user_name FROM devices d LEFT JOIN gates g ON g.id = d.gate_id JOIN users u ON u.id = d.user_id WHERE d.event_id = ? ORDER BY d.id DESC',
          event.id,
        )
        .map((d) => ({
          id: d.id,
          name: d.name,
          platform: d.platform,
          gate: d.gate_name,
          user: d.user_name,
          status: d.status,
          queued: d.queued_count,
          lastSeenAt: d.last_seen_at,
          lastSyncAt: d.last_sync_at,
        })),
      printJobs: printJobs(db, event.id)
        .slice(0, 60)
        .map((j) => ({
          id: j.id,
          gateId: j.gate_id,
          name: j.holder_name,
          passClass: j.class_name,
          gate: j.gate_name,
          printer: j.printer_name,
          kind: j.kind,
          reason: j.reason,
          status: j.status,
          error: j.error,
          attempts: j.attempts,
          updatedAt: j.updated_at,
        })),
      conflicts: db
        .all(
          `SELECT s.id, s.scanned_at, s.result, s.device_result, g.name AS gate, d.name AS device, p.holder_name,
                  o.scanned_at AS first_at, og.name AS first_gate, od.name AS first_device
           FROM scan_events s JOIN gates g ON g.id = s.gate_id LEFT JOIN devices d ON d.id = s.device_id
           JOIN passes p ON p.id = s.pass_id
           LEFT JOIN scan_events o ON o.id = s.conflict_with LEFT JOIN gates og ON og.id = o.gate_id LEFT JOIN devices od ON od.id = o.device_id
           WHERE s.event_id = ? AND s.conflict = 1 ORDER BY s.scanned_at DESC LIMIT 100`,
          event.id,
        )
        .map((c) => camel(c)),
      overrides: db
        .all(
          "SELECT s.scanned_at, s.override_reason, g.name AS gate, p.holder_name, u.name AS by FROM scan_events s JOIN gates g ON g.id = s.gate_id JOIN passes p ON p.id = s.pass_id LEFT JOIN users u ON u.id = s.user_id WHERE s.event_id = ? AND s.method = 'override' ORDER BY s.scanned_at DESC LIMIT 50",
          event.id,
        )
        .map((o) => camel(o)),
    });
  });
  // Revoking a device ends its access; on its next contact the app purges its cached data.
  r.post('/org/events/:eid/devices/:did/revoke', (req, res) => {
    const event = ev(req, 'gate.view');
    const device = owned('devices', event, req.params.did, 'Device');
    db.update('devices', device.id, { status: 'revoked', revoked_at: nowIso() });
    audit(db, req, 'device.revoke', { event, entity: 'device', entityId: device.id, detail: { name: device.name } });
    res.json({ ok: true });
  });

  // ---------- registrations ----------
  const regFilter = (req, event) => {
    const where = ['r.event_id = ?'];
    const params = [event.id];
    const q = str(req.query.q, { max: 80 });
    if (q) {
      where.push("(lower(r.name) LIKE ? OR lower(r.email) LIKE ? OR lower(COALESCE(r.company,'')) LIKE ? OR lower(r.ref) LIKE ?)");
      const like = `%${q.toLowerCase().replace(/[%_]/g, '')}%`;
      params.push(like, like, like, like);
    }
    const status = oneOf(req.query.status, ['unverified', 'pending_review', 'confirmed', 'rejected', 'cancelled']);
    if (status) {
      where.push('r.status = ?');
      params.push(status);
    }
    const pay = oneOf(req.query.payment, ['not_required', 'pending', 'paid', 'failed', 'refunded']);
    if (pay) {
      where.push('r.payment_status = ?');
      params.push(pay);
    }
    if (req.query.passClass) {
      where.push('c.code = ?');
      params.push(String(req.query.passClass));
    }
    if (req.query.admitted === 'yes')
      where.push('EXISTS (SELECT 1 FROM passes p JOIN scan_events s ON s.pass_id = p.id AND s.counted = 1 WHERE p.registration_id = r.id)');
    if (req.query.admitted === 'no')
      where.push(
        'NOT EXISTS (SELECT 1 FROM passes p JOIN scan_events s ON s.pass_id = p.id AND s.counted = 1 WHERE p.registration_id = r.id)',
      );
    return { where: where.join(' AND '), params };
  };
  const REG_SELECT = `SELECT r.*, c.name AS class_name, c.code AS class_code,
      (SELECT MIN(s.scanned_at) FROM passes p JOIN scan_events s ON s.pass_id = p.id AND s.counted = 1 WHERE p.registration_id = r.id) AS admitted_at
    FROM registrations r JOIN pass_classes c ON c.id = r.pass_class_id`;
  const regRow = (x) => ({
    id: x.id,
    ref: x.ref,
    name: x.name,
    email: x.email,
    phone: x.phone,
    company: x.company,
    jobTitle: x.job_title,
    passClass: x.class_name,
    status: x.status,
    paymentStatus: x.payment_status,
    source: x.source,
    admittedAt: x.admitted_at,
    createdAt: x.created_at,
  });

  r.get('/org/events/:eid/registrations', (req, res) => {
    const event = ev(req, 'reg.view');
    const { where, params } = regFilter(req, event);
    const { page, pageSize, offset } = paging(req.query);
    const total = db.value(`SELECT COUNT(*) FROM registrations r JOIN pass_classes c ON c.id = r.pass_class_id WHERE ${where}`, ...params);
    res.json({
      total,
      page,
      pageSize,
      rows: db.all(`${REG_SELECT} WHERE ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset).map(regRow),
    });
  });
  r.get('/org/events/:eid/registrations.csv', (req, res) => {
    const event = ev(req, 'reports.view');
    const { where, params } = regFilter(req, event);
    const rows = db.all(`${REG_SELECT} WHERE ${where} ORDER BY r.id`, ...params);
    audit(db, req, 'report.export', { event, detail: { report: 'registrations', rows: rows.length } });
    sendCsv(
      res,
      `registrations-${event.slug}.csv`,
      [
        'Reference',
        'Name',
        'Email',
        'Phone',
        'Company',
        'Job title',
        'Pass type',
        'Status',
        'Payment',
        'Source',
        'First admitted',
        'Registered',
      ],
      rows.map((x) => [
        x.ref,
        x.name,
        x.email,
        x.phone,
        x.company,
        x.job_title,
        x.class_name,
        x.status,
        x.payment_status,
        x.source,
        x.admitted_at,
        x.created_at,
      ]),
    );
  });
  const regOf = (req, event) => owned('registrations', event, req.params.rid, 'Registration');
  r.get('/org/events/:eid/registrations/:rid', (req, res) => {
    const event = ev(req, 'reg.view');
    const reg = regOf(req, event);
    const pass = db.get('SELECT id FROM passes WHERE registration_id = ?', reg.id);
    const state = registrationState(ctx, event, reg);
    res.json({
      ...state,
      order: undefined,
      phone: reg.phone,
      answers: json(reg.answers, {}),
      source: reg.source,
      leadOptOut: Boolean(reg.lead_opt_out),
      contactVerifiedAt: reg.contact_verified_at,
      orders: db.all('SELECT * FROM orders WHERE registration_id = ? ORDER BY id', reg.id).map((o) => orderView(db, o)),
      scans: pass
        ? db
            .all(
              'SELECT s.scanned_at, s.result, s.mode, s.conflict, g.name AS gate FROM scan_events s JOIN gates g ON g.id = s.gate_id WHERE s.pass_id = ? ORDER BY s.scanned_at DESC LIMIT 30',
              pass.id,
            )
            .map((s) => camel(s))
        : [],
    });
  });
  r.post('/org/events/:eid/registrations/:rid/decision', (req, res) => {
    const event = ev(req, 'reg.manage');
    const decision = oneOf(req.body.decision, ['approve', 'reject'], { required: true, name: 'Decision' });
    const note = str(req.body.note, { max: 300 });
    if (decision === 'reject' && !note) fail(400, 'Add a note for the visitor');
    res.json(regRow({ ...decideRegistration(ctx, req, event, regOf(req, event), decision, note), class_name: '' }));
  });
  r.post('/org/events/:eid/registrations/:rid/cancel', (req, res) => {
    const event = ev(req, 'reg.manage');
    cancelRegistration(ctx, req, event, regOf(req, event), { by: 'organiser' });
    res.json({ ok: true });
  });
  r.post('/org/events/:eid/registrations/:rid/resend', (req, res) => {
    const event = ev(req, 'reg.manage');
    const reg = regOf(req, event);
    if (['unverified', 'cancelled'].includes(reg.status)) fail(409, 'There is nothing to resend for this registration');
    mail.passLink(ctx, event, reg, rotateAccess(db, reg));
    audit(db, req, 'registration.resend', { event, entity: 'registration', entityId: reg.id, detail: { ref: reg.ref } });
    res.json({ ok: true });
  });
  // Staffed registration at the help desk: staff have seen the person, so no email code.
  r.post('/org/events/:eid/registrations', (req, res) => {
    const event = ev(req, 'reg.manage');
    const cls = db.get(
      'SELECT * FROM pass_classes WHERE event_id = ? AND code = ? AND active = 1',
      event.id,
      String(req.body.passClass || ''),
    );
    if (!cls || cls.kind === 'exhibitor') fail(400, 'Choose a pass type');
    const email = vEmail(req.body.email, { required: true });
    const out = db.tx(() => {
      if (
        db.value(
          "SELECT 1 FROM registrations WHERE event_id = ? AND email = ? AND pass_class_id = ? AND status NOT IN ('cancelled','rejected')",
          event.id,
          email,
          cls.id,
        )
      )
        fail(409, 'This email already has that pass. Use lookup to find it.');
      const name = str(req.body.name, { max: 120, required: true, name: 'Full name' });
      const rid = db.insert('registrations', {
        event_id: event.id,
        pass_class_id: cls.id,
        user_id: findOrCreateUser(db, { email, name }),
        ref: randomRef(eventSettings(event).refPrefix || 'REG'),
        name,
        email,
        phone: vPhone(req.body.phone),
        company: str(req.body.company, { max: 160 }),
        job_title: str(req.body.jobTitle, { max: 120 }),
        source: 'desk',
        consent_at: nowIso(),
        contact_verified_at: nowIso(),
        status: 'confirmed',
        payment_status: cls.price_paise > 0 ? 'pending' : 'not_required',
        decided_by: req.user.id,
        decided_at: nowIso(),
        updated_at: nowIso(),
        created_at: nowIso(),
      });
      const reg = db.get('SELECT * FROM registrations WHERE id = ?', rid);
      if (reg.payment_status === 'pending') ensureRegistrationOrder(ctx, event, reg);
      else advance(ctx, event, rid);
      audit(db, req, 'registration.desk', { event, entity: 'registration', entityId: rid, detail: { ref: reg.ref } });
      return db.get('SELECT * FROM registrations WHERE id = ?', rid);
    });
    res.status(201).json(registrationState(ctx, event, out));
  });

  // ---------- exhibitors ----------
  r.get('/org/events/:eid/exhibitors', (req, res) => {
    const event = ev(req, 'exh.view');
    lapseHolds(db, event.id);
    const status = oneOf(req.query.status, ['draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn']);
    const q = str(req.query.q, { max: 80 })?.toLowerCase();
    res.json(
      db
        .all(
          `SELECT e.*, b.code AS booth_code, a.status AS booth_status, a.id AS assignment_id,
                  (SELECT COALESCE(SUM(total_paise), 0) FROM orders o WHERE o.exhibitor_id = e.id AND o.status != 'cancelled') AS billed,
                  (SELECT COALESCE(SUM(paid_paise), 0) FROM orders o WHERE o.exhibitor_id = e.id AND o.status != 'cancelled') AS paid,
                  (SELECT COUNT(*) FROM checklist_items c WHERE c.exhibitor_id = e.id AND c.status = 'awaiting_review') AS to_review
           FROM exhibitors e
           LEFT JOIN booth_assignments a ON a.exhibitor_id = e.id AND a.status IN ('held','confirmed')
           LEFT JOIN booths b ON b.id = a.booth_id
           WHERE e.event_id = ? AND e.status != 'draft' ORDER BY (e.status = 'submitted') DESC, e.company_name COLLATE NOCASE`,
          event.id,
        )
        .filter((e) => (!status || e.status === status) && (!q || e.company_name.toLowerCase().includes(q)))
        .map((e) => ({
          id: e.id,
          companyName: e.company_name,
          industry: e.industry,
          contactName: e.contact_name,
          status: e.status,
          boothCode: e.booth_code,
          boothStatus: e.booth_status,
          assignmentId: e.assignment_id,
          billedPaise: e.billed,
          paidPaise: e.paid,
          toReview: e.to_review,
          submittedAt: e.submitted_at,
        })),
    );
  });
  const exOf = (req, event) => owned('exhibitors', event, req.params.xid, 'Exhibitor');
  r.get('/org/events/:eid/exhibitors/:xid', (req, res) => {
    const event = ev(req, 'exh.view');
    const ex = exOf(req, event);
    refreshChecklist(db, event, ex.id);
    res.json({
      exhibitor: exhibitorView(ex),
      booth:
        db.get(
          "SELECT a.id AS assignmentId, a.status, a.hold_expires_at AS holdExpiresAt, b.code, z.name AS hall FROM booth_assignments a JOIN booths b ON b.id = a.booth_id JOIN zones z ON z.id = b.zone_id WHERE a.exhibitor_id = ? AND a.status IN ('held','confirmed') ORDER BY a.id DESC LIMIT 1",
          ex.id,
        ) || null,
      orders: db
        .all("SELECT * FROM orders WHERE exhibitor_id = ? AND status != 'cancelled' ORDER BY id", ex.id)
        .map((o) => orderView(db, o)),
      checklist: db.all('SELECT * FROM checklist_items WHERE exhibitor_id = ? ORDER BY sort', ex.id).map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        dueOn: c.due_on,
        status: c.status,
        note: c.note,
        hasUpload: Boolean(c.upload_id),
      })),
      team: db.all("SELECT name, email, role, status FROM team_badges WHERE exhibitor_id = ? AND status != 'revoked' ORDER BY id", ex.id),
      // Organisers see how many leads a company captured, never the leads themselves.
      leadCount: db.value('SELECT COUNT(*) FROM leads WHERE exhibitor_id = ?', ex.id),
    });
  });
  r.post('/org/events/:eid/exhibitors/:xid/review', (req, res) => {
    const event = ev(req, 'exh.review');
    const decision = oneOf(req.body.decision, ['approve', 'reject', 'changes'], { required: true, name: 'Decision' });
    res.json(exhibitorView(reviewApplication(ctx, req, event, exOf(req, event), decision, str(req.body.note, { max: 500 }))));
  });
  r.post('/org/events/:eid/exhibitors/:xid/allocate', (req, res) => {
    const event = ev(req, 'exh.allocate');
    const booth = owned('booths', event, req.body.boothId, 'Booth');
    const a = allocateBooth(ctx, req, event, exOf(req, event), booth, { confirm: bool(req.body.confirm) });
    res.status(201).json({ assignmentId: a.id, status: a.status, boothCode: booth.code });
  });
  r.put('/org/events/:eid/exhibitors/:xid/quota', (req, res) => {
    const event = ev(req, 'exh.review');
    const ex = exOf(req, event);
    const quota = num(req.body.badgeQuota, { min: 1, max: 500, int: true, required: true, name: 'Badge quota' });
    db.update('exhibitors', ex.id, { badge_quota: quota, updated_at: nowIso() });
    audit(db, req, 'exhibitor.quota', { event, entity: 'exhibitor', entityId: ex.id, detail: { quota } });
    res.json({ ok: true });
  });
  r.post('/org/events/:eid/assignments/:aid/confirm', (req, res) => {
    const event = ev(req, 'exh.allocate');
    res.json({ status: confirmAssignment(ctx, req, event, id(req.params.aid)).status });
  });
  r.post('/org/events/:eid/assignments/:aid/release', (req, res) => {
    const event = ev(req, 'exh.allocate');
    releaseAssignment(ctx, req, event, id(req.params.aid));
    res.json({ ok: true });
  });
  r.post('/org/events/:eid/checklist/:cid/review', (req, res) => {
    const event = ev(req, 'exh.review');
    const item = owned('checklist_items', event, req.params.cid, 'Checklist item');
    if (item.status !== 'awaiting_review') fail(409, 'This item is not waiting for review');
    const ok = oneOf(req.body.decision, ['complete', 'changes'], { required: true, name: 'Decision' }) === 'complete';
    const note = str(req.body.note, { max: 300 });
    if (!ok && !note) fail(400, 'Say what needs to change');
    db.update('checklist_items', item.id, { status: ok ? 'complete' : 'changes_requested', note: ok ? null : note, updated_at: nowIso() });
    audit(db, req, 'checklist.review', { event, entity: 'checklist_item', entityId: item.id, detail: { decision: req.body.decision } });
    res.json({ ok: true });
  });
  r.get('/org/events/:eid/checklist/:cid/file', (req, res) => {
    const event = ev(req, 'exh.view');
    const item = owned('checklist_items', event, req.params.cid, 'Checklist item');
    const up = item.upload_id ? db.get('SELECT * FROM uploads WHERE id = ? AND event_id = ?', item.upload_id, event.id) : null;
    if (!up) fail(404, 'No file uploaded');
    res.download(path.join(ctx.uploadsDir, 'exhibitor', path.basename(up.stored_name)), up.filename);
  });

  // Booth inventory with who holds what.
  r.get('/org/events/:eid/floor', (req, res) => {
    const event = ev(req, 'exh.view');
    lapseHolds(db, event.id);
    const booths = db.all(
      `SELECT b.*, a.id AS assignment_id, a.status AS a_status, a.hold_expires_at, e.id AS exhibitor_id, e.company_name
       FROM booths b LEFT JOIN booth_assignments a ON a.booth_id = b.id AND a.status IN ('held','confirmed')
       LEFT JOIN exhibitors e ON e.id = a.exhibitor_id WHERE b.event_id = ? ORDER BY b.code`,
      event.id,
    );
    res.json(
      db.all('SELECT * FROM zones WHERE event_id = ? ORDER BY sort, id', event.id).map((z) => ({
        id: z.id,
        code: z.code,
        name: z.name,
        kind: z.kind,
        cols: json(z.plan, {}).cols || 0,
        rows: json(z.plan, {}).rows || 0,
        image: planImageUrl(json(z.plan, {}).image),
        gates: db.all('SELECT id, code, name, x, y FROM gates WHERE zone_id = ? AND active = 1', z.id),
        booths: booths
          .filter((b) => b.zone_id === z.id)
          .map((b) => ({
            id: b.id,
            code: b.code,
            kind: b.kind,
            sizeSqm: b.size_sqm,
            pricePaise: b.price_paise,
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            note: b.note,
            status: b.blocked ? 'blocked' : b.a_status || 'available',
            assignmentId: b.assignment_id,
            holdExpiresAt: b.hold_expires_at,
            exhibitorId: b.exhibitor_id,
            exhibitor: b.company_name,
          })),
      })),
    );
  });

  // ---------- floor plan drawing and stall import ----------
  // Uploads the hall's floor drawing (an image). Visitors and staff see it under the stalls.
  r.post(
    '/org/events/:eid/zones/:zid/plan-image',
    ctx.upload('plans', { maxMb: 12, exts: ['.png', '.jpg', '.jpeg', '.webp'] }).single('file'),
    (req, res) => {
      const event = ev(req, 'floor.manage');
      const zone = owned('zones', event, req.params.zid, 'Hall');
      if (!req.file) fail(400, 'Choose an image of the floor plan (PNG or JPG)');
      const uploadId = db.insert('uploads', {
        event_id: event.id,
        kind: 'plan',
        filename: req.file.originalname.slice(0, 200),
        stored_name: req.file.filename,
        mime: req.file.mimetype,
        size: req.file.size,
        uploaded_by: req.user.id,
        created_at: nowIso(),
      });
      const plan = json(zone.plan, {});
      // When the drawing's proportions are known and the hall has a width, the depth follows it.
      const ratio = num(req.body?.ratio, { min: 0.05, max: 20 });
      const next = { ...plan, image: uploadId };
      let depthKept = false;
      if (ratio && plan.cols) {
        const rows = Math.round(plan.cols * ratio * 10) / 10;
        // Keep the depth when following the drawing would leave stalls outside the hall.
        if (stallOutside(zone.id, plan.cols, rows)) depthKept = true;
        else next.rows = rows;
      }
      db.update('zones', zone.id, { plan: JSON.stringify(next) });
      touchGuide(db, event.id);
      audit(db, req, 'floor.plan_image', { event, entity: 'zone', entityId: zone.id, detail: { file: req.file.originalname } });
      res.status(201).json({ image: planImageUrl(uploadId), cols: next.cols || 0, rows: next.rows || 0, depthKept });
    },
  );
  r.delete('/org/events/:eid/zones/:zid/plan-image', (req, res) => {
    const event = ev(req, 'floor.manage');
    const zone = owned('zones', event, req.params.zid, 'Hall');
    const { image, ...rest } = json(zone.plan, {});
    db.update('zones', zone.id, { plan: JSON.stringify(rest) });
    touchGuide(db, event.id);
    audit(db, req, 'floor.plan_image_removed', { event, entity: 'zone', entityId: zone.id, detail: { upload: image } });
    res.json({ ok: true });
  });

  // Imports a stall list (from a spreadsheet saved as CSV, parsed in the browser). Stalls are
  // matched by code: new codes are added, existing ones updated, others left alone. Nothing is
  // saved unless every row is valid and the finished layout has no overlaps.
  r.post('/org/events/:eid/booths/import', (req, res) => {
    const event = ev(req, 'floor.manage');
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) fail(400, 'The file has no stalls in it');
    if (rows.length > 2000) fail(400, 'Import at most 2,000 stalls at a time');
    const zones = db.all('SELECT * FROM zones WHERE event_id = ?', event.id);
    const findZone = (v) => {
      const k = String(v ?? '')
        .trim()
        .toLowerCase();
      return zones.find((z) => z.code.toLowerCase() === k || z.name.toLowerCase() === k);
    };
    const errors = [];
    const parsed = [];
    const seen = new Set();
    rows.forEach((raw, i) => {
      const line = i + 2; // row 1 is the header in the spreadsheet
      try {
        const zone = findZone(raw.hall);
        if (!zone) fail(400, `Hall "${raw.hall ?? ''}" is not one of: ${zones.map((z) => z.name).join(', ')}`);
        const c = code(raw.code);
        if (seen.has(c)) fail(400, `Stall ${c} appears twice in the file`);
        seen.add(c);
        const w = metres(raw.width, { min: 0.5, max: MAX_STALL_M, required: true, name: 'Width' });
        const h = metres(raw.depth, { min: 0.5, max: MAX_STALL_M, required: true, name: 'Depth' });
        const kind =
          String(raw.type ?? '')
            .trim()
            .toLowerCase() || 'shell';
        if (!['shell', 'raw', 'premium'].includes(kind)) fail(400, 'Type must be shell, raw or premium');
        const price = num(String(raw.price ?? '').replace(/[₹,\s]/g, ''), { min: 0, name: 'Price' });
        parsed.push({
          line,
          row: {
            event_id: event.id,
            code: c,
            zone_id: zone.id,
            kind,
            x: metres(raw.x, { min: 0, max: MAX_HALL_M, required: true, name: 'x' }),
            y: metres(raw.y, { min: 0, max: MAX_HALL_M, required: true, name: 'y' }),
            w,
            h,
            size_sqm: Math.max(1, Math.round(w * h)),
            price_paise: Math.round((price || 0) * 100),
            blocked: ['yes', 'y', 'true', '1'].includes(
              String(raw.blocked ?? '')
                .trim()
                .toLowerCase(),
            ),
            note: str(raw.note, { max: 200 }),
          },
        });
      } catch (e) {
        errors.push({ line, error: e.message });
      }
    });
    if (!errors.length) {
      // Check the finished layout: imported stalls plus the stalls the file does not mention.
      const kept = db.all('SELECT * FROM booths WHERE event_id = ?', event.id).filter((b) => !seen.has(b.code));
      const placed = [...kept];
      for (const p of parsed) {
        const problem = layoutProblem(
          zones.find((z) => z.id === p.row.zone_id),
          p.row,
          placed,
        );
        if (problem) errors.push({ line: p.line, error: problem });
        placed.push(p.row);
      }
    }
    if (errors.length) return res.status(400).json({ error: `${errors.length} row(s) need fixing. Nothing was imported.`, errors });
    let added = 0;
    let updated = 0;
    db.tx(() => {
      for (const { row } of parsed) {
        const existing = db.get('SELECT id FROM booths WHERE event_id = ? AND code = ?', event.id, row.code);
        if (existing) {
          const { event_id: _e, ...patch } = row;
          db.update('booths', existing.id, patch);
          updated++;
        } else {
          db.insert('booths', row);
          added++;
        }
      }
      touchGuide(db, event.id);
      audit(db, req, 'floor.import', { event, detail: { added, updated } });
    });
    res.json({ added, updated });
  });

  // ---------- finance ----------
  r.get('/org/events/:eid/finance', (req, res) => {
    const event = ev(req, 'finance.view');
    const orders = db.all(
      `SELECT o.*, COALESCE(x.company_name, g.name) AS customer, g.ref FROM orders o
       LEFT JOIN exhibitors x ON x.id = o.exhibitor_id LEFT JOIN registrations g ON g.id = o.registration_id
       WHERE o.event_id = ? ORDER BY o.id DESC LIMIT 300`,
      event.id,
    );
    const payments = db.all(
      'SELECT p.*, o.number FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.event_id = ? ORDER BY p.id DESC LIMIT 300',
      event.id,
    );
    res.json({
      canManage: req.orgRole === 'organiser_admin' || req.orgRole === 'finance',
      report: reconciliation(db, event),
      orders: orders.map((o) => ({ ...orderView(db, o), items: undefined, customer: o.customer, ref: o.ref })),
      payments: payments.map((p) => ({
        id: p.id,
        order: p.number,
        provider: p.provider,
        method: p.method,
        amountPaise: p.amount_paise,
        refundedPaise: p.refunded_paise,
        status: p.status,
        statusAt: p.status_at,
        note: p.note,
        reconciled: Boolean(p.reconciled_at),
      })),
    });
  });
  const orderOf = (req, event) => owned('orders', event, req.params.oid, 'Order');
  const paymentOf = (req, event) => owned('payments', event, req.params.pid, 'Payment');
  r.get('/org/events/:eid/orders/:oid/invoice', (req, res) => {
    const event = ev(req, 'finance.view');
    res.json(invoiceData(db, event, orderOf(req, event)));
  });
  r.post('/org/events/:eid/orders/:oid/manual-payment', (req, res) => {
    const event = ev(req, 'finance.manage');
    const p = recordManualPayment(ctx, req, event, orderOf(req, event), {
      amountPaise: num(req.body.amountPaise, { min: 1, int: true, required: true, name: 'Amount' }),
      method: oneOf(req.body.method, ['bank_transfer', 'cheque', 'cash', 'upi'], { required: true, name: 'Method' }),
      note: str(req.body.note, { max: 300, required: true, name: 'Reference or note' }),
    });
    res.status(201).json({ id: p.id });
  });
  r.post('/org/events/:eid/payments/:pid/reconcile', (req, res) => {
    const event = ev(req, 'finance.manage');
    const out = reconcilePayment(ctx, req, event, paymentOf(req, event), {
      status: oneOf(req.body.status, ['captured', 'failed'], { required: true, name: 'Status' }),
      note: str(req.body.note, { max: 300, required: true, name: 'Note' }),
    });
    res.json({ outcome: out.outcome });
  });
  r.post('/org/events/:eid/payments/:pid/refund', (req, res) => {
    const event = ev(req, 'finance.manage');
    recordRefund(ctx, req, event, paymentOf(req, event), {
      amountPaise: num(req.body.amountPaise, { min: 1, int: true, required: true, name: 'Amount' }),
      note: str(req.body.note, { max: 300, required: true, name: 'Note' }),
    });
    res.json({ ok: true });
  });

  // ---------- communications ----------
  r.get('/org/events/:eid/comms', (req, res) => {
    const event = ev(req, 'event.view');
    res.json({
      announcements: db.all('SELECT * FROM announcements WHERE event_id = ? ORDER BY id DESC', event.id).map((a) => camel(a)),
      outbox: db
        .all(
          'SELECT id, channel, adapter, recipient, subject, body, template, status, error, created_at FROM outbox WHERE event_id = ? ORDER BY id DESC LIMIT 100',
          event.id,
        )
        .map((o) => camel(o)),
      adapters: {
        email: adapters.email.label,
        push: adapters.push.label,
        whatsapp: adapters.whatsapp.enabled ? adapters.whatsapp.name : 'Off',
      },
    });
  });
  // Publishes an announcement: it appears in the apps and on displays, and opted-in phones
  // get a notification for schedule and gate changes.
  r.post('/org/events/:eid/announcements', (req, res) => {
    const event = ev(req, 'comms.manage');
    const row = {
      event_id: event.id,
      kind: oneOf(req.body.kind, ['general', 'schedule', 'gate']) || 'general',
      audience: oneOf(req.body.audience, ['all', 'visitors', 'exhibitors', 'staff']) || 'all',
      title: str(req.body.title, { max: 120, required: true, name: 'Title' }),
      body: str(req.body.body, { max: 600, required: true, name: 'Message' }),
      show_on_displays: req.body.showOnDisplays == null ? 1 : bool(req.body.showOnDisplays),
      published_at: nowIso(),
      created_by: req.user.id,
      created_at: nowIso(),
    };
    const aid = db.insert('announcements', row);
    touchGuide(db, event.id);
    audit(db, req, 'announcement.publish', { event, entity: 'announcement', entityId: aid, detail: { title: row.title } });
    if (row.kind !== 'general') {
      const tokens = db
        .all(
          `SELECT DISTINCT t.platform, t.token, t.topics FROM push_tokens t
           WHERE t.user_id IN (SELECT user_id FROM registrations WHERE event_id = ? AND user_id IS NOT NULL
                               UNION SELECT user_id FROM memberships WHERE event_id = ?)`,
          event.id,
          event.id,
        )
        .filter((t) => json(t.topics, []).includes(row.kind));
      adapters.push
        .send({ eventId: event.id, tokens, title: row.title, body: row.body, data: { event: event.slug, kind: row.kind } })
        .catch(() => {});
    }
    res.status(201).json(camel(db.get('SELECT * FROM announcements WHERE id = ?', aid)));
  });
  r.delete('/org/events/:eid/announcements/:aid', (req, res) => {
    const event = ev(req, 'comms.manage');
    db.run('DELETE FROM announcements WHERE id = ?', owned('announcements', event, req.params.aid, 'Announcement').id);
    touchGuide(db, event.id);
    res.json({ ok: true });
  });

  // ---------- staff ----------
  const STAFF_ROLES = [...ORG_ROLES, ...GATE_ROLES];
  r.get('/org/events/:eid/staff', (req, res) => {
    const event = ev(req, 'event.view');
    res.json(
      db
        .all(
          `SELECT m.id, m.role, m.gate_id, m.event_id, u.name, u.email, u.last_login, g.name AS gate_name FROM memberships m
           JOIN users u ON u.id = m.user_id LEFT JOIN gates g ON g.id = m.gate_id
           WHERE m.organiser_id = ? AND (m.event_id IS NULL OR m.event_id = ?) AND m.status = 'active' AND m.exhibitor_id IS NULL ORDER BY m.role, u.name`,
          event.organiser_id,
          event.id,
        )
        .map((m) => camel(m)),
    );
  });
  r.post('/org/events/:eid/staff', (req, res) => {
    const event = ev(req, 'staff.manage');
    const role = oneOf(req.body.role, STAFF_ROLES, { required: true, name: 'Role' });
    const email = vEmail(req.body.email, { required: true });
    const name = str(req.body.name, { max: 120, required: true, name: 'Name' });
    const gate = role === 'gate_staff' ? owned('gates', event, req.body.gateId, 'Gate') : null;
    const userId = findOrCreateUser(db, { email, name });
    if (req.body.password) {
      checkPasswordStrength(req.body.password);
      db.update('users', userId, { password_hash: hashPassword(req.body.password) });
    }
    db.run(
      `INSERT INTO memberships (user_id, organiser_id, event_id, role, gate_id, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, COALESCE(event_id, 0), role, COALESCE(exhibitor_id, 0)) DO UPDATE SET status = 'active', gate_id = excluded.gate_id`,
      userId,
      event.organiser_id,
      event.id,
      role,
      gate?.id ?? null,
      nowIso(),
    );
    audit(db, req, 'staff.add', { event, entity: 'user', entityId: userId, detail: { email, role, gate: gate?.name } });
    mail.staffInvite(ctx, event, email, name, role.replace(/_/g, ' '));
    res.status(201).json({ ok: true });
  });
  r.delete('/org/events/:eid/staff/:mid', (req, res) => {
    const event = ev(req, 'staff.manage');
    const m = db.get(
      "SELECT * FROM memberships WHERE id = ? AND organiser_id = ? AND exhibitor_id IS NULL AND status = 'active'",
      id(req.params.mid),
      event.organiser_id,
    );
    if (!m) fail(404, 'Staff member not found');
    if (m.user_id === req.user.id) fail(409, 'You cannot remove your own access');
    db.update('memberships', m.id, { status: 'revoked' });
    // Their devices are revoked too, so cached eligibility data is purged on next contact.
    db.run(
      "UPDATE devices SET status = 'revoked', revoked_at = ? WHERE user_id = ? AND event_id = ? AND status = 'active'",
      nowIso(),
      m.user_id,
      event.id,
    );
    destroyUserSessions(db, m.user_id);
    audit(db, req, 'staff.remove', { event, entity: 'user', entityId: m.user_id, detail: { role: m.role } });
    res.json({ ok: true });
  });

  // ---------- reports ----------
  r.get('/org/events/:eid/reports', (req, res) => {
    const event = ev(req, 'reports.view');
    const all = (sql, ...p) => db.all(sql, event.id, ...p);
    const entries = all('SELECT s.scanned_at, s.zone_id FROM scan_events s WHERE s.event_id = ? AND s.counted = 1');
    const byDay = {};
    const byHour = {};
    const today = ymdIn(event.timezone);
    const hour = new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone, hour: '2-digit', hour12: false });
    for (const e of entries) {
      const d = ymdIn(event.timezone, e.scanned_at);
      byDay[d] = (byDay[d] || 0) + 1;
      if (d === today) {
        const h = `${hour.format(new Date(e.scanned_at))}:00`;
        byHour[h] = (byHour[h] || 0) + 1;
      }
    }
    res.json({
      definitions: {
        registered: 'Registrations that are confirmed or awaiting review. Unverified, rejected and cancelled registrations are excluded.',
        uniqueEntries: 'Passes admitted at least once. A pass counts once however many times or gates it was scanned at.',
        zoneEntries: 'First admission of a pass to an area on a day. One person entering two halls counts once in each.',
        leads: 'Distinct visitors captured by an exhibitor. Repeat scans of the same visitor count once.',
      },
      registrationsByPass: all(
        "SELECT c.name, COUNT(*) AS registered, SUM(r.status = 'confirmed') AS confirmed FROM registrations r JOIN pass_classes c ON c.id = r.pass_class_id WHERE r.event_id = ? AND r.status IN ('pending_review','confirmed') GROUP BY c.id ORDER BY registered DESC",
      ),
      uniqueEntries: db.value('SELECT COUNT(DISTINCT pass_id) FROM scan_events WHERE event_id = ? AND counted = 1', event.id),
      zoneEntriesByDay: Object.entries(byDay)
        .sort()
        .map(([day, count]) => ({ day, count })),
      entriesByHourToday: Object.entries(byHour)
        .sort()
        .map(([hour, count]) => ({ hour, count })),
      entriesByZone: all(
        'SELECT z.name, COUNT(*) AS count FROM scan_events s JOIN zones z ON z.id = s.zone_id WHERE s.event_id = ? AND s.counted = 1 GROUP BY z.id ORDER BY count DESC',
      ),
      scanOutcomes: all('SELECT result, COUNT(*) AS count FROM scan_events WHERE event_id = ? GROUP BY result ORDER BY count DESC'),
      leadsByExhibitor: all(
        'SELECT e.company_name AS name, COUNT(*) AS count FROM leads l JOIN exhibitors e ON e.id = l.exhibitor_id WHERE l.event_id = ? GROUP BY e.id ORDER BY count DESC',
      ),
      leadExports: all(
        'SELECT x.created_at, x.row_count, e.company_name AS company, u.name AS by FROM lead_exports x JOIN exhibitors e ON e.id = x.exhibitor_id JOIN users u ON u.id = x.user_id WHERE x.event_id = ? ORDER BY x.id DESC LIMIT 50',
      ).map((x) => camel(x)),
    });
  });
  const REPORTS = {
    admissions: {
      perm: 'reports.view',
      headers: ['Pass holder', 'Company', 'Pass type', 'Area', 'Gate', 'Admitted at', 'Mode'],
      sql: `SELECT p.holder_name, p.holder_company, c.name AS cls, z.name AS zone, g.name AS gate, s.scanned_at, s.mode FROM scan_events s
            JOIN passes p ON p.id = s.pass_id JOIN pass_classes c ON c.id = p.pass_class_id JOIN zones z ON z.id = s.zone_id JOIN gates g ON g.id = s.gate_id
            WHERE s.event_id = ? AND s.counted = 1 ORDER BY s.scanned_at`,
    },
    scans: {
      perm: 'reports.view',
      headers: [
        'Scan id',
        'Scanned at',
        'Gate',
        'Device',
        'Mode',
        'Method',
        'Result',
        'Shown on device',
        'Counted',
        'Conflict',
        'Pass holder',
        'Override reason',
      ],
      sql: `SELECT s.id, s.scanned_at, g.name AS gate, d.name AS device, s.mode, s.method, s.result, s.device_result, s.counted, s.conflict, p.holder_name, s.override_reason FROM scan_events s
            JOIN gates g ON g.id = s.gate_id LEFT JOIN devices d ON d.id = s.device_id LEFT JOIN passes p ON p.id = s.pass_id WHERE s.event_id = ? ORDER BY s.scanned_at`,
    },
    exhibitors: {
      perm: 'reports.view',
      headers: ['Company', 'Industry', 'Status', 'Contact', 'Email', 'Phone', 'Booth', 'Booth status', 'Badges', 'Leads captured'],
      sql: `SELECT e.company_name, e.industry, e.status, e.contact_name, e.contact_email, e.contact_phone, b.code, a.status AS booth_status,
              (SELECT COUNT(*) FROM team_badges t WHERE t.exhibitor_id = e.id AND t.status != 'revoked') AS badges,
              (SELECT COUNT(*) FROM leads l WHERE l.exhibitor_id = e.id) AS leads
            FROM exhibitors e LEFT JOIN booth_assignments a ON a.exhibitor_id = e.id AND a.status IN ('held','confirmed') LEFT JOIN booths b ON b.id = a.booth_id
            WHERE e.event_id = ? AND e.status != 'draft' ORDER BY e.company_name`,
    },
    booths: {
      perm: 'reports.view',
      headers: ['Booth', 'Hall', 'Type', 'Size (sq m)', 'Price (INR)', 'Status', 'Exhibitor'],
      sql: `SELECT b.code, z.name AS hall, b.kind, b.size_sqm, b.price_paise / 100.0 AS price, CASE WHEN b.blocked THEN 'blocked' ELSE COALESCE(a.status, 'available') END AS status, e.company_name
            FROM booths b JOIN zones z ON z.id = b.zone_id LEFT JOIN booth_assignments a ON a.booth_id = b.id AND a.status IN ('held','confirmed') LEFT JOIN exhibitors e ON e.id = a.exhibitor_id
            WHERE b.event_id = ? ORDER BY b.code`,
    },
    orders: {
      perm: 'reports.finance',
      headers: [
        'Order',
        'Invoice',
        'Type',
        'Customer',
        'Status',
        'Subtotal (INR)',
        'GST (INR)',
        'Total (INR)',
        'Paid (INR)',
        'Refunded (INR)',
        'Created',
      ],
      sql: `SELECT o.number, o.invoice_no, o.kind, COALESCE(x.company_name, g.name) AS customer, o.status, o.subtotal_paise / 100.0, o.gst_paise / 100.0, o.total_paise / 100.0, o.paid_paise / 100.0, o.refunded_paise / 100.0, o.created_at
            FROM orders o LEFT JOIN exhibitors x ON x.id = o.exhibitor_id LEFT JOIN registrations g ON g.id = o.registration_id WHERE o.event_id = ? ORDER BY o.id`,
    },
    payments: {
      perm: 'reports.finance',
      headers: [
        'Order',
        'Provider',
        'Reference',
        'Method',
        'Amount (INR)',
        'Refunded (INR)',
        'Status',
        'Status at',
        'Reconciled by hand',
        'Note',
      ],
      sql: `SELECT o.number, p.provider, p.intent_id, p.method, p.amount_paise / 100.0, p.refunded_paise / 100.0, p.status, p.status_at, CASE WHEN p.reconciled_at IS NULL THEN 'no' ELSE 'yes' END, p.note
            FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.event_id = ? ORDER BY p.id`,
    },
  };
  r.get('/org/events/:eid/reports/:name.csv', (req, res) => {
    const report = REPORTS[req.params.name];
    if (!report) fail(404, 'Report not found');
    const event = ev(req, report.perm);
    const rows = db.all(report.sql, event.id).map((x) => Object.values(x));
    audit(db, req, 'report.export', { event, detail: { report: req.params.name, rows: rows.length } });
    sendCsv(res, `${req.params.name}-${event.slug}.csv`, report.headers, rows);
  });

  r.get('/org/events/:eid/audit', (req, res) => {
    const event = ev(req, 'event.view');
    if (req.orgRole !== 'organiser_admin' && req.orgRole !== 'finance') fail(403, 'Your role does not allow this action');
    const { pageSize, offset } = paging(req.query, { size: 100 });
    res.json(
      db
        .all(
          'SELECT id, actor, action, entity, entity_id, detail, created_at FROM audit_log WHERE event_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
          event.id,
          pageSize,
          offset,
        )
        .map((a) => ({ ...camel(a), detail: json(a.detail, null) })),
    );
  });

  // Retention: once the configured period after the event has passed, an administrator can
  // remove personal data. Counts and money totals remain; names and contacts do not.
  r.post('/org/events/:eid/purge', (req, res) => {
    const event = ev(req, 'data.purge');
    const unlocks = addDays(event.ends_on, eventSettings(event).retentionDays);
    if (ymdIn(event.timezone) <= unlocks) fail(409, `Personal data can be removed after ${unlocks}`);
    db.tx(() => {
      db.run(
        "UPDATE registrations SET name = 'Removed', email = 'removed-' || id || '@invalid', phone = NULL, company = NULL, job_title = NULL, answers = '{}', access_hash = NULL WHERE event_id = ?",
        event.id,
      );
      db.run("UPDATE passes SET holder_name = 'Removed', holder_company = NULL WHERE event_id = ?", event.id);
      db.run("UPDATE leads SET shared = '{}', notes = NULL WHERE event_id = ?", event.id);
      db.run("UPDATE team_badges SET name = 'Removed', email = 'removed-' || id || '@invalid' WHERE event_id = ?", event.id);
      db.run('DELETE FROM outbox WHERE event_id = ?', event.id);
      audit(db, req, 'data.purge', { event, entity: 'event', entityId: event.id });
    });
    res.json({ ok: true });
  });

  return r;
}
