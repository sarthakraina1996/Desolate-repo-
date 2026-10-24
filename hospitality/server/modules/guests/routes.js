// Guest profiles, identity verification, data export / erasure, companies and agents.
import { str, int, email, oneOf, bool, money, date } from '../../core/validate.js';
import { perm } from '../../core/http.js';
import { notFound } from '../../core/errors.js';
import { propertyIds, inList } from '../../core/access.js';
import { can } from '../../core/permissions.js';
import { anonymizeGuest, exportGuest, presentGuest, saveCompany, saveGuest, searchGuests, verifyIdentity } from './service.js';

export function guestInput(b = {}) {
  const out = {};
  for (const k of ['title', 'first_name', 'last_name', 'phone', 'gender', 'nationality', 'country', 'city', 'vip', 'loyalty_no'])
    if (b[k] !== undefined) out[k] = str(b[k], { max: 80, name: k.replace('_', ' ') }) ?? (k === 'vip' ? '' : null);
  if (b.email !== undefined) out.email = email(b.email);
  if (b.address !== undefined) out.address = str(b.address, { max: 300 });
  if (b.notes !== undefined) out.notes = str(b.notes, { max: 2000 });
  if (b.dob !== undefined) out.dob = date(b.dob, { name: 'Date of birth' });
  if (b.company_id !== undefined) out.company_id = b.company_id ? int(b.company_id, { min: 1 }) : null;
  if (b.marketing_consent !== undefined) out.marketing_consent = bool(b.marketing_consent) ? 1 : 0;
  if (b.preferences !== undefined) out.preferences = (b.preferences || []).slice(0, 30).map((p) => str(p, { max: 80 }));
  return out;
}

export default function guestRoutes(r, { db }) {
  r.get('/guests', perm('guests.view'), (req, res) => {
    const out = searchGuests(db, req.user.orgId, {
      q: str(req.query.q, { max: 80 }),
      limit: int(req.query.limit, { min: 1, max: 100 }) || 25,
      offset: int(req.query.offset, { min: 0 }) || 0,
    });
    res.json({ ...out, rows: out.rows.map((g) => presentGuest(g, req.user)) });
  });

  r.get('/guests/:id', perm('guests.view'), (req, res) => {
    const g = db.get('SELECT g.*, c.name AS company_name FROM guests g LEFT JOIN companies c ON c.id = g.company_id WHERE g.id = ? AND g.org_id = ?', int(req.params.id, { min: 1 }), req.user.orgId);
    if (!g) notFound('Guest');
    const pids = propertyIds(db, req.user);
    const stays = db.all(
      `SELECT r.id, r.conf_no, r.status, r.arrival, r.departure, r.adults, r.children, r.total_minor, r.currency, p.code AS property_code,
              p.name AS property_name, t.name AS room_type_name,
              (SELECT rm.number FROM room_nights x JOIN rooms rm ON rm.id = x.room_id WHERE x.reservation_id = r.id ORDER BY x.night LIMIT 1) AS room_number
       FROM reservations r JOIN properties p ON p.id = r.property_id JOIN room_types t ON t.id = r.room_type_id
       WHERE r.guest_id = ? AND r.property_id IN ${inList(pids)} ORDER BY r.arrival DESC LIMIT 100`,
      g.id,
      ...pids,
    );
    const spend = can(req.user, 'folio.view')
      ? db.all(
          `SELECT fp.currency, fp.department, SUM(fp.net_minor) AS net_minor FROM folio_postings fp
           WHERE fp.guest_id = ? AND fp.property_id IN ${inList(pids)} AND fp.department IS NOT NULL GROUP BY fp.currency, fp.department`,
          g.id,
          ...pids,
        )
      : null;
    res.json({ guest: presentGuest(g, req.user), stays, spend });
  });

  r.post('/guests', perm('guests.manage'), (req, res) =>
    res.status(201).json(presentGuest(saveGuest(db, req.user, req.user.orgId, guestInput(req.body)), req.user)),
  );
  r.put('/guests/:id', perm('guests.manage'), (req, res) =>
    res.json(presentGuest(saveGuest(db, req.user, req.user.orgId, guestInput(req.body), int(req.params.id, { min: 1 })), req.user)),
  );
  r.post('/guests/:id/identity', perm('frontdesk.operate'), (req, res) => {
    const id = int(req.params.id, { min: 1 });
    if (!db.value('SELECT 1 FROM guests WHERE id = ? AND org_id = ?', id, req.user.orgId)) notFound('Guest');
    verifyIdentity(db, req.user, id, {
      idType: oneOf(req.body?.idType, ['passport', 'aadhaar', 'driving_licence', 'voter_id', 'national_id', 'other'], { required: true, name: 'Document type' }),
      idNumber: str(req.body?.idNumber, { required: true, max: 40, name: 'Document number' }),
      idCountry: str(req.body?.idCountry, { max: 2 }),
    });
    res.json(presentGuest(db.get('SELECT * FROM guests WHERE id = ?', id), req.user));
  });
  r.get('/guests/:id/export', perm('guests.pii'), (req, res) => {
    const data = exportGuest(db, req.user.orgId, int(req.params.id, { min: 1 }));
    res.setHeader('Content-Disposition', `attachment; filename="guest-${req.params.id}-export.json"`);
    res.json(data);
  });
  r.post('/guests/:id/erase', perm('guests.pii', 'guests.manage'), (req, res) =>
    res.json(anonymizeGuest(db, req.user, req.user.orgId, int(req.params.id, { min: 1 }), str(req.body?.reason, { required: true, max: 300, name: 'Reason' }))),
  );

  // ---------- companies, travel agents, OTAs ----------
  const companyInput = (b = {}, currency = 'INR') => {
    const out = {};
    if (b.kind !== undefined) out.kind = oneOf(b.kind, ['corporate', 'travel_agent', 'ota', 'government'], { required: true, name: 'Type' });
    for (const k of ['name', 'tax_id', 'address', 'city', 'country', 'phone', 'contact_name', 'notes']) if (b[k] !== undefined) out[k] = str(b[k], { max: 300, name: k });
    if (b.email !== undefined) out.email = email(b.email);
    if (b.ar_enabled !== undefined) out.ar_enabled = bool(b.ar_enabled) ? 1 : 0;
    if (b.credit_limit !== undefined) out.credit_limit_minor = money(b.credit_limit, currency) ?? 0;
    if (b.credit_days !== undefined) out.credit_days = int(b.credit_days, { min: 0, max: 365 });
    if (b.commission_bp !== undefined) out.commission_bp = int(b.commission_bp, { min: 0, max: 5000 });
    if (b.active !== undefined) out.active = bool(b.active) ? 1 : 0;
    return out;
  };

  r.get('/companies', perm('guests.view'), (req, res) => {
    const pids = propertyIds(db, req.user);
    res.json(
      db.all(
        `SELECT c.*, (SELECT COALESCE(SUM(p.amount_minor), 0) FROM folio_postings p JOIN folios f ON f.id = p.folio_id
                      WHERE f.company_id = c.id AND f.kind = 'company' AND f.property_id IN ${inList(pids)}) AS ar_balance_minor
         FROM companies c WHERE c.org_id = ? ORDER BY c.kind, c.name`,
        ...pids,
        req.user.orgId,
      ),
    );
  });
  r.post('/companies', perm('guests.manage'), (req, res) => res.status(201).json(saveCompany(db, req.user, req.user.orgId, companyInput(req.body, req.user.reportingCurrency))));
  r.put('/companies/:id', perm('guests.manage'), (req, res) => res.json(saveCompany(db, req.user, req.user.orgId, companyInput(req.body, req.user.reportingCurrency), int(req.params.id, { min: 1 }))));
}
