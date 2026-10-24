// Guest profiles (organisation-wide, shared by its properties), companies / travel agents,
// identity-document capture (masked), consent, data export and erasure.
import { stamp } from '../../core/clock.js';
import { fail, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { json } from '../../db/connection.js';
import { can } from '../../core/permissions.js';

const GUEST_FIELDS = [
  'title',
  'first_name',
  'last_name',
  'email',
  'phone',
  'gender',
  'dob',
  'nationality',
  'country',
  'city',
  'address',
  'company_id',
  'vip',
  'loyalty_no',
  'notes',
  'marketing_consent',
];

// Keeps the last four characters of an identity document number: "XXXX-XXXX-1234".
export function maskId(number) {
  const s = String(number || '').replace(/\s/g, '');
  if (!s) return null;
  const tail = s.slice(-4);
  return `${'•'.repeat(Math.max(4, s.length - 4))}${tail}`;
}

export function maskEmail(e) {
  if (!e) return e;
  const [user, domain] = e.split('@');
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, user.length - 1))}@${domain}`;
}
export function maskPhone(p) {
  if (!p) return p;
  const digits = p.replace(/\D/g, '');
  return `${'•'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

// What a user may see of a guest: contact details and DOB only with guests.pii.
export function presentGuest(g, user) {
  if (!g) return g;
  const out = { ...g, preferences: json(g.preferences, []) };
  if (!can(user, 'guests.pii')) {
    out.email = maskEmail(g.email);
    out.phone = maskPhone(g.phone);
    out.dob = null;
    out.address = null;
    out.pii_masked = true;
  }
  return out;
}

export function saveGuest(db, actor, orgId, input, id = null) {
  return db.tx(() => {
    const row = {};
    for (const f of GUEST_FIELDS) if (input[f] !== undefined) row[f] = input[f];
    if (input.preferences !== undefined) row.preferences = JSON.stringify(input.preferences || []);
    if (row.company_id && !db.value('SELECT 1 FROM companies WHERE id = ? AND org_id = ?', row.company_id, orgId))
      fail(400, 'Company not found');
    if (row.marketing_consent !== undefined) row.consent_at = stamp(actor);
    let guestId = id;
    let before = null;
    if (id) {
      before = db.get('SELECT * FROM guests WHERE id = ? AND org_id = ?', id, orgId);
      if (!before) notFound('Guest');
      if (before.anonymized_at) fail(400, 'This profile was erased and cannot be edited');
      db.update('guests', id, { ...row, updated_at: stamp(actor) });
    } else {
      if (!row.first_name) fail(400, 'First name is required');
      guestId = db.insert('guests', { ...row, org_id: orgId });
    }
    const after = db.get('SELECT * FROM guests WHERE id = ?', guestId);
    audit(db, actor, id ? 'guest.update' : 'guest.create', { entity: 'guest', entityId: guestId, before, after });
    emit(db, { entity: 'guest', entityUid: after.uid, op: id ? 'update' : 'create', payload: { id: guestId } });
    return after;
  });
}

// Records the identity document checked at the desk; only a masked number is stored.
export function verifyIdentity(db, actor, guestId, { idType, idNumber, idCountry }) {
  if (!idType || !idNumber) fail(400, 'Document type and number are required');
  db.run(
    `UPDATE guests SET id_type = ?, id_number_masked = ?, id_country = ?, id_verified_at = ?, id_verified_by = ?,
       updated_at = ? WHERE id = ?`,
    idType,
    maskId(idNumber),
    idCountry ?? null,
    stamp(actor),
    actor?.id ?? null,
    stamp(actor),
    guestId,
  );
  audit(db, actor, 'guest.id_verified', { entity: 'guest', entityId: guestId, after: { idType, idCountry } });
}

export function searchGuests(db, orgId, { q, limit = 25, offset = 0 } = {}) {
  const params = [orgId];
  let where = 'g.org_id = ? AND g.anonymized_at IS NULL';
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    where += ` AND (g.first_name || ' ' || g.last_name LIKE ? OR g.email LIKE ? OR g.phone LIKE ? OR g.loyalty_no LIKE ?)`;
    params.push(like, like, like, like);
  }
  const total = db.value(`SELECT COUNT(*) FROM guests g WHERE ${where}`, ...params);
  const rows = db.all(
    `SELECT g.*, c.name AS company_name,
       (SELECT COUNT(*) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_out','closed')) AS stays,
       (SELECT MAX(r.departure) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_out','closed')) AS last_stay
     FROM guests g LEFT JOIN companies c ON c.id = g.company_id
     WHERE ${where} ORDER BY g.last_name, g.first_name LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return { total, rows };
}

// Data-subject export: profile, stays and folio charges (for access requests).
export function exportGuest(db, orgId, guestId) {
  const guest = db.get('SELECT * FROM guests WHERE id = ? AND org_id = ?', guestId, orgId);
  if (!guest) notFound('Guest');
  return {
    exportedAt: new Date().toISOString(),
    profile: { ...guest, preferences: json(guest.preferences, []) },
    reservations: db.all(
      `SELECT r.conf_no, p.name AS property, r.arrival, r.departure, r.status, r.adults, r.children
       FROM reservations r JOIN properties p ON p.id = r.property_id WHERE r.guest_id = ? ORDER BY r.arrival`,
      guestId,
    ),
    charges: db.all(
      `SELECT fp.business_date, fp.description, fp.amount_minor, fp.currency FROM folio_postings fp
       WHERE fp.guest_id = ? ORDER BY fp.id`,
      guestId,
    ),
  };
}

// Erasure: personal data is removed; reservations and financial records stay (legal retention)
// but now point at an anonymous profile.
export function anonymizeGuest(db, actor, orgId, guestId, reason) {
  return db.tx(() => {
    const g = db.get('SELECT * FROM guests WHERE id = ? AND org_id = ?', guestId, orgId);
    if (!g) notFound('Guest');
    if (g.anonymized_at) fail(400, 'Already erased');
    const active = db.value(
      "SELECT COUNT(*) FROM reservations WHERE guest_id = ? AND status IN ('confirmed','in_house')",
      guestId,
    );
    if (active) fail(409, 'The guest has an upcoming or current stay; erase after departure');
    db.update('guests', guestId, {
      title: null,
      first_name: 'Erased',
      last_name: 'guest',
      email: null,
      phone: null,
      gender: null,
      dob: null,
      nationality: null,
      city: null,
      address: null,
      loyalty_no: null,
      preferences: '[]',
      notes: null,
      id_type: null,
      id_number_masked: null,
      id_country: null,
      marketing_consent: 0,
      anonymized_at: stamp(actor),
      updated_at: stamp(actor),
    });
    audit(db, actor, 'guest.erased', { entity: 'guest', entityId: guestId, after: { reason } });
    emit(db, { entity: 'guest', entityUid: g.uid, op: 'erase', payload: { reason } });
    return { ok: true };
  });
}

const COMPANY_FIELDS = [
  'kind',
  'name',
  'tax_id',
  'address',
  'city',
  'country',
  'email',
  'phone',
  'contact_name',
  'ar_enabled',
  'credit_limit_minor',
  'credit_days',
  'commission_bp',
  'notes',
  'active',
];

export function saveCompany(db, actor, orgId, input, id = null) {
  return db.tx(() => {
    const row = {};
    for (const f of COMPANY_FIELDS) if (input[f] !== undefined) row[f] = input[f];
    let cid = id;
    if (id) {
      if (!db.value('SELECT 1 FROM companies WHERE id = ? AND org_id = ?', id, orgId)) notFound('Company');
      db.update('companies', id, row);
    } else {
      if (!row.name || !row.kind) fail(400, 'Company name and kind are required');
      cid = db.insert('companies', { ...row, org_id: orgId });
    }
    const after = db.get('SELECT * FROM companies WHERE id = ?', cid);
    audit(db, actor, id ? 'company.update' : 'company.create', { entity: 'company', entityId: cid, after });
    emit(db, { entity: 'company', entityUid: after.uid, op: id ? 'update' : 'create', payload: after });
    return after;
  });
}
