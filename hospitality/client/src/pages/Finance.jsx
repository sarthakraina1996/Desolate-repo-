// Finance (WP1 scope): trial balance, journals, city ledger (receivables), invoice register and
// the reconciliation checks between folios, invoices and the general ledger. OPEX, CAPEX,
// budgets and the P&L are Phase 4.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CheckCircle2, FileSpreadsheet, Landmark, Receipt, Scale, XCircle } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, usePref } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { date, money, moneyExact, number, titleCase } from '../lib/format.js';
import { Async, Badge, Card, Empty, Input, Modal, Notice, PageHead, Tabs } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';

export default function Finance() {
  const { scope, can, property, properties } = useApp();
  const [tab, setTab] = usePref('fin-tab', can('finance.view') ? 'tb' : 'invoices');
  const ccyNote = property ? property.currency : properties.length > 1 ? 'mixed currencies — choose a property for single-currency totals' : properties[0]?.currency;
  return (
    <>
      <PageHead title="Finance" sub={`Accounting-backed folios and the general ledger · ${property ? property.name : 'all properties'}`} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(can('finance.view') ? [{ value: 'tb', label: 'Trial balance', icon: Scale }, { value: 'journals', label: 'Journals', icon: BookOpen }, { value: 'ar', label: 'City ledger (AR)', icon: Landmark }] : []),
          { value: 'invoices', label: 'Invoices', icon: Receipt },
          ...(can('finance.view') ? [{ value: 'recon', label: 'Reconciliation', icon: CheckCircle2 }] : []),
          { value: 'p4', label: 'OPEX · CAPEX · P&L', icon: FileSpreadsheet },
        ]}
      />
      {tab === 'tb' && <TrialBalance scope={scope} note={ccyNote} />}
      {tab === 'journals' && <Journals scope={scope} />}
      {tab === 'ar' && <CityLedger scope={scope} />}
      {tab === 'invoices' && <Invoices scope={scope} />}
      {tab === 'recon' && <Reconciliation scope={scope} />}
      {tab === 'p4' && (
        <Card title="Financial intelligence — Phase 4 (next work package)">
          <Notice>
            Not built yet: OPEX capture with approvals and attachments, accounts payable, budgets and forecasts, CAPEX projects and the asset register with depreciation, departmental and
            property P&L (USALI), consolidated P&L, period close and room-level profitability with measured vs allocated costs. Until then GOP, EBITDA, EBIT and net profit are shown
            as “not available” rather than estimated.
          </Notice>
        </Card>
      )}
    </>
  );
}

function TrialBalance({ scope, note }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const q = useApi(`/finance/trial-balance${qs({ property: scope, ...range })}`);
  return (
    <Card title="Trial balance" sub={`Debits and credits by account · ${note}`} flush action={<div className="row"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" /><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" /></div>}>
      <Async q={q}>
        {(rows) => {
          const d = rows.reduce((a, r) => a + r.debit_minor, 0);
          const c = rows.reduce((a, r) => a + r.credit_minor, 0);
          return (
            <DataTable
              rows={rows}
              rowKey={(r) => `${r.account_code}-${r.currency}`}
              pageSize={100}
              exportName="trial-balance.csv"
              columns={[
                { key: 'account_code', label: 'Account', render: (r) => <b>{r.account_code}</b> },
                { key: 'name', label: 'Name' },
                { key: 'type', label: 'Type', render: (r) => titleCase(r.type) },
                { key: 'currency', label: 'Ccy' },
                { key: 'debit_minor', label: 'Debit', num: true, render: (r) => moneyExact(r.debit_minor, r.currency), csv: (r) => r.debit_minor / 100 },
                { key: 'credit_minor', label: 'Credit', num: true, render: (r) => moneyExact(r.credit_minor, r.currency), csv: (r) => r.credit_minor / 100 },
                { key: 'balance_minor', label: 'Balance (Dr − Cr)', num: true, render: (r) => moneyExact(r.balance_minor, r.currency), csv: (r) => r.balance_minor / 100 },
              ]}
              footer={
                <tr>
                  <td colSpan={4}>Totals (minor units, all currencies) — {d === c ? 'balanced' : 'NOT BALANCED'}</td>
                  <td className="num">{number(d / 100, 2)}</td>
                  <td className="num">{number(c / 100, 2)}</td>
                  <td className="num">{number((d - c) / 100, 2)}</td>
                </tr>
              }
            />
          );
        }}
      </Async>
    </Card>
  );
}

function Journals({ scope }) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(null);
  const q = useApi(`/finance/journals${qs({ property: scope, limit: 50, offset: page * 50 })}`);
  const entry = useApi(open ? `/finance/journals/${open}` : null);
  return (
    <Card title="Journal entries" sub="Every folio posting creates a balanced entry in the same transaction" flush>
      <Async q={q}>
        {(d) => (
          <DataTable
            rows={d.rows}
            total={d.total}
            page={page}
            pageSize={50}
            onPage={setPage}
            onRowClick={(e) => setOpen(e.id)}
            columns={[
              { key: 'entry_no', label: 'Entry', render: (e) => <span className="num">{e.entry_no}</span> },
              { key: 'property_code', label: 'Property' },
              { key: 'business_date', label: 'Date', render: (e) => date(e.business_date) },
              { key: 'source', label: 'Source', render: (e) => titleCase(e.source.replace('folio.', '')) },
              { key: 'description', label: 'Description' },
              { key: 'amount_minor', label: 'Amount', num: true, render: (e) => moneyExact(e.amount_minor, e.currency) },
            ]}
          />
        )}
      </Async>
      {open && (
        <Modal title="Journal entry" size="lg" onClose={() => setOpen(null)}>
          <Async q={entry}>
            {(e) => (
              <>
                <div className="small muted" style={{ marginBottom: 10 }}>{e.entry.entry_no} · {date(e.entry.business_date)} · {e.entry.description}</div>
                <DataTable rows={e.lines} columns={[{ key: 'account_code', label: 'Account', render: (l) => `${l.account_code} ${l.account_name}` }, { key: 'department', label: 'Department', render: (l) => l.department || '—' }, { key: 'memo', label: 'Memo', render: (l) => l.memo || '' }, { key: 'debit_minor', label: 'Debit', num: true, render: (l) => (l.debit_minor ? moneyExact(l.debit_minor, e.entry.currency) : '') }, { key: 'credit_minor', label: 'Credit', num: true, render: (l) => (l.credit_minor ? moneyExact(l.credit_minor, e.entry.currency) : '') }]} />
              </>
            )}
          </Async>
        </Modal>
      )}
    </Card>
  );
}

function CityLedger({ scope }) {
  const q = useApi(`/finance/city-ledger${qs({ property: scope })}`);
  const navigate = useNavigate();
  return (
    <Card title="City ledger — company receivables" flush>
      <Async q={q}>
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(r) => r.folio_id}
            onRowClick={(r) => navigate(`/folios/${r.folio_id}`)}
            empty={<Empty title="No company accounts in use" />}
            exportName="city-ledger.csv"
            columns={[
              { key: 'name', label: 'Account', render: (r) => <b>{r.name}</b> },
              { key: 'property_code', label: 'Property' },
              { key: 'kind', label: 'Type', render: (r) => titleCase(r.kind) },
              { key: 'credit_days', label: 'Terms', render: (r) => `${r.credit_days} days` },
              { key: 'oldest', label: 'Oldest open charge', render: (r) => (r.balance_minor > 0 ? date(r.oldest) : '—') },
              { key: 'balance_minor', label: 'Balance', num: true, render: (r) => <span style={{ color: r.balance_minor > 0 ? 'var(--danger)' : undefined }}>{money(r.balance_minor, r.currency)}</span> },
            ]}
          />
        )}
      </Async>
      <div className="small muted" style={{ padding: 12 }}>Ageing buckets, statements and dunning are part of the Phase 4 receivables work.</div>
    </Card>
  );
}

function Invoices({ scope }) {
  const [page, setPage] = useState(0);
  const q = useApi(`/invoices${qs({ property: scope, limit: 50, offset: page * 50 })}`);
  const navigate = useNavigate();
  return (
    <Card title="Invoice register" sub="Gapless numbering per property and financial year" flush>
      <Async q={q}>
        {(d) => (
          <DataTable
            rows={d.rows}
            total={d.total}
            page={page}
            pageSize={50}
            onPage={setPage}
            onRowClick={(i) => navigate(`/invoices/${i.id}`)}
            columns={[
              { key: 'invoice_no', label: 'Invoice', render: (i) => <b>{i.invoice_no}</b> },
              { key: 'property_code', label: 'Property' },
              { key: 'issue_date', label: 'Date', render: (i) => date(i.issue_date) },
              { key: 'bill_to_name', label: 'Bill to' },
              { key: 'folio_no', label: 'Folio' },
              { key: 'net_minor', label: 'Taxable', num: true, render: (i) => moneyExact(i.net_minor, i.currency) },
              { key: 'tax_minor', label: 'Tax', num: true, render: (i) => moneyExact(i.tax_minor, i.currency) },
              { key: 'gross_minor', label: 'Total', num: true, render: (i) => moneyExact(i.gross_minor, i.currency) },
            ]}
          />
        )}
      </Async>
    </Card>
  );
}

function Reconciliation({ scope }) {
  const q = useApi(`/finance/reconciliation${qs({ property: scope })}`);
  return (
    <Card title="Reconciliation" sub="Sub-ledger, invoices and general ledger agree (docs/FINANCIAL_METRICS.md §7)">
      <Async q={q}>
        {(r) => (
          <div className="stack">
            <Notice tone={r.ok ? 'good' : 'danger'}>{r.ok ? 'All checks pass.' : 'One or more checks failed — investigate before closing the period.'}</Notice>
            <ul className="list-plain">
              {r.checks.map((c) => (
                <li key={c.id}>
                  {c.ok ? <CheckCircle2 size={18} color="var(--good)" /> : <XCircle size={18} color="var(--danger)" />}
                  <b style={{ width: 36 }}>{c.id}</b>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span className="num small muted">{number(c.left)} = {number(c.right)}</span>
                  <Badge tone={c.ok ? 'good' : 'danger'}>{c.ok ? 'OK' : `Δ ${number(c.difference)}`}</Badge>
                </li>
              ))}
            </ul>
            <div className="small muted">Amounts are in minor units of each property’s currency.</div>
          </div>
        )}
      </Async>
    </Card>
  );
}
