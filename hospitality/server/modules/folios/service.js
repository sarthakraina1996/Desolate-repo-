// Guest folios: an append-only ledger per guest/company account. Every posting creates a
// balanced general-ledger journal in the same transaction. Corrections are reversals and
// allowances; postings are never edited (database triggers enforce it). Invoices are issued
// from un-invoiced postings with gapless numbering per property and financial year.
import { stamp } from '../../core/clock.js';
import { conflict, fail, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { nextNumber, pad } from '../../core/sequences.js';
import { fiscalYear } from '../../core/dates.js';
import { json } from '../../db/connection.js';
import { CONTROL_ACCOUNT } from '../properties/templates.js';
import { postJournal } from '../finance/ledger.js';
import { computeTax, rulesFor } from './tax.js';

export const folioBalance = (db, folioId) =>
  db.value('SELECT COALESCE(SUM(amount_minor), 0) FROM folio_postings WHERE folio_id = ?', folioId);

const propOf = (db, id) => db.get('SELECT * FROM properties WHERE id = ?', id);

function guestName(db, guestId) {
  const g = db.get('SELECT first_name, last_name FROM guests WHERE id = ?', guestId);
  return g ? `${g.first_name} ${g.last_name}`.trim() : 'Guest';
}

function newFolio(db, actor, prop, row) {
  const n = nextNumber(db, prop.id, 'folio');
  const id = db.insert('folios', {
    property_id: prop.id,
    folio_no: `F${pad(n, 7)}`,
    currency: prop.currency,
    created_by: actor?.id ?? null,
    ...row,
  });
  const f = db.get('SELECT * FROM folios WHERE id = ?', id);
  emit(db, { propertyId: prop.id, entity: 'folio', entityUid: f.uid, op: 'create', payload: { folio_no: f.folio_no, kind: f.kind } });
  return f;
}

// Window 1 guest folio, created with the reservation (deposits can be taken before arrival).
export function ensureGuestFolio(db, actor, res) {
  const existing = db.get('SELECT * FROM folios WHERE reservation_id = ? AND folio_window = 1', res.id);
  if (existing) return existing;
  return newFolio(db, actor, propOf(db, res.property_id), {
    kind: 'guest',
    reservation_id: res.id,
    booking_id: res.booking_id,
    folio_window: 1,
    guest_id: res.guest_id,
    name: guestName(db, res.guest_id),
  });
}

// Additional window on a reservation (split folio), optionally billed to a company.
export function addFolioWindow(db, actor, reservationId, { companyId = null, name } = {}) {
  return db.tx(() => {
    const res = db.get('SELECT * FROM reservations WHERE id = ?', reservationId);
    if (!res) notFound('Reservation');
    const window = (db.value('SELECT MAX(folio_window) FROM folios WHERE reservation_id = ?', reservationId) || 0) + 1;
    if (window > 8) fail(400, 'A reservation can have at most 8 folio windows');
    const prop = propOf(db, res.property_id);
    const company = companyId ? db.get('SELECT * FROM companies WHERE id = ? AND org_id = ?', companyId, prop.org_id) : null;
    if (companyId && !company) fail(400, 'Company not found');
    const f = newFolio(db, actor, prop, {
      kind: 'guest',
      reservation_id: res.id,
      booking_id: res.booking_id,
      folio_window: window,
      guest_id: res.guest_id,
      company_id: company?.id ?? null,
      name: name || (company ? company.name : `${guestName(db, res.guest_id)} (window ${window})`),
    });
    audit(db, actor, 'folio.window_added', { entity: 'folio', entityId: f.id, propertyId: prop.id, after: f });
    return f;
  });
}

// A house account (events, walk-in outlet sales, staff meals) not tied to a reservation.
export function createHouseFolio(db, actor, propertyId, { name, companyId = null }) {
  return db.tx(() => {
    const prop = propOf(db, propertyId);
    if (!name) fail(400, 'Name the account');
    const f = newFolio(db, actor, prop, { kind: 'house', name, company_id: companyId, created_at: stamp(actor) });
    audit(db, actor, 'folio.house_created', { entity: 'folio', entityId: f.id, propertyId, after: { name } });
    return f;
  });
}

// The company's accounts-receivable (city ledger) folio at a property.
export function companyFolio(db, actor, propertyId, companyId) {
  const existing = db.get(
    "SELECT * FROM folios WHERE property_id = ? AND company_id = ? AND kind = 'company' AND status = 'open'",
    propertyId,
    companyId,
  );
  if (existing) return existing;
  const prop = propOf(db, propertyId);
  const c = db.get('SELECT * FROM companies WHERE id = ? AND org_id = ?', companyId, prop.org_id);
  if (!c) notFound('Company');
  return newFolio(db, actor, prop, { kind: 'company', company_id: c.id, name: `${c.name} — City ledger` });
}

// Routing instruction: charges of a department for this reservation go to another folio.
export function setRoute(db, actor, reservationId, department, targetFolioId) {
  const target = db.get('SELECT * FROM folios WHERE id = ?', targetFolioId);
  const res = db.get('SELECT * FROM reservations WHERE id = ?', reservationId);
  if (!res || !target || target.property_id !== res.property_id) notFound('Folio');
  db.run(
    `INSERT INTO folio_routes (reservation_id, department, target_folio_id, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(reservation_id, department) DO UPDATE SET target_folio_id = excluded.target_folio_id`,
    reservationId,
    department,
    targetFolioId,
    actor?.id ?? null,
  );
  audit(db, actor, 'folio.route_set', { entity: 'reservation', entityId: reservationId, propertyId: res.property_id, after: { department, targetFolioId } });
}

function targetFolio(db, actor, { folioId, reservationId, department }) {
  if (folioId) {
    const f = db.get('SELECT * FROM folios WHERE id = ?', folioId);
    if (!f) notFound('Folio');
    return f;
  }
  if (!reservationId) fail(400, 'A folio or reservation is required');
  const route = db.get(
    'SELECT target_folio_id FROM folio_routes WHERE reservation_id = ? AND department IN (?, ?) ORDER BY department = ? DESC LIMIT 1',
    reservationId,
    department,
    '*',
    department,
  );
  if (route) return db.get('SELECT * FROM folios WHERE id = ?', route.target_folio_id);
  const res = db.get('SELECT * FROM reservations WHERE id = ?', reservationId);
  if (!res) notFound('Reservation');
  return ensureGuestFolio(db, actor, res);
}

// Journal lines implied by a posting: control account from the amount, revenue from net,
// tax accounts from the tax lines and, for payments, the payment method's account.
function journalLines(folio, p, { revenueAccount, counterAccount } = {}) {
  const control = CONTROL_ACCOUNT[folio.kind];
  const lines = [];
  const side = (v) => (v >= 0 ? { debit: v } : { credit: -v });
  const opp = (v) => (v >= 0 ? { credit: v } : { debit: -v });
  lines.push({ account: control, folioId: folio.id, companyId: folio.company_id, ...side(p.amount_minor) });
  if (p.net_minor) lines.push({ account: revenueAccount, department: p.department, ...opp(p.net_minor) });
  for (const t of p.taxLines || []) if (t.amount) lines.push({ account: t.account, memo: t.code, ...opp(t.amount) });
  if (counterAccount) lines.push({ account: counterAccount, ...opp(p.amount_minor) });
  return lines;
}

function insertPosting(db, actor, folio, prop, p, journal) {
  if (folio.status !== 'open') conflict(`Folio ${folio.folio_no} is closed`, { code: 'folio_closed' });
  if (p.dedupeKey) {
    const dup = db.get('SELECT * FROM folio_postings WHERE dedupe_key = ?', p.dedupeKey);
    if (dup) return { ...dup, duplicate: true };
  }
  const amount = p.amount_minor;
  const id = db.insert('folio_postings', {
    property_id: prop.id,
    folio_id: folio.id,
    posting_no: pad(nextNumber(db, prop.id, 'posting'), 8),
    business_date: p.businessDate || prop.business_date,
    posted_at: stamp(actor),
    kind: p.kind,
    charge_code: p.chargeCode ?? null,
    department: p.department ?? null,
    category: p.category ?? null,
    account_code: p.accountCode ?? null,
    description: p.description,
    quantity: p.quantity ?? 1,
    unit_minor: p.unitMinor ?? null,
    net_minor: p.net_minor || 0,
    tax_minor: p.tax_minor || 0,
    amount_minor: amount,
    debit_minor: amount > 0 ? amount : 0,
    credit_minor: amount < 0 ? -amount : 0,
    taxes: JSON.stringify((p.taxLines || []).map(({ code, rate_bp, amount: a, account }) => ({ code, rate_bp, amount: a, account }))),
    currency: folio.currency,
    orig_currency: p.origCurrency ?? null,
    orig_amount_minor: p.origAmountMinor ?? null,
    fx_rate_micros: p.fxRateMicros ?? null,
    payment_method: p.paymentMethod ?? null,
    payment_ref: p.paymentRef ?? null,
    card_last4: p.cardLast4 ?? null,
    cashier_shift_id: p.shiftId ?? null,
    reservation_id: folio.reservation_id ?? p.reservationId ?? null,
    guest_id: folio.guest_id ?? null,
    user_id: actor?.id ?? null,
    source: p.source || 'manual',
    source_ref: p.sourceRef ?? null,
    dedupe_key: p.dedupeKey ?? null,
    reverses_id: p.reversesId ?? null,
    transfer_pair_id: p.transferPairId ?? null,
    note: p.note ?? null,
  });
  if (journal !== false) {
    const entry = postJournal(db, actor, {
      propertyId: prop.id,
      businessDate: p.businessDate || prop.business_date,
      source: `folio.${p.kind}`,
      sourceId: id,
      description: `${folio.folio_no} · ${p.description}`,
      currency: folio.currency,
      lines: journalLines(folio, p, journal || {}),
    });
  }
  const row = db.get('SELECT * FROM folio_postings WHERE id = ?', id);
  emit(db, { propertyId: prop.id, entity: 'folio_posting', entityUid: row.uid, op: 'create', payload: row, idempotencyKey: p.dedupeKey });
  return row;
}

// Posts a charge from a charge code. unitMinor is the price as sold (tax-exclusive or
// inclusive per the property); taxes come from the code's tax category and the business date.
export function postCharge(db, actor, input) {
  return db.tx(() => {
    const code = input.chargeCode;
    let folio;
    let prop;
    if (input.folioId) {
      folio = targetFolio(db, actor, { folioId: input.folioId });
      prop = propOf(db, folio.property_id);
    }
    const propertyId = prop?.id ?? db.value('SELECT property_id FROM reservations WHERE id = ?', input.reservationId);
    if (!propertyId) notFound('Reservation');
    prop ||= propOf(db, propertyId);
    const cc = db.get('SELECT * FROM charge_codes WHERE property_id = ? AND code = ? AND active = 1', prop.id, code);
    if (!cc) fail(400, `Unknown charge code ${code}`);
    folio ||= targetFolio(db, actor, { reservationId: input.reservationId, department: cc.department });
    const quantity = input.quantity ?? 1;
    if (!(quantity > 0)) fail(400, 'Quantity must be positive');
    const unit = input.unitMinor ?? cc.default_minor;
    if (!Number.isInteger(unit) || unit < 0) fail(400, 'Amount is invalid');
    const amount = Math.round(unit * quantity);
    const businessDate = input.businessDate || prop.business_date;
    const tax = computeTax(rulesFor(db, prop.id, cc.tax_category, businessDate), {
      amountMinor: amount,
      unitMinor: unit,
      inclusive: Boolean(prop.prices_include_tax),
    });
    const posting = insertPosting(
      db,
      actor,
      folio,
      prop,
      {
        kind: 'charge',
        businessDate,
        chargeCode: cc.code,
        department: cc.department,
        category: cc.category,
        accountCode: cc.account_code,
        description: input.description || cc.name,
        quantity,
        unitMinor: unit,
        net_minor: tax.net,
        tax_minor: tax.tax,
        amount_minor: tax.gross,
        taxLines: tax.lines,
        source: input.source,
        sourceRef: input.sourceRef,
        dedupeKey: input.dedupeKey,
        note: input.note,
        reservationId: input.reservationId,
      },
      { revenueAccount: cc.account_code },
    );
    if (!posting.duplicate && input.source !== 'night_audit' && input.source !== 'seed')
      audit(db, actor, 'folio.charge', { entity: 'folio_posting', entityId: posting.id, propertyId: prop.id, after: { folio: folio.folio_no, code, amount: posting.amount_minor } });
    return posting;
  });
}

export function postPayment(db, actor, input) {
  return db.tx(() => {
    const folio = db.get('SELECT * FROM folios WHERE id = ?', input.folioId);
    if (!folio) notFound('Folio');
    const prop = propOf(db, folio.property_id);
    const method = db.get('SELECT * FROM payment_methods WHERE property_id = ? AND code = ? AND active = 1', prop.id, input.method);
    if (!method) fail(400, 'Unknown payment method');
    if (method.kind === 'city_ledger') fail(400, 'Use "Transfer to city ledger" to bill a company');
    const amount = input.amountMinor;
    if (!Number.isInteger(amount) || amount <= 0) fail(400, 'Payment amount must be positive');
    if (input.cardLast4 && !/^\d{4}$/.test(input.cardLast4)) fail(400, 'Card: only the last four digits may be recorded');
    const refund = input.kind === 'refund';
    if (refund && amount > -folioBalance(db, folio.id))
      fail(400, 'A refund cannot exceed the credit balance on the folio');
    const shiftId = actor?.id
      ? db.value("SELECT id FROM cashier_shifts WHERE property_id = ? AND user_id = ? AND status = 'open'", prop.id, actor.id)
      : null;
    const posting = insertPosting(
      db,
      actor,
      folio,
      prop,
      {
        kind: refund ? 'refund' : 'payment',
        description: input.description || `${refund ? 'Refund' : 'Payment'} — ${method.name}`,
        amount_minor: refund ? amount : -amount,
        paymentMethod: method.code,
        paymentRef: input.reference ?? null,
        cardLast4: input.cardLast4 ?? null,
        origCurrency: input.origCurrency,
        origAmountMinor: input.origAmountMinor,
        fxRateMicros: input.fxRateMicros,
        shiftId,
        source: input.source,
        dedupeKey: input.dedupeKey,
        businessDate: input.businessDate,
      },
      { counterAccount: method.account_code },
    );
    if (!posting.duplicate && input.source !== 'seed')
      audit(db, actor, refund ? 'folio.refund' : 'folio.payment', { entity: 'folio_posting', entityId: posting.id, propertyId: prop.id, after: { folio: folio.folio_no, method: method.code, amount } });
    return posting;
  });
}

// Reverses a posting in full (mirror posting on the same folio). Invoiced postings need a
// credit note instead; a posting can be reversed once.
export function reversePosting(db, actor, postingId, reason) {
  return db.tx(() => {
    if (!reason) fail(400, 'A reason is required');
    const p = db.get('SELECT * FROM folio_postings WHERE id = ?', postingId);
    if (!p) notFound('Posting');
    if (p.reversed) conflict('This posting was already reversed or transferred');
    if (p.invoice_id) conflict('This posting is on an issued invoice; issue a credit note instead', { code: 'invoiced' });
    if (!['charge', 'payment', 'refund', 'allowance'].includes(p.kind)) conflict(`A ${p.kind} posting cannot be reversed`);
    const folio = db.get('SELECT * FROM folios WHERE id = ?', p.folio_id);
    const prop = propOf(db, p.property_id);
    const taxLines = json(p.taxes, []).map((t) => ({ ...t, amount: -t.amount }));
    const method = p.payment_method ? db.get('SELECT * FROM payment_methods WHERE property_id = ? AND code = ?', prop.id, p.payment_method) : null;
    const rev = insertPosting(
      db,
      actor,
      folio,
      prop,
      {
        kind: 'reversal',
        chargeCode: p.charge_code,
        department: p.department,
        category: p.category,
        accountCode: p.account_code,
        description: `Reversal of ${p.posting_no}: ${p.description}`,
        quantity: p.quantity,
        unitMinor: p.unit_minor,
        net_minor: -p.net_minor,
        tax_minor: -p.tax_minor,
        amount_minor: -p.amount_minor,
        taxLines,
        paymentMethod: p.payment_method,
        reversesId: p.id,
        source: 'reversal',
        note: reason,
      },
      { revenueAccount: p.account_code, counterAccount: method?.account_code },
    );
    db.run('UPDATE folio_postings SET reversed = 1 WHERE id = ?', p.id);
    audit(db, actor, 'folio.reversal', { entity: 'folio_posting', entityId: p.id, propertyId: prop.id, after: { reversal: rev.posting_no, reason } });
    return rev;
  });
}

// Allowance: a goodwill or correction credit against a charge code (negative revenue).
export function postAllowance(db, actor, { folioId, chargeCode, amountMinor, reason }) {
  return db.tx(() => {
    if (!reason) fail(400, 'A reason is required');
    const folio = db.get('SELECT * FROM folios WHERE id = ?', folioId);
    if (!folio) notFound('Folio');
    const prop = propOf(db, folio.property_id);
    const cc = db.get('SELECT * FROM charge_codes WHERE property_id = ? AND code = ?', prop.id, chargeCode);
    if (!cc) fail(400, `Unknown charge code ${chargeCode}`);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) fail(400, 'Allowance amount must be positive');
    const tax = computeTax(rulesFor(db, prop.id, cc.tax_category, prop.business_date), {
      amountMinor,
      inclusive: Boolean(prop.prices_include_tax),
    });
    const p = insertPosting(
      db,
      actor,
      folio,
      prop,
      {
        kind: 'allowance',
        chargeCode: cc.code,
        department: cc.department,
        category: cc.category,
        accountCode: cc.account_code,
        description: `Allowance — ${cc.name}`,
        net_minor: -tax.net,
        tax_minor: -tax.tax,
        amount_minor: -tax.gross,
        taxLines: tax.lines.map((t) => ({ ...t, amount: -t.amount })),
        note: reason,
      },
      { revenueAccount: cc.account_code },
    );
    audit(db, actor, 'folio.allowance', { entity: 'folio_posting', entityId: p.id, propertyId: prop.id, after: { amount: p.amount_minor, reason } });
    return p;
  });
}

// Moves individual charges to another folio of the same property (e.g. room and tax to the
// company window): a mirror posting leaves the source and an identical one arrives at the target.
export function transferPostings(db, actor, postingIds, targetFolioId, reason) {
  return db.tx(() => {
    const target = db.get('SELECT * FROM folios WHERE id = ?', targetFolioId);
    if (!target) notFound('Folio');
    const prop = propOf(db, target.property_id);
    const moved = [];
    for (const pid of postingIds) {
      const p = db.get('SELECT * FROM folio_postings WHERE id = ?', pid);
      if (!p || p.property_id !== target.property_id) notFound('Posting');
      if (p.folio_id === target.id) fail(400, 'The posting is already on that folio');
      if (p.reversed) conflict(`Posting ${p.posting_no} was already reversed or transferred`);
      if (p.invoice_id) conflict(`Posting ${p.posting_no} is invoiced; issue a credit note first`);
      if (!['charge', 'transfer_in', 'allowance'].includes(p.kind)) conflict(`A ${p.kind} posting cannot be transferred`);
      const source = db.get('SELECT * FROM folios WHERE id = ?', p.folio_id);
      const taxes = json(p.taxes, []);
      const base = {
        chargeCode: p.charge_code,
        department: p.department,
        category: p.category,
        accountCode: p.account_code,
        quantity: p.quantity,
        unitMinor: p.unit_minor,
        source: 'transfer',
        note: reason,
      };
      const out = insertPosting(
        db,
        actor,
        source,
        prop,
        {
          ...base,
          kind: 'transfer_out',
          description: `Transferred to ${target.folio_no}: ${p.description}`,
          net_minor: -p.net_minor,
          tax_minor: -p.tax_minor,
          amount_minor: -p.amount_minor,
          taxLines: taxes.map((t) => ({ ...t, amount: -t.amount })),
          reversesId: p.id,
        },
        { revenueAccount: p.account_code },
      );
      const inn = insertPosting(
        db,
        actor,
        target,
        prop,
        {
          ...base,
          kind: 'transfer_in',
          description: p.description,
          net_minor: p.net_minor,
          tax_minor: p.tax_minor,
          amount_minor: p.amount_minor,
          taxLines: taxes,
          sourceRef: `posting:${p.id}`,
          transferPairId: out.id,
        },
        { revenueAccount: p.account_code },
      );
      db.run('UPDATE folio_postings SET reversed = 1 WHERE id = ?', p.id);
      db.run('UPDATE folio_postings SET transfer_pair_id = ? WHERE id = ?', inn.id, out.id);
      moved.push(inn);
    }
    audit(db, actor, 'folio.transfer', { entity: 'folio', entityId: target.id, propertyId: prop.id, after: { postings: postingIds, reason } });
    return moved;
  });
}

// Moves a folio's whole balance to the company's city-ledger account (accounts receivable).
export function transferBalanceToCompany(db, actor, folioId, companyId, { reason = 'Bill to company', invoiceNo } = {}) {
  return db.tx(() => {
    const folio = db.get('SELECT * FROM folios WHERE id = ?', folioId);
    if (!folio) notFound('Folio');
    const prop = propOf(db, folio.property_id);
    const company = db.get('SELECT * FROM companies WHERE id = ? AND org_id = ?', companyId, prop.org_id);
    if (!company) notFound('Company');
    if (!company.ar_enabled) conflict(`${company.name} does not have a credit account`, { code: 'no_credit' });
    const balance = folioBalance(db, folio.id);
    if (balance <= 0) fail(400, 'There is no balance to transfer');
    const ar = companyFolio(db, actor, prop.id, company.id);
    const exposure = folioBalance(db, ar.id) + balance;
    if (company.credit_limit_minor && exposure > company.credit_limit_minor)
      conflict(`${company.name} would exceed its credit limit`, { code: 'credit_limit', details: { exposure, limit: company.credit_limit_minor } });
    const out = insertPosting(db, actor, folio, prop, {
      kind: 'transfer_out',
      description: `Transferred to city ledger: ${company.name}${invoiceNo ? ` (invoice ${invoiceNo})` : ''}`,
      amount_minor: -balance,
      source: 'city_ledger',
      note: reason,
    }, false);
    const inn = insertPosting(db, actor, ar, prop, {
      kind: 'transfer_in',
      description: `From ${folio.folio_no} (${folio.name})${invoiceNo ? ` — invoice ${invoiceNo}` : ''}`,
      amount_minor: balance,
      source: 'city_ledger',
      sourceRef: `folio:${folio.id}`,
      transferPairId: out.id,
      note: reason,
    }, false);
    db.run('UPDATE folio_postings SET transfer_pair_id = ? WHERE id = ?', inn.id, out.id);
    // One journal for the pair: receivable moves from the guest ledger to the city ledger.
    const entry = postJournal(db, actor, {
      propertyId: prop.id,
      businessDate: prop.business_date,
      source: 'folio.city_ledger',
      sourceId: out.id,
      description: `${folio.folio_no} → ${ar.folio_no} · ${company.name}`,
      currency: folio.currency,
      lines: [
        { account: CONTROL_ACCOUNT[ar.kind], debit: balance, folioId: ar.id, companyId: company.id },
        { account: CONTROL_ACCOUNT[folio.kind], credit: balance, folioId: folio.id },
      ],
    });
    void entry;
    audit(db, actor, 'folio.city_ledger', { entity: 'folio', entityId: folio.id, propertyId: prop.id, after: { company: company.name, amount: balance } });
    return { from: out, to: inn, companyFolio: ar };
  });
}

// Postings that belong on the next invoice: un-invoiced revenue postings, minus pairs that
// cancel out on this folio (a charge and its reversal or transfer).
function invoiceable(db, folioId) {
  const rows = db.all(
    `SELECT * FROM folio_postings WHERE folio_id = ? AND invoice_id IS NULL
     AND kind IN ('charge','allowance','reversal','transfer_in','transfer_out') AND (net_minor <> 0 OR tax_minor <> 0)
     ORDER BY id`,
    folioId,
  );
  const cancelled = new Set();
  for (const r of rows)
    if (r.reverses_id && rows.some((x) => x.id === r.reverses_id)) {
      cancelled.add(r.id);
      cancelled.add(r.reverses_id);
    }
  return { lines: rows.filter((r) => !cancelled.has(r.id)), cancelled: rows.filter((r) => cancelled.has(r.id)) };
}

export function issueInvoice(db, actor, folioId, billTo = {}) {
  return db.tx(() => {
    const folio = db.get('SELECT * FROM folios WHERE id = ?', folioId);
    if (!folio) notFound('Folio');
    const prop = propOf(db, folio.property_id);
    const { lines, cancelled } = invoiceable(db, folio.id);
    if (!lines.length) fail(400, 'There are no charges to invoice on this folio');
    const org = db.get('SELECT fy_start_month FROM organizations WHERE id = ?', prop.org_id);
    const fy = fiscalYear(prop.business_date, org.fy_start_month);
    const seq = nextNumber(db, prop.id, 'invoice', fy.label);
    const invoiceNo = `${prop.invoice_prefix}/${fy.label.replace('FY', '').replace('-', '')}/${pad(seq, 5)}`;
    const company = folio.company_id ? db.get('SELECT * FROM companies WHERE id = ?', folio.company_id) : null;
    const res = folio.reservation_id ? db.get('SELECT * FROM reservations WHERE id = ?', folio.reservation_id) : null;
    const guest = folio.guest_id ? db.get('SELECT * FROM guests WHERE id = ?', folio.guest_id) : null;
    const billCompany = billTo.companyId ? db.get('SELECT * FROM companies WHERE id = ? AND org_id = ?', billTo.companyId, prop.org_id) : company;
    const breakdown = new Map();
    for (const l of lines)
      for (const t of json(l.taxes, [])) {
        const k = `${t.code}|${t.rate_bp}`;
        const b = breakdown.get(k) || { code: t.code, rate_bp: t.rate_bp, taxable_minor: 0, amount_minor: 0 };
        b.taxable_minor += l.net_minor;
        b.amount_minor += t.amount;
        breakdown.set(k, b);
      }
    const ccSac = new Map(db.all('SELECT code, hsn_sac FROM charge_codes WHERE property_id = ?', prop.id).map((c) => [c.code, c.hsn_sac]));
    const snapshot = lines.map((l) => ({
      posting_no: l.posting_no,
      date: l.business_date,
      description: l.description,
      department: l.department,
      sac: ccSac.get(l.charge_code) || null,
      quantity: l.quantity,
      net_minor: l.net_minor,
      tax_minor: l.tax_minor,
      gross_minor: l.amount_minor,
      taxes: json(l.taxes, []),
    }));
    const net = lines.reduce((a, l) => a + l.net_minor, 0);
    const tax = lines.reduce((a, l) => a + l.tax_minor, 0);
    const paid = -db.value(
      "SELECT COALESCE(SUM(amount_minor), 0) FROM folio_postings WHERE folio_id = ? AND kind IN ('payment','refund')",
      folio.id,
    );
    const invoiceId = db.insert('invoices', {
      property_id: prop.id,
      folio_id: folio.id,
      kind: 'invoice',
      invoice_no: invoiceNo,
      fiscal_year: fy.label,
      issue_date: prop.business_date,
      bill_to_name: billTo.name || billCompany?.name || (guest ? `${guest.first_name} ${guest.last_name}`.trim() : folio.name),
      bill_to_address: billTo.address || billCompany?.address || guest?.address || null,
      bill_to_tax_id: billTo.taxId || billCompany?.tax_id || null,
      place_of_supply: prop.state ? `${prop.state}${prop.state_code ? ` (${prop.state_code})` : ''}` : prop.country,
      currency: folio.currency,
      net_minor: net,
      tax_minor: tax,
      gross_minor: net + tax,
      paid_minor: paid,
      tax_breakdown: JSON.stringify([...breakdown.values()]),
      lines: JSON.stringify({ items: snapshot, stay: res ? { conf_no: res.conf_no, arrival: res.arrival, departure: res.departure } : null }),
      issued_by: actor?.id ?? null,
      created_at: stamp(actor),
    });
    for (const l of [...lines, ...cancelled]) db.run('UPDATE folio_postings SET invoice_id = ? WHERE id = ?', invoiceId, l.id);
    const inv = db.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
    audit(db, actor, 'invoice.issue', { entity: 'invoice', entityId: invoiceId, propertyId: prop.id, after: { invoice_no: invoiceNo, gross: net + tax } });
    emit(db, { propertyId: prop.id, entity: 'invoice', entityUid: inv.uid, op: 'issue', payload: { invoice_no: invoiceNo, folio_no: folio.folio_no, gross_minor: net + tax } });
    return presentInvoice(inv);
  });
}

export const presentInvoice = (inv) =>
  inv && { ...inv, tax_breakdown: json(inv.tax_breakdown, []), lines: json(inv.lines, { items: [] }) };

export function closeFolio(db, actor, folioId) {
  return db.tx(() => {
    const folio = db.get('SELECT * FROM folios WHERE id = ?', folioId);
    if (!folio) notFound('Folio');
    if (folio.status === 'closed') return folio;
    const bal = folioBalance(db, folio.id);
    if (bal !== 0) conflict('The folio has a balance; settle it before closing', { code: 'balance_due', details: { balance_minor: bal } });
    db.run("UPDATE folios SET status = 'closed', closed_at = ? WHERE id = ?", stamp(actor), folio.id);
    audit(db, actor, 'folio.close', { entity: 'folio', entityId: folio.id, propertyId: folio.property_id });
    return db.get('SELECT * FROM folios WHERE id = ?', folio.id);
  });
}

export function folioDetail(db, folioId) {
  const folio = db.get(
    `SELECT f.*, c.name AS company_name, r.conf_no, r.arrival, r.departure, r.status AS reservation_status
     FROM folios f LEFT JOIN companies c ON c.id = f.company_id LEFT JOIN reservations r ON r.id = f.reservation_id
     WHERE f.id = ?`,
    folioId,
  );
  if (!folio) notFound('Folio');
  let running = 0;
  const postings = db
    .all(
      `SELECT p.*, u.name AS user_name, i.invoice_no FROM folio_postings p LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.folio_id = ? ORDER BY p.id`,
      folioId,
    )
    .map((p) => {
      running += p.amount_minor;
      return { ...p, taxes: json(p.taxes, []), balance_minor: running };
    });
  const charges = postings.filter((p) => p.amount_minor > 0 && p.kind !== 'refund').reduce((a, p) => a + p.amount_minor, 0);
  return {
    folio,
    postings,
    totals: {
      charges_minor: postings.filter((p) => ['charge', 'transfer_in', 'refund'].includes(p.kind)).reduce((a, p) => a + p.amount_minor, 0),
      credits_minor: -postings.filter((p) => ['payment', 'allowance', 'reversal', 'transfer_out'].includes(p.kind)).reduce((a, p) => a + p.amount_minor, 0),
      payments_minor: -postings.filter((p) => ['payment', 'refund'].includes(p.kind)).reduce((a, p) => a + p.amount_minor, 0),
      net_minor: postings.reduce((a, p) => a + p.net_minor, 0),
      tax_minor: postings.reduce((a, p) => a + p.tax_minor, 0),
      gross_charges_minor: charges,
      balance_minor: running,
    },
    invoices: db.all('SELECT * FROM invoices WHERE folio_id = ? ORDER BY id', folioId).map(presentInvoice),
    routes: folio.reservation_id
      ? db.all(
          `SELECT fr.*, f.folio_no, f.name FROM folio_routes fr JOIN folios f ON f.id = fr.target_folio_id WHERE fr.reservation_id = ?`,
          folio.reservation_id,
        )
      : [],
  };
}
