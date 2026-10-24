// Reconciliation checks R1–R6 (docs/FINANCIAL_METRICS.md §7) between the folio sub-ledger,
// invoices and the general ledger.
import { inList } from '../../core/access.js';

export function reconcile(db, propertyIds, { from = '0000-01-01', to = '9999-12-31' } = {}) {
  const ids = inList(propertyIds);
  const checks = [];
  const add = (id, name, left, right, detail) =>
    checks.push({ id, name, ok: left === right, left, right, difference: left - right, detail });

  // R1 revenue: folio net revenue = GL revenue credits − debits.
  const folioRevenue = db.value(
    `SELECT COALESCE(SUM(net_minor), 0) FROM folio_postings WHERE property_id IN ${ids} AND business_date BETWEEN ? AND ?`,
    ...propertyIds,
    from,
    to,
  );
  const glRevenue = db.value(
    `SELECT COALESCE(SUM(l.credit_minor - l.debit_minor), 0) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     JOIN properties p ON p.id = e.property_id JOIN accounts a ON a.org_id = p.org_id AND a.code = l.account_code
     WHERE e.property_id IN ${ids} AND e.business_date BETWEEN ? AND ? AND a.type = 'revenue'`,
    ...propertyIds,
    from,
    to,
  );
  add('R1', 'Folio revenue = GL revenue', folioRevenue, glRevenue);

  // R2 guest ledger: open guest/master/house folio balances = GL account 1210 balance.
  const guestLedger = db.value(
    `SELECT COALESCE(SUM(p.amount_minor), 0) FROM folio_postings p JOIN folios f ON f.id = p.folio_id
     WHERE f.property_id IN ${ids} AND f.kind <> 'company'`,
    ...propertyIds,
  );
  const gl1210 = db.value(
    `SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE e.property_id IN ${ids} AND l.account_code = '1210'`,
    ...propertyIds,
  );
  add('R2', 'Guest ledger = GL 1210', guestLedger, gl1210);

  // R3 room nights: sold nights on closed days = night-audit room charges (net of reversals).
  const soldClosed = db.value(
    `SELECT COUNT(*) FROM reservation_nights n JOIN reservations r ON r.id = n.reservation_id JOIN properties p ON p.id = n.property_id
     WHERE n.property_id IN ${ids} AND n.night BETWEEN ? AND ? AND n.night < p.business_date
       AND r.status IN ('in_house','checked_out','closed') AND r.is_complimentary = 0 AND r.is_house_use = 0 AND n.rate_minor > 0`,
    ...propertyIds,
    from,
    to,
  );
  const roomCharges = db.value(
    `SELECT COUNT(*) FROM folio_postings fp JOIN properties p ON p.id = fp.property_id
     WHERE fp.property_id IN ${ids} AND fp.dedupe_key LIKE 'room:%' AND fp.reversed = 0
       AND fp.business_date BETWEEN ? AND ? AND fp.business_date < p.business_date`,
    ...propertyIds,
    from,
    to,
  );
  add('R3', 'Sold nights (closed days) = room charges posted', soldClosed, roomCharges);

  // R4 journals balanced.
  const unbalanced = db.value(
    `SELECT COUNT(*) FROM (SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
       WHERE e.property_id IN ${ids} GROUP BY e.id HAVING SUM(l.debit_minor) <> SUM(l.credit_minor))`,
    ...propertyIds,
  );
  const tb = db.get(
    `SELECT COALESCE(SUM(l.debit_minor), 0) AS d, COALESCE(SUM(l.credit_minor), 0) AS c FROM journal_lines l
     JOIN journal_entries e ON e.id = l.entry_id WHERE e.property_id IN ${ids}`,
    ...propertyIds,
  );
  add('R4', 'Every journal balances; trial balance nets to zero', unbalanced + (tb.d - tb.c), 0, { debits: tb.d, credits: tb.c });

  // R5 invoices: invoice gross = Σ gross of the postings it covers.
  const invMismatch = db.value(
    `SELECT COUNT(*) FROM invoices i WHERE i.property_id IN ${ids} AND i.kind = 'invoice'
       AND i.gross_minor <> (SELECT COALESCE(SUM(p.amount_minor), 0) FROM folio_postings p WHERE p.invoice_id = i.id
                             AND p.kind IN ('charge','allowance','reversal','transfer_in','transfer_out'))`,
    ...propertyIds,
  );
  add('R5', 'Invoices match their postings', invMismatch, 0);

  // R6 city ledger: company folio balances = GL account 1220 balance.
  const cityLedger = db.value(
    `SELECT COALESCE(SUM(p.amount_minor), 0) FROM folio_postings p JOIN folios f ON f.id = p.folio_id
     WHERE f.property_id IN ${ids} AND f.kind = 'company'`,
    ...propertyIds,
  );
  const gl1220 = db.value(
    `SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     WHERE e.property_id IN ${ids} AND l.account_code = '1220'`,
    ...propertyIds,
  );
  add('R6', 'City ledger = GL 1220', cityLedger, gl1220);
  return { ok: checks.every((c) => c.ok), checks };
}
