// Folios: view, charges, payments, refunds, reversals, allowances, transfers, routing,
// city ledger, invoices and closing.
import { fail } from '../../core/errors.js';
import { str, int, money, oneOf } from '../../core/validate.js';
import { perm, propertyOf } from '../../core/http.js';
import { scopedRow, propertyScope, inList } from '../../core/access.js';
import { can } from '../../core/permissions.js';
import { completeSettlement } from '../frontdesk/service.js';
import {
  addFolioWindow,
  closeFolio,
  folioDetail,
  issueInvoice,
  postAllowance,
  postCharge,
  postPayment,
  presentInvoice,
  reversePosting,
  setRoute,
  transferBalanceToCompany,
  transferPostings,
} from './service.js';

const folioRow = (db, req) => scopedRow(db, req.user, 'folios', int(req.params.id, { min: 1 }), 'Folio');

export default function folioRoutes(r, { db }) {
  r.get('/folios/:id', perm('folio.view'), (req, res) => {
    const f = folioRow(db, req);
    const detail = folioDetail(db, f.id);
    const prop = db.get('SELECT id, name, currency, locale, business_date, tax_regime FROM properties WHERE id = ?', f.property_id);
    const guest = f.guest_id ? db.get('SELECT id, first_name, last_name, vip FROM guests WHERE id = ?', f.guest_id) : null;
    const siblings = f.reservation_id
      ? db.all('SELECT id, folio_no, folio_window, name, status FROM folios WHERE reservation_id = ? ORDER BY folio_window', f.reservation_id)
      : [];
    res.json({
      ...detail,
      property: prop,
      guest,
      siblings,
      chargeCodes: db.all('SELECT code, name, department, category, manual FROM charge_codes WHERE property_id = ? AND active = 1 ORDER BY department, code', f.property_id),
      paymentMethods: db.all("SELECT code, name, kind FROM payment_methods WHERE property_id = ? AND active = 1 AND kind <> 'city_ledger'", f.property_id),
    });
  });

  r.get('/reservations/:id/folios', perm('folio.view'), (req, res) => {
    const resRow = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    res.json(db.all('SELECT * FROM folios WHERE reservation_id = ? ORDER BY folio_window', resRow.id));
  });
  r.post('/reservations/:id/folios', perm('folio.post'), (req, res) => {
    const resRow = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    res.status(201).json(addFolioWindow(db, req.user, resRow.id, { companyId: req.body?.companyId ? int(req.body.companyId, { min: 1 }) : null, name: str(req.body?.name, { max: 120 }) }));
  });
  r.post('/reservations/:id/routes', perm('folio.transfer'), (req, res) => {
    const resRow = scopedRow(db, req.user, 'reservations', int(req.params.id, { min: 1 }), 'Reservation');
    const target = scopedRow(db, req.user, 'folios', int(req.body?.targetFolioId, { required: true, min: 1 }), 'Folio');
    setRoute(db, req.user, resRow.id, oneOf(req.body?.department, ['*', 'rooms', 'fnb', 'banquets', 'spa', 'other', 'misc'], { required: true, name: 'Department' }), target.id);
    res.json(folioDetail(db, target.id).routes);
  });

  r.post('/folios/:id/charges', perm('folio.post'), (req, res) => {
    const f = folioRow(db, req);
    const code = str(req.body?.chargeCode, { required: true, max: 20, name: 'Charge code' });
    const cc = db.get('SELECT * FROM charge_codes WHERE property_id = ? AND code = ?', f.property_id, code);
    if (!cc) fail(400, 'Unknown charge code');
    if (!cc.manual && !can(req.user, 'folio.adjust')) fail(403, `${cc.name} is posted automatically; a manager can post it manually`, { code: 'forbidden' });
    const quantity = Number(req.body?.quantity ?? 1);
    if (!(quantity > 0 && quantity <= 1000)) fail(400, 'Quantity is invalid');
    res.status(201).json(
      postCharge(db, req.user, {
        folioId: f.id,
        chargeCode: code,
        unitMinor: money(req.body?.amount, f.currency, { required: true, name: 'Amount' }),
        quantity,
        description: str(req.body?.description, { max: 200 }),
        note: str(req.body?.note, { max: 300 }),
        source: 'manual',
        dedupeKey: req.idempotencyKey ? `idem:${req.user.id}:${req.idempotencyKey}` : null,
      }),
    );
  });

  r.post('/folios/:id/payments', perm('folio.payment'), (req, res) => {
    const f = folioRow(db, req);
    const b = req.body || {};
    res.status(201).json(
      postPayment(db, req.user, {
        folioId: f.id,
        method: str(b.method, { required: true, max: 10, name: 'Method' }),
        amountMinor: money(b.amount, f.currency, { required: true, name: 'Amount', min: 1 }),
        reference: str(b.reference, { max: 80 }),
        cardLast4: str(b.cardLast4, { max: 4 }),
        origCurrency: str(b.origCurrency, { max: 3 }),
        origAmountMinor: b.origAmount ? money(b.origAmount, b.origCurrency || f.currency) : null,
        fxRateMicros: b.fxRate ? Math.round(Number(b.fxRate) * 1e6) : null,
        source: 'manual',
        dedupeKey: req.idempotencyKey ? `idem:${req.user.id}:${req.idempotencyKey}` : null,
      }),
    );
  });
  r.post('/folios/:id/refunds', perm('folio.adjust'), (req, res) => {
    const f = folioRow(db, req);
    res.status(201).json(
      postPayment(db, req.user, {
        folioId: f.id,
        kind: 'refund',
        method: str(req.body?.method, { required: true, max: 10 }),
        amountMinor: money(req.body?.amount, f.currency, { required: true, min: 1 }),
        reference: str(req.body?.reference, { max: 80 }),
        dedupeKey: req.idempotencyKey ? `idem:${req.user.id}:${req.idempotencyKey}` : null,
      }),
    );
  });
  r.post('/postings/:id/reverse', perm('folio.adjust'), (req, res) => {
    const p = scopedRow(db, req.user, 'folio_postings', int(req.params.id, { min: 1 }), 'Posting');
    res.status(201).json(reversePosting(db, req.user, p.id, str(req.body?.reason, { required: true, max: 300, name: 'Reason' })));
  });
  r.post('/folios/:id/allowances', perm('folio.adjust'), (req, res) => {
    const f = folioRow(db, req);
    res.status(201).json(
      postAllowance(db, req.user, {
        folioId: f.id,
        chargeCode: str(req.body?.chargeCode, { required: true, max: 20 }),
        amountMinor: money(req.body?.amount, f.currency, { required: true, min: 1 }),
        reason: str(req.body?.reason, { required: true, max: 300, name: 'Reason' }),
      }),
    );
  });
  r.post('/postings/transfer', perm('folio.transfer'), (req, res) => {
    const target = scopedRow(db, req.user, 'folios', int(req.body?.targetFolioId, { required: true, min: 1 }), 'Folio');
    const ids = (req.body?.postingIds || []).map((x) => int(x, { min: 1 }));
    if (!ids.length) fail(400, 'Choose postings to transfer');
    for (const pid of ids) scopedRow(db, req.user, 'folio_postings', pid, 'Posting');
    res.json(transferPostings(db, req.user, ids, target.id, str(req.body?.reason, { required: true, max: 300, name: 'Reason' })));
  });
  r.post('/folios/:id/city-ledger', perm('folio.transfer'), (req, res) => {
    const f = folioRow(db, req);
    res.json(transferBalanceToCompany(db, req.user, f.id, int(req.body?.companyId, { required: true, min: 1, name: 'Company' }), { reason: str(req.body?.reason, { max: 300 }) || 'Bill to company' }));
  });
  r.post('/folios/:id/invoice', perm('invoice.issue'), (req, res) => {
    const f = folioRow(db, req);
    const b = req.body || {};
    res.status(201).json(issueInvoice(db, req.user, f.id, { name: str(b.name, { max: 160 }), address: str(b.address, { max: 400 }), taxId: str(b.taxId, { max: 30 }), companyId: b.companyId ? int(b.companyId, { min: 1 }) : null }));
  });
  r.post('/folios/:id/close', perm('folio.payment'), (req, res) => {
    const f = folioRow(db, req);
    const closed = closeFolio(db, req.user, f.id);
    if (f.reservation_id) completeSettlement(db, req.user, f.reservation_id);
    res.json(closed);
  });

  r.get('/invoices', perm('folio.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    const limit = int(req.query.limit, { min: 1, max: 200 }) || 50;
    const offset = int(req.query.offset, { min: 0 }) || 0;
    res.json({
      total: db.value(`SELECT COUNT(*) FROM invoices WHERE property_id IN ${inList(pids)}`, ...pids),
      rows: db.all(
        `SELECT i.id, i.invoice_no, i.kind, i.issue_date, i.bill_to_name, i.currency, i.net_minor, i.tax_minor, i.gross_minor, i.paid_minor,
                f.folio_no, p.code AS property_code
         FROM invoices i JOIN folios f ON f.id = i.folio_id JOIN properties p ON p.id = i.property_id
         WHERE i.property_id IN ${inList(pids)} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
        ...pids,
        limit,
        offset,
      ),
    });
  });
  r.get('/invoices/:id', perm('folio.view'), (req, res) => {
    const inv = scopedRow(db, req.user, 'invoices', int(req.params.id, { min: 1 }), 'Invoice');
    const prop = db.get(
      `SELECT p.*, le.name AS legal_name, le.tax_id, le.tax_id_type, le.registered_address FROM properties p
       LEFT JOIN legal_entities le ON le.id = p.legal_entity_id WHERE p.id = ?`,
      inv.property_id,
    );
    res.json({ invoice: presentInvoice(inv), property: prop, demo: Boolean(db.value('SELECT is_demo FROM organizations WHERE id = ?', prop.org_id)) });
  });
}
