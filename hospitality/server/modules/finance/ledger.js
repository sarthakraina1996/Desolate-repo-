// General ledger posting. Every entry must balance (Σ debit = Σ credit) and use postable
// accounts of the property's organisation; entries and lines are append-only (DB triggers).
import { fail } from '../../core/errors.js';
import { nextNumber, pad } from '../../core/sequences.js';
import { stamp } from '../../core/clock.js';

// Postable account codes per property's organisation, cached per database connection.
// Call invalidateAccounts(db) after changing the chart of accounts.
const accountCache = new WeakMap();
function postableAccounts(db, propertyId) {
  let byProp = accountCache.get(db);
  if (!byProp) accountCache.set(db, (byProp = new Map()));
  let set = byProp.get(propertyId);
  if (!set) {
    set = new Set(
      db
        .all(
          `SELECT a.code FROM accounts a JOIN properties p ON p.org_id = a.org_id
           WHERE p.id = ? AND a.postable = 1 AND a.active = 1`,
          propertyId,
        )
        .map((r) => r.code),
    );
    byProp.set(propertyId, set);
  }
  return set;
}
export const invalidateAccounts = (db) => accountCache.delete(db);

export function postJournal(db, actor, { propertyId, businessDate, source, sourceId, description, currency, lines }) {
  const clean = lines.filter((l) => (l.debit || 0) !== 0 || (l.credit || 0) !== 0);
  if (!clean.length) return null;
  let dr = 0;
  let cr = 0;
  for (const l of clean) {
    if ((l.debit || 0) < 0 || (l.credit || 0) < 0) fail(500, 'Journal lines cannot be negative');
    if (l.debit && l.credit) fail(500, 'A journal line is either a debit or a credit');
    dr += l.debit || 0;
    cr += l.credit || 0;
  }
  if (dr !== cr) fail(500, `Unbalanced journal: debits ${dr} ≠ credits ${cr}`, { code: 'unbalanced_journal' });
  const valid = postableAccounts(db, propertyId);
  for (const l of clean) if (!valid.has(l.account)) fail(500, `Account ${l.account} is not in the chart of accounts`);
  return db.tx(() => {
    const entryId = db.insert('journal_entries', {
      property_id: propertyId,
      entry_no: `JE-${pad(nextNumber(db, propertyId, 'journal'), 8)}`,
      business_date: businessDate,
      source,
      source_id: sourceId ?? null,
      description,
      currency,
      created_by: actor?.id ?? null,
      created_at: stamp(actor),
    });
    for (const l of clean)
      db.insert('journal_lines', {
        entry_id: entryId,
        account_code: l.account,
        department: l.department ?? null,
        cost_centre_id: l.costCentreId ?? null,
        folio_id: l.folioId ?? null,
        company_id: l.companyId ?? null,
        debit_minor: l.debit || 0,
        credit_minor: l.credit || 0,
        memo: l.memo ?? null,
      });
    return entryId;
  });
}

// Trial balance for properties and an optional date range, by account.
export function trialBalance(db, propertyIds, { from, to } = {}) {
  const where = [`e.property_id IN (${propertyIds.map(() => '?').join(',') || 'NULL'})`];
  const params = [...propertyIds];
  if (from) where.push('e.business_date >= ?') && params.push(from);
  if (to) where.push('e.business_date <= ?') && params.push(to);
  const rows = db.all(
    `SELECT l.account_code, a.name, a.type, a.usali_section, e.currency,
            SUM(l.debit_minor) AS debit_minor, SUM(l.credit_minor) AS credit_minor
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
     JOIN properties p ON p.id = e.property_id
     JOIN accounts a ON a.org_id = p.org_id AND a.code = l.account_code
     WHERE ${where.join(' AND ')} GROUP BY l.account_code, e.currency ORDER BY l.account_code`,
    ...params,
  );
  return rows.map((r) => ({ ...r, balance_minor: r.debit_minor - r.credit_minor }));
}
