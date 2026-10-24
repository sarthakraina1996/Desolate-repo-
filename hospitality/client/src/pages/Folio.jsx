// Guest folio: the immutable posting ledger with running balance, charges, payments,
// allowances, reversals, transfers between folio windows, routing, city-ledger transfer,
// invoicing and closing. Every action is a new posting; nothing is edited.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRightLeft, Ban, CreditCard, FileText, Lock, Plus, Printer, Route, SplitSquareHorizontal, Undo2 } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi } from '../lib/hooks.js';
import { api, newIdempotencyKey } from '../lib/api.js';
import { date, dateTime, moneyExact, titleCase } from '../lib/format.js';
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, Notice, PageHead, Select, Tabs, useAction } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { WEB_DEMO } from '../lib/env.js';

export default function Folio() {
  const { id } = useParams();
  const q = useApi(`/folios/${id}`);
  return <Async q={q}>{(d) => <FolioView d={d} reload={q.reload} />}</Async>;
}

function FolioView({ d, reload }) {
  const { can } = useApp();
  const navigate = useNavigate();
  const f = d.folio;
  const ccy = f.currency;
  const [tab, setTab] = useState('postings');
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [run, busy] = useAction();
  const open = f.status === 'open';
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const transferable = d.postings.filter((p) => ['charge', 'transfer_in', 'allowance'].includes(p.kind) && !p.reversed && !p.invoice_id);
  return (
    <>
      <PageHead
        crumbs={<>{f.reservation_id ? <Link to={`/reservations/${f.reservation_id}`}>{f.conf_no}</Link> : 'House account'} / Folio {f.folio_no}</>}
        title={<span className="row" style={{ gap: 10 }}>Guest Folio — {f.name} <Badge tone={open ? 'info' : 'good'}>{open ? 'Open' : 'Closed'}</Badge></span>}
        sub={`${f.folio_no} · window ${f.folio_window}${f.arrival ? ` · ${date(f.arrival)} – ${date(f.departure)}` : ''}${f.company_name ? ` · billed to ${f.company_name}` : ''}`}
      >
        {open && can('folio.post') && <Button variant="primary" icon={Plus} onClick={() => setModal('charge')}>Post charge</Button>}
        {open && can('folio.payment') && <Button variant="primary" icon={CreditCard} onClick={() => setModal('payment')}>Take payment</Button>}
        {!WEB_DEMO && <Button icon={Printer} onClick={() => window.print()}>Print</Button>}
      </PageHead>
      {d.siblings.length > 1 && (
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <span className="small muted">Windows:</span>
          {d.siblings.map((s) => (
            <Link key={s.id} to={`/folios/${s.id}`} className={`btn sm ${s.id === f.id ? 'primary' : ''}`}>{s.folio_window}. {s.name}</Link>
          ))}
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'postings', label: 'Folio', count: d.postings.length }, { value: 'invoices', label: 'Invoices', count: d.invoices.length }, { value: 'routing', label: 'Routing', count: d.routes.length }]} />
      {tab === 'postings' && (
        <div className="grid g-2-1">
          <Card flush>
            <DataTable
              rows={d.postings}
              pageSize={50}
              empty={<Empty title="No postings yet" />}
              exportName={`${f.folio_no}.csv`}
              columns={[
                { key: 'sel', label: '', sortable: false, csv: false, render: (p) => (open && can('folio.transfer') && transferable.includes(p) ? <input type="checkbox" aria-label={`Select ${p.posting_no}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /> : null) },
                { key: 'business_date', label: 'Date', render: (p) => date(p.business_date) },
                { key: 'posting_no', label: 'Ref', render: (p) => <span className="num small">{p.posting_no}</span> },
                {
                  key: 'description',
                  label: 'Description',
                  render: (p) => (
                    <>
                      <span style={{ textDecoration: p.reversed ? 'line-through' : undefined }}>{p.description}</span>
                      <div className="sub">
                        {titleCase(p.kind)}
                        {p.taxes?.length ? ` · ${p.taxes.map((t) => `${t.code} ${t.rate_bp / 100}% ${moneyExact(t.amount, ccy)}`).join(', ')}` : ''}
                        {p.payment_ref ? ` · ${p.payment_ref}` : ''}
                        {p.card_last4 ? ` · •••• ${p.card_last4}` : ''}
                        {p.invoice_no ? ` · invoice ${p.invoice_no}` : ''}
                        {p.note ? ` · ${p.note}` : ''}
                      </div>
                    </>
                  ),
                  csv: (p) => p.description,
                },
                { key: 'department', label: 'Department', render: (p) => (p.department ? titleCase(p.department) : p.payment_method || '—') },
                { key: 'debit_minor', label: 'Debit', num: true, render: (p) => (p.debit_minor ? moneyExact(p.debit_minor, ccy) : '—'), csv: (p) => p.debit_minor / 100 },
                { key: 'credit_minor', label: 'Credit', num: true, render: (p) => (p.credit_minor ? moneyExact(p.credit_minor, ccy) : '—'), csv: (p) => p.credit_minor / 100 },
                { key: 'balance_minor', label: 'Balance', num: true, render: (p) => moneyExact(p.balance_minor, ccy), csv: (p) => p.balance_minor / 100 },
                {
                  key: 'act',
                  label: '',
                  sortable: false,
                  csv: false,
                  render: (p) =>
                    open && can('folio.adjust') && !p.reversed && !p.invoice_id && ['charge', 'payment', 'refund', 'allowance'].includes(p.kind) ? (
                      <Button size="xs" variant="ghost" icon={Undo2} onClick={() => setModal({ kind: 'reverse', posting: p })}>Reverse</Button>
                    ) : p.reversed ? <Badge>{p.kind === 'charge' && d.postings.some((x) => x.reverses_id === p.id && x.kind === 'transfer_out') ? 'Transferred' : 'Reversed'}</Badge> : null,
                },
              ]}
            />
            {selected.size > 0 && (
              <div className="row" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
                <span className="small">{selected.size} posting(s) selected</span>
                <span className="spacer" />
                <Button size="sm" icon={ArrowRightLeft} onClick={() => setModal('transfer')}>Transfer to another folio</Button>
              </div>
            )}
          </Card>
          <div className="stack">
            <Card title="Folio summary">
              <div className="folio-summary">
                <div className="line"><span>Total charges</span><b className="num">{moneyExact(d.totals.charges_minor, ccy)}</b></div>
                <div className="line"><span className="muted">of which tax</span><span className="num">{moneyExact(d.totals.tax_minor, ccy)}</span></div>
                <div className="line"><span>Payments, credits and transfers</span><b className="num">{moneyExact(d.totals.credits_minor, ccy)}</b></div>
                <div className="line total"><span>Balance</span><span className="num" style={{ color: d.totals.balance_minor > 0 ? 'var(--danger)' : undefined }}>{moneyExact(d.totals.balance_minor, ccy)}</span></div>
                {d.totals.balance_minor === 0 && <Badge tone="good">Settled</Badge>}
              </div>
            </Card>
            <Card title="Quick actions">
              <div className="grid g2" style={{ gap: 8 }}>
                {open && can('folio.post') && <Button icon={Plus} onClick={() => setModal('charge')}>Add charge</Button>}
                {open && can('folio.payment') && <Button icon={CreditCard} onClick={() => setModal('payment')}>Take payment</Button>}
                {open && can('folio.adjust') && <Button icon={Ban} onClick={() => setModal('allowance')}>Allowance</Button>}
                {open && can('folio.adjust') && d.totals.balance_minor < 0 && <Button icon={Undo2} onClick={() => setModal('refund')}>Refund</Button>}
                {open && can('folio.post') && f.reservation_id && <Button icon={SplitSquareHorizontal} onClick={() => setModal('window')}>Split folio</Button>}
                {open && can('folio.transfer') && f.reservation_id && <Button icon={Route} onClick={() => setModal('route')}>Route charges</Button>}
                {open && can('folio.transfer') && d.totals.balance_minor > 0 && <Button icon={ArrowRightLeft} onClick={() => setModal('cityledger')}>To city ledger</Button>}
                {can('invoice.issue') && d.postings.some((p) => !p.invoice_id && (p.net_minor || p.tax_minor)) && (
                  <Button icon={FileText} busy={busy} onClick={() => run(async () => { const inv = await api.post(`/folios/${f.id}/invoice`, {}); navigate(`/invoices/${inv.id}`); }, { success: 'Invoice issued' })}>Issue invoice</Button>
                )}
                {open && can('folio.payment') && d.totals.balance_minor === 0 && (
                  <Button icon={Lock} busy={busy} onClick={() => run(async () => { await api.post(`/folios/${f.id}/close`); reload(); }, { success: 'Folio closed' })}>Close folio</Button>
                )}
              </div>
              {!open && <div className="small muted" style={{ marginTop: 8 }}>Closed {dateTime(f.closed_at)}. Corrections need a credit note against its invoice.</div>}
            </Card>
          </div>
        </div>
      )}
      {tab === 'invoices' && (
        <Card flush>
          <DataTable
            rows={d.invoices}
            empty={<Empty title="No invoices issued from this folio" />}
            onRowClick={(i) => navigate(`/invoices/${i.id}`)}
            columns={[
              { key: 'invoice_no', label: 'Invoice', render: (i) => <b>{i.invoice_no}</b> },
              { key: 'issue_date', label: 'Date', render: (i) => date(i.issue_date) },
              { key: 'bill_to_name', label: 'Bill to' },
              { key: 'net_minor', label: 'Taxable value', num: true, render: (i) => moneyExact(i.net_minor, ccy) },
              { key: 'tax_minor', label: 'Tax', num: true, render: (i) => moneyExact(i.tax_minor, ccy) },
              { key: 'gross_minor', label: 'Total', num: true, render: (i) => moneyExact(i.gross_minor, ccy) },
            ]}
          />
        </Card>
      )}
      {tab === 'routing' && (
        <Card title="Routing instructions" sub="Charges of a department post straight to another window" flush>
          <DataTable rows={d.routes} empty={<Empty title="No routing set">Use “Route charges” to send, for example, room and tax to the company window.</Empty>} columns={[{ key: 'department', label: 'Department', render: (r) => (r.department === '*' ? 'All charges' : titleCase(r.department)) }, { key: 'folio_no', label: 'To folio', render: (r) => `${r.folio_no} · ${r.name}` }]} />
        </Card>
      )}
      {modal === 'charge' && <ChargeModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {(modal === 'payment' || modal === 'refund') && <PaymentModal d={d} refund={modal === 'refund'} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'allowance' && <AllowanceModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.kind === 'reverse' && <ReverseModal posting={modal.posting} ccy={ccy} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'transfer' && <TransferModal d={d} ids={[...selected]} onClose={() => setModal(null)} onDone={() => { setModal(null); setSelected(new Set()); reload(); }} />}
      {modal === 'window' && <WindowModal f={f} onClose={() => setModal(null)} onDone={(w) => { setModal(null); navigate(`/folios/${w.id}`); }} />}
      {modal === 'route' && <RouteModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'cityledger' && <CityLedgerModal f={f} balance={d.totals.balance_minor} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}

function ActionModal({ title, onClose, onSubmit, busy, disabled, children, label = 'Save', err }) {
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={disabled} onClick={onSubmit}>{label}</Button></>}>
      <div className="stack">
        {children}
        {err && <Notice tone="danger">{err.message}</Notice>}
      </div>
    </Modal>
  );
}

function ChargeModal({ d, onClose, onDone }) {
  const { can } = useApp();
  const codes = d.chargeCodes.filter((c) => c.manual || can('folio.adjust'));
  const [f, setF] = useState({ chargeCode: codes[0]?.code || '', amount: '', quantity: 1, description: '' });
  const [key] = useState(newIdempotencyKey);
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  const inclusive = d.folio.currency === 'EUR';
  return (
    <ActionModal title="Post charge" onClose={onClose} busy={busy} disabled={!f.amount} label="Post charge" err={err} onSubmit={() => run(async () => { await api.post(`/folios/${d.folio.id}/charges`, f, { idempotent: key }); onDone(); }, { success: 'Charge posted', onError: setErr })}>
      <Field label="Charge code"><Select value={f.chargeCode} options={codes.map((c) => ({ value: c.code, label: `${c.code} — ${c.name} (${titleCase(c.department)})` }))} onChange={(e) => setF({ ...f, chargeCode: e.target.value })} /></Field>
      <div className="form-grid">
        <Field label={`Unit price (${inclusive ? 'incl.' : 'excl.'} tax)`}><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="Quantity"><Input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></Field>
      </div>
      <Field label="Description (optional)"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="small muted">Tax is calculated from the property’s tax rules for this charge code and today’s business date.</div>
    </ActionModal>
  );
}

function PaymentModal({ d, refund, onClose, onDone }) {
  const bal = d.totals.balance_minor;
  const [f, setF] = useState({ method: d.paymentMethods.find((m) => m.kind === 'card')?.code || d.paymentMethods[0]?.code, amount: String(Math.abs(bal) / 100), reference: '', cardLast4: '' });
  const [key] = useState(newIdempotencyKey);
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  const kind = d.paymentMethods.find((m) => m.code === f.method)?.kind;
  return (
    <ActionModal title={refund ? 'Refund' : 'Take payment'} onClose={onClose} busy={busy} disabled={!f.amount || Number(f.amount) <= 0} label={refund ? 'Refund' : 'Record payment'} err={err} onSubmit={() => run(async () => { await api.post(`/folios/${d.folio.id}/${refund ? 'refunds' : 'payments'}`, { ...f, cardLast4: f.cardLast4 || undefined, reference: f.reference || undefined }, { idempotent: key }); onDone(); }, { success: refund ? 'Refund recorded' : 'Payment recorded', onError: setErr })}>
      <Field label="Method"><Select value={f.method} options={d.paymentMethods.map((m) => ({ value: m.code, label: m.name }))} onChange={(e) => setF({ ...f, method: e.target.value })} /></Field>
      <div className="form-grid">
        <Field label="Amount"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Reference" hint={kind === 'upi' ? 'UPI transaction ID' : kind === 'card' ? 'Terminal authorisation code' : undefined}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        {kind === 'card' && <Field label="Card last four digits" hint="Never enter the full card number"><Input maxLength={4} inputMode="numeric" value={f.cardLast4} onChange={(e) => setF({ ...f, cardLast4: e.target.value.replace(/\D/g, '') })} /></Field>}
      </div>
      <div className="small muted">Card payments are authorised on the payment terminal or provider page; this system stores only references (PCI DSS).</div>
    </ActionModal>
  );
}

function AllowanceModal({ d, onClose, onDone }) {
  const [f, setF] = useState({ chargeCode: 'ROOM', amount: '', reason: '' });
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  return (
    <ActionModal title="Allowance (goodwill or correction credit)" onClose={onClose} busy={busy} disabled={!f.amount || !f.reason} label="Post allowance" err={err} onSubmit={() => run(async () => { await api.post(`/folios/${d.folio.id}/allowances`, f); onDone(); }, { success: 'Allowance posted', onError: setErr })}>
      <Field label="Against charge code"><Select value={f.chargeCode} options={d.chargeCodes.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))} onChange={(e) => setF({ ...f, chargeCode: e.target.value })} /></Field>
      <Field label="Amount (before tax)"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Noisy room — 20% goodwill" /></Field>
    </ActionModal>
  );
}

function ReverseModal({ posting, ccy, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  return (
    <ActionModal title={`Reverse posting ${posting.posting_no}`} onClose={onClose} busy={busy} disabled={!reason} label="Post reversal" err={err} onSubmit={() => run(async () => { await api.post(`/postings/${posting.id}/reverse`, { reason }); onDone(); }, { success: 'Reversal posted', onError: setErr })}>
      <Notice>A mirror posting of {moneyExact(-posting.amount_minor, ccy)} is added; the original stays on the folio and in the audit trail.</Notice>
      <div className="small">{posting.description} · {date(posting.business_date)}</div>
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
    </ActionModal>
  );
}

function TransferModal({ d, ids, onClose, onDone }) {
  const targets = d.siblings.filter((s) => s.id !== d.folio.id && s.status === 'open');
  const [target, setTarget] = useState(targets[0]?.id || '');
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  return (
    <ActionModal title={`Transfer ${ids.length} posting(s)`} onClose={onClose} busy={busy} disabled={!target || !reason} label="Transfer" err={err} onSubmit={() => run(async () => { await api.post('/postings/transfer', { postingIds: ids, targetFolioId: Number(target), reason }); onDone(); }, { success: 'Postings transferred', onError: setErr })}>
      {targets.length ? <Field label="To folio window"><Select value={target} options={targets.map((t) => ({ value: t.id, label: `${t.folio_window}. ${t.name} (${t.folio_no})` }))} onChange={(e) => setTarget(e.target.value)} /></Field> : <Notice tone="warn">Create another window first (“Split folio”).</Notice>}
      <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Company pays room and tax" /></Field>
    </ActionModal>
  );
}

function WindowModal({ f, onClose, onDone }) {
  const companies = useApi('/companies');
  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  const [run, busy] = useAction();
  return (
    <ActionModal title="Split folio — add a window" onClose={onClose} busy={busy} label="Add window" onSubmit={() => run(async () => { const w = await api.post(`/reservations/${f.reservation_id}/folios`, { companyId: companyId ? Number(companyId) : undefined, name: name || undefined }); onDone(w); }, { success: 'Window added' })}>
      <Field label="Bill this window to a company (optional)"><Select value={companyId} placeholder="Guest" options={(companies.data || []).filter((c) => c.kind !== 'ota').map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => setCompanyId(e.target.value)} /></Field>
      <Field label="Window name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Incidentals" /></Field>
    </ActionModal>
  );
}

function RouteModal({ d, onClose, onDone }) {
  const targets = d.siblings.filter((s) => s.status === 'open');
  const [f, setF] = useState({ department: 'rooms', targetFolioId: targets.find((t) => t.id !== d.folio.id)?.id || targets[0]?.id });
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  return (
    <ActionModal title="Route charges" onClose={onClose} busy={busy} label="Save routing" err={err} onSubmit={() => run(async () => { await api.post(`/reservations/${d.folio.reservation_id}/routes`, { ...f, targetFolioId: Number(f.targetFolioId) }); onDone(); }, { success: 'Routing saved', onError: setErr })}>
      <Field label="Department"><Select value={f.department} options={[{ value: 'rooms', label: 'Rooms (room and tax)' }, { value: 'fnb', label: 'Food & beverage' }, { value: 'spa', label: 'Spa' }, { value: 'other', label: 'Other services' }, { value: '*', label: 'All charges' }]} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
      <Field label="Post to window"><Select value={f.targetFolioId} options={targets.map((t) => ({ value: t.id, label: `${t.folio_window}. ${t.name}` }))} onChange={(e) => setF({ ...f, targetFolioId: e.target.value })} /></Field>
      <div className="small muted">Applies to charges posted from now on, including the night audit.</div>
    </ActionModal>
  );
}

function CityLedgerModal({ f, balance, onClose, onDone }) {
  const companies = useApi('/companies');
  const [companyId, setCompanyId] = useState(f.company_id || '');
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  const options = useMemo(() => (companies.data || []).filter((c) => c.ar_enabled), [companies.data]);
  return (
    <ActionModal title="Transfer balance to city ledger" onClose={onClose} busy={busy} disabled={!companyId} label={`Transfer ${moneyExact(balance, f.currency)}`} err={err} onSubmit={() => run(async () => { await api.post(`/folios/${f.id}/city-ledger`, { companyId: Number(companyId) }); onDone(); }, { success: 'Balance moved to the company account', onError: setErr })}>
      <Field label="Company with a credit account"><Select value={companyId} placeholder="Choose" options={options.map((c) => ({ value: c.id, label: `${c.name} · ${c.credit_days} days` }))} onChange={(e) => setCompanyId(e.target.value)} /></Field>
      <div className="small muted">Issue the invoice first if the company needs it; the receivable is then collected in Finance → City ledger.</div>
    </ActionModal>
  );
}
