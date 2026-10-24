// Finance (WP1 scope): chart of accounts, journals, trial balance, city ledger, reconciliation.
import { int, date } from '../../core/validate.js';
import { perm } from '../../core/http.js';
import { propertyScope, scopedRow, inList } from '../../core/access.js';
import { trialBalance } from './ledger.js';
import { reconcile } from './reconciliation.js';

export default function financeRoutes(r, { db }) {
  r.get('/finance/accounts', perm('finance.view'), (req, res) =>
    res.json(db.all('SELECT * FROM accounts WHERE org_id = ? ORDER BY code', req.user.orgId)),
  );
  r.get('/finance/trial-balance', perm('finance.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    res.json(trialBalance(db, pids, { from: date(req.query.from), to: date(req.query.to) }));
  });
  r.get('/finance/journals', perm('finance.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    const where = [`e.property_id IN ${inList(pids)}`];
    const params = [...pids];
    const from = date(req.query.from);
    const to = date(req.query.to);
    if (from) where.push('e.business_date >= ?') && params.push(from);
    if (to) where.push('e.business_date <= ?') && params.push(to);
    if (req.query.account) where.push('EXISTS (SELECT 1 FROM journal_lines l WHERE l.entry_id = e.id AND l.account_code = ?)') && params.push(String(req.query.account));
    const limit = int(req.query.limit, { min: 1, max: 200 }) || 50;
    const offset = int(req.query.offset, { min: 0 }) || 0;
    res.json({
      total: db.value(`SELECT COUNT(*) FROM journal_entries e WHERE ${where.join(' AND ')}`, ...params),
      rows: db.all(
        `SELECT e.*, p.code AS property_code, (SELECT SUM(debit_minor) FROM journal_lines l WHERE l.entry_id = e.id) AS amount_minor
         FROM journal_entries e JOIN properties p ON p.id = e.property_id WHERE ${where.join(' AND ')}
         ORDER BY e.id DESC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
      ),
    });
  });
  r.get('/finance/journals/:id', perm('finance.view'), (req, res) => {
    const e = scopedRow(db, req.user, 'journal_entries', int(req.params.id, { min: 1 }), 'Journal entry');
    res.json({
      entry: e,
      lines: db.all(
        `SELECT l.*, a.name AS account_name FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         JOIN properties p ON p.id = e.property_id JOIN accounts a ON a.org_id = p.org_id AND a.code = l.account_code
         WHERE l.entry_id = ? ORDER BY l.id`,
        e.id,
      ),
    });
  });
  r.get('/finance/city-ledger', perm('finance.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    res.json(
      db.all(
        `SELECT f.id AS folio_id, f.folio_no, f.property_id, p.code AS property_code, c.id AS company_id, c.name, c.kind,
                c.credit_limit_minor, c.credit_days, f.currency,
                COALESCE(SUM(fp.amount_minor), 0) AS balance_minor, MIN(CASE WHEN fp.amount_minor > 0 THEN fp.business_date END) AS oldest
         FROM folios f JOIN companies c ON c.id = f.company_id JOIN properties p ON p.id = f.property_id
         LEFT JOIN folio_postings fp ON fp.folio_id = f.id
         WHERE f.kind = 'company' AND f.property_id IN ${inList(pids)} GROUP BY f.id ORDER BY balance_minor DESC`,
        ...pids,
      ),
    );
  });
  r.get('/finance/reconciliation', perm('finance.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    res.json(reconcile(db, pids, { from: date(req.query.from) || undefined, to: date(req.query.to) || undefined }));
  });
}
