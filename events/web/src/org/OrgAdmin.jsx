// Organiser console: agenda, finance, gates and printing, messages, reports and settings.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api as call, del, get, post, put } from '../api.js';
import { shrinkImage } from '../images.js';
import {
  Dialog,
  Empty,
  Field,
  FormDialog,
  Loaded,
  Notice,
  Status,
  Tabs,
  useAction,
  useFormDialog,
  useImage,
  useLoad,
  useToast,
} from '../ui.jsx';
import { ago, clock, count, day, dayTime, inr, ROLE_LABELS, weekday } from '../format.js';
import { RESULTS } from '../../../shared/scanRules.js';
import { PageTitle, scanTone, useOrg } from './shared.jsx';

// A configuration list with add, edit and delete, driven by column and field specs.
function CrudList({ title, hint, name, rows, columns, fields, perm, onChanged, toForm = (r) => r, extra }) {
  const { api, can } = useOrg();
  const [edit, setEdit] = useState(null);
  const act = useAction();
  const allowed = can(perm);
  const save = (v) => (edit.id ? put(`${api}/${name}/${edit.id}`, v) : post(`${api}/${name}`, v)).then(onChanged);
  return (
    <section className="panel" aria-label={title}>
      <div className="head">
        <div>
          <h3>{title}</h3>
          {hint && <p className="muted small">{hint}</p>}
        </div>
        {allowed && (
          <button className="btn sm" onClick={() => setEdit({})}>
            Add
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.label}>{c.label}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {columns.map((c) => (
                  <td key={c.label}>{c.render(r)}</td>
                ))}
                <td className="actions">
                  {extra?.(r)}
                  {allowed && (
                    <button className="btn sm plain" onClick={() => setEdit(toForm(r))}>
                      Edit
                    </button>
                  )}
                  {allowed && (
                    <button
                      className="btn sm plain"
                      onClick={() => window.confirm('Delete this?') && act(() => del(`${api}/${name}/${r.id}`).then(onChanged), 'Deleted')}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty>Nothing here yet.</Empty>}
      {edit && (
        <FormDialog
          title={`${edit.id ? 'Edit' : 'Add'}: ${title.toLowerCase()}`}
          fields={fields}
          initial={edit}
          onSubmit={save}
          onClose={() => setEdit(null)}
        />
      )}
    </section>
  );
}
const yesNo = (v) => (v ? 'Yes' : 'No');

// ---------- agenda ----------
export function AgendaAdmin() {
  const { api, cfg, reloadConfig } = useOrg();
  const load = useLoad(() => get(`${api}/sessions`), [api]);
  const speakersText = (list) => list.map((s) => (s.title ? `${s.name}, ${s.title}` : s.name)).join('; ');
  const parseSpeakers = (text) =>
    String(text || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const [name, ...rest] = s.split(',');
        return { name: name.trim(), title: rest.join(',').trim() };
      });
  const days = [];
  for (
    let d = new Date(`${cfg.event.startsOn}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= cfg.event.endsOn;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    days.push(d.toISOString().slice(0, 10));
  const fields = [
    { key: 'title', label: 'Title', required: true },
    { key: 'day', label: 'Day', type: 'select', required: true, options: days.map((d) => ({ value: d, label: weekday(d) })) },
    { key: 'startTime', label: 'Starts', type: 'time', required: true },
    { key: 'endTime', label: 'Ends', type: 'time', required: true },
    { key: 'trackId', label: 'Track', type: 'select', options: cfg.tracks.map((t) => ({ value: t.id, label: t.name })) },
    {
      key: 'roomId',
      label: 'Room',
      type: 'select',
      hint: 'Two sessions cannot share a room at the same time',
      options: cfg.rooms.map((r) => ({ value: r.id, label: r.name })),
    },
    { key: 'speakersText', label: 'Speakers', hint: 'Name, role; Name, role' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'capacity', label: 'Places', type: 'number', hint: 'Leave empty when seating is open' },
    { key: 'seatsTaken', label: 'Places taken', type: 'number' },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      default: 'scheduled',
      options: [
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
  ];
  // The dialog edits speakers as text; the API takes a list.
  const [edit, setEdit] = useState(null);
  const act = useAction();
  const save = ({ speakersText: text, ...v }) => {
    const body = { ...v, speakers: parseSpeakers(text) };
    return (edit.id ? put(`${api}/sessions/${edit.id}`, body) : post(`${api}/sessions`, body)).then(load.reload);
  };
  return (
    <div className="stack">
      <PageTitle title="Agenda">
        <button className="btn primary" onClick={() => setEdit({})}>
          Add session
        </button>
      </PageTitle>
      <Loaded load={load}>
        {(sessions) => (
          <div className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Session</th>
                    <th>Room</th>
                    <th>Track</th>
                    <th>Places</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="num">
                        {day(s.day)}
                        <br />
                        {s.startTime}–{s.endTime}
                      </td>
                      <td>
                        <strong>{s.title}</strong>
                        <div className="muted small">{speakersText(s.speakers)}</div>
                      </td>
                      <td>{cfg.rooms.find((r) => r.id === s.roomId)?.name || '—'}</td>
                      <td>{cfg.tracks.find((t) => t.id === s.trackId)?.name || '—'}</td>
                      <td>
                        {s.status === 'cancelled' ? (
                          <Status tone="error">Cancelled</Status>
                        ) : s.capacity ? (
                          s.seatsTaken >= s.capacity ? (
                            <Status tone="pending">Full ({s.capacity})</Status>
                          ) : (
                            `${s.seatsTaken} of ${s.capacity}`
                          )
                        ) : (
                          'Open'
                        )}
                      </td>
                      <td className="actions">
                        <button className="btn sm plain" onClick={() => setEdit({ ...s, speakersText: speakersText(s.speakers) })}>
                          Edit
                        </button>
                        <button
                          className="btn sm plain"
                          onClick={() =>
                            window.confirm(`Delete "${s.title}"?`) &&
                            act(() => del(`${api}/sessions/${s.id}`).then(load.reload), 'Session deleted')
                          }
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!sessions.length && <Empty>No sessions yet.</Empty>}
          </div>
        )}
      </Loaded>
      <div className="grid2">
        <CrudList
          title="Tracks"
          name="tracks"
          perm="agenda.manage"
          rows={cfg.tracks}
          onChanged={reloadConfig}
          columns={[
            { label: 'Name', render: (t) => t.name },
            { label: 'About', render: (t) => t.description },
          ]}
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'description', label: 'Description' },
          ]}
        />
        <CrudList
          title="Rooms"
          name="rooms"
          perm="agenda.manage"
          rows={cfg.rooms}
          onChanged={reloadConfig}
          columns={[
            { label: 'Name', render: (r) => r.name },
            { label: 'Seats', render: (r) => r.capacity || '—' },
          ]}
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'zoneId', label: 'Area', type: 'select', options: cfg.zones.map((z) => ({ value: z.id, label: z.name })) },
            { key: 'capacity', label: 'Seats', type: 'number' },
          ]}
        />
      </div>
      {edit && (
        <FormDialog
          title={edit.id ? 'Edit session' : 'Add session'}
          fields={fields}
          initial={edit}
          onSubmit={save}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

// ---------- finance ----------
export function Finance() {
  const { api, can } = useOrg();
  const load = useLoad(() => get(`${api}/finance`), [api]);
  const [tab, setTab] = useState('orders');
  const [invoice, setInvoice] = useState(null);
  const [form, ask] = useFormDialog();
  const manage = can('finance.manage');
  return (
    <div className="stack">
      <PageTitle title="Finance">
        {can('reports.finance') && (
          <>
            <a className="btn" href={`/api/v1${api}/reports/orders.csv`}>
              Orders CSV
            </a>
            <a className="btn" href={`/api/v1${api}/reports/payments.csv`}>
              Payments CSV
            </a>
          </>
        )}
      </PageTitle>
      <Loaded load={load}>
        {({ report: r, orders, payments }) => (
          <>
            <div className="strip" role="group" aria-label="Reconciliation totals">
              <div>
                <div className="small">Billed</div>
                <div className="v">{inr(r.billedPaise)}</div>
                <div className="small muted">incl. {inr(r.gstPaise)} GST on paid orders</div>
              </div>
              <div>
                <div className="small">Captured</div>
                <div className="v">{inr(r.capturedPaise)}</div>
              </div>
              <div>
                <div className="small">Outstanding</div>
                <div className="v">{inr(r.outstandingPaise)}</div>
              </div>
              <div>
                <div className="small">Refunded</div>
                <div className="v">{inr(r.refundedPaise)}</div>
              </div>
            </div>
            <section className="panel" aria-label="Reconciliation">
              <div className="head">
                <h3>To reconcile</h3>
                <span className="muted small">
                  Gateway callbacks: {r.callbacks.applied || 0} applied · {r.callbacks.stale || 0} out of order, ignored ·{' '}
                  {r.callbacks.ignored || 0} unmatched
                </span>
              </div>
              <div className="list">
                {r.issues.map((i, n) => (
                  <div key={n}>
                    <Status tone={i.kind === 'refund_due' || i.kind === 'payment_pending' ? 'pending' : 'error'}>
                      {
                        {
                          refund_due: 'Refund due',
                          payment_pending: 'Pending',
                          order_mismatch: 'Mismatch',
                          paid_no_pass: 'No pass',
                          pass_unpaid: 'Unpaid pass',
                          amount_mismatch: 'Amount',
                        }[i.kind]
                      }
                    </Status>
                    <span className="grow">{i.text}</span>
                  </div>
                ))}
                {!r.issues.length && <Empty>Orders, payments and passes agree.</Empty>}
              </div>
            </section>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'orders', label: 'Orders', count: orders.length },
                { value: 'payments', label: 'Payments', count: payments.length },
              ]}
            />
            {tab === 'orders' ? (
              <div className="panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>For</th>
                      <th>Status</th>
                      <th className="right">Total</th>
                      <th className="right">Paid</th>
                      <th className="right">Balance</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td className="num">
                          <strong>{o.number}</strong>
                          <div className="muted small">{o.invoiceNo || 'No invoice yet'}</div>
                        </td>
                        <td>
                          {o.customer}
                          {o.ref && <div className="muted small">{o.ref}</div>}
                        </td>
                        <td>{o.kind}</td>
                        <td>
                          <Status kind="order" value={o.status} />
                        </td>
                        <td className="right num">{inr(o.totalPaise)}</td>
                        <td className="right num">{inr(o.paidPaise)}</td>
                        <td className="right num">{inr(o.balancePaise)}</td>
                        <td className="actions">
                          {o.invoiceNo && (
                            <button className="btn sm plain" onClick={() => setInvoice(o.id)}>
                              Invoice
                            </button>
                          )}
                          {manage && o.balancePaise > 0 && !['cancelled', 'refunded'].includes(o.status) && (
                            <button
                              className="btn sm"
                              onClick={() =>
                                ask({
                                  title: `Record payment for ${o.number}`,
                                  submitLabel: 'Record payment',
                                  initial: { amountPaise: o.balancePaise },
                                  intro: <p className="muted">For money received outside the gateway. This is written to the audit log.</p>,
                                  fields: [
                                    { key: 'amountPaise', label: 'Amount received (₹)', type: 'money', required: true },
                                    {
                                      key: 'method',
                                      label: 'Method',
                                      type: 'select',
                                      required: true,
                                      options: [
                                        { value: 'bank_transfer', label: 'Bank transfer' },
                                        { value: 'cheque', label: 'Cheque' },
                                        { value: 'upi', label: 'UPI (direct)' },
                                        { value: 'cash', label: 'Cash' },
                                      ],
                                    },
                                    { key: 'note', label: 'Bank reference or note', required: true },
                                  ],
                                  onSubmit: (v) => post(`${api}/orders/${o.id}/manual-payment`, v).then(load.reload),
                                })
                              }
                            >
                              Record payment
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Via</th>
                      <th>Status</th>
                      <th className="right">Amount</th>
                      <th>Updated</th>
                      <th>Note</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="num">{p.order}</td>
                        <td>
                          {p.provider}
                          {p.method ? ` · ${p.method}` : ''}
                        </td>
                        <td>
                          <Status kind="payment" value={p.status} />
                          {p.reconciled && <span className="muted small"> by hand</span>}
                        </td>
                        <td className="right num">
                          {inr(p.amountPaise)}
                          {p.refundedPaise > 0 && <div className="muted small">{inr(p.refundedPaise)} refunded</div>}
                        </td>
                        <td className="num">{dayTime(p.statusAt)}</td>
                        <td className="small">{p.note}</td>
                        <td className="actions">
                          {manage && ['created', 'pending', 'failed'].includes(p.status) && (
                            <button
                              className="btn sm"
                              onClick={() =>
                                ask({
                                  title: 'Reconcile payment',
                                  submitLabel: 'Save',
                                  intro: (
                                    <p className="muted">
                                      Check the payment provider's own record first. This is written to the audit log.
                                    </p>
                                  ),
                                  fields: [
                                    {
                                      key: 'status',
                                      label: 'The provider shows this payment as',
                                      type: 'select',
                                      required: true,
                                      options: [
                                        { value: 'captured', label: 'Captured (money received)' },
                                        { value: 'failed', label: 'Failed' },
                                      ],
                                    },
                                    { key: 'note', label: 'Provider reference or note', required: true },
                                  ],
                                  onSubmit: (v) => post(`${api}/payments/${p.id}/reconcile`, v).then(load.reload),
                                })
                              }
                            >
                              Reconcile
                            </button>
                          )}
                          {manage && p.status === 'captured' && (
                            <button
                              className="btn sm"
                              onClick={() =>
                                ask({
                                  title: 'Record refund',
                                  submitLabel: 'Record refund',
                                  initial: { amountPaise: p.amountPaise - p.refundedPaise },
                                  intro: (
                                    <p className="muted">
                                      Record a refund you have issued through the provider. A full refund on a registration revokes its
                                      pass.
                                    </p>
                                  ),
                                  fields: [
                                    { key: 'amountPaise', label: 'Refund amount (₹)', type: 'money', required: true },
                                    { key: 'note', label: 'Reason', required: true },
                                  ],
                                  onSubmit: (v) => post(`${api}/payments/${p.id}/refund`, v).then(load.reload),
                                })
                              }
                            >
                              Refund
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Loaded>
      {form}
      {invoice && <InvoiceDialog path={`${api}/orders/${invoice}/invoice`} onClose={() => setInvoice(null)} />}
    </div>
  );
}

// GST tax invoice, printable. Also used by the exhibitor workspace.
export function InvoiceDialog({ path, onClose }) {
  const load = useLoad(() => get(path), [path]);
  return (
    <Dialog
      title="Tax invoice"
      onClose={onClose}
      wide
      footer={
        <button className="btn primary" onClick={() => window.print()}>
          Print
        </button>
      }
    >
      <Loaded load={load}>
        {(d) => (
          <div className="stack">
            <div className="row between top wrap">
              <div>
                <strong>{d.seller.legalName}</strong>
                <div className="small muted">
                  {d.seller.address}
                  <br />
                  GSTIN {d.seller.gstin || 'not set'}
                  {d.seller.sac ? ` · SAC ${d.seller.sac}` : ''}
                </div>
              </div>
              <dl className="kv">
                <dt>Invoice</dt>
                <dd>{d.invoiceNo}</dd>
                <dt>Date</dt>
                <dd>{day(d.invoicedAt)}</dd>
                <dt>Order</dt>
                <dd>{d.order.number}</dd>
              </dl>
            </div>
            <div>
              <span className="muted small">Billed to</span>
              <br />
              <strong>{d.buyer.name}</strong>
              {d.buyer.company ? `, ${d.buyer.company}` : ''}
              <div className="small muted">
                {d.buyer.address}
                {d.buyer.gstin ? ` · GSTIN ${d.buyer.gstin}` : ''}
              </div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="right">Qty</th>
                  <th className="right">Rate</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {d.order.items.map((i) => (
                  <tr key={i.description}>
                    <td>{i.description}</td>
                    <td className="right num">{i.qty}</td>
                    <td className="right num">{inr(i.unitPaise)}</td>
                    <td className="right num">{inr(i.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="totals" style={{ maxWidth: 320, marginLeft: 'auto', width: '100%' }}>
              <div>
                <span>Taxable value</span>
                <span className="num">{inr(d.order.subtotalPaise)}</span>
              </div>
              {d.tax.igstPaise > 0 ? (
                <div>
                  <span>IGST</span>
                  <span className="num">{inr(d.tax.igstPaise)}</span>
                </div>
              ) : (
                <>
                  <div>
                    <span>CGST</span>
                    <span className="num">{inr(d.tax.cgstPaise)}</span>
                  </div>
                  <div>
                    <span>SGST</span>
                    <span className="num">{inr(d.tax.sgstPaise)}</span>
                  </div>
                </>
              )}
              <div className="strong">
                <span>Total</span>
                <span className="num">{inr(d.order.totalPaise)}</span>
              </div>
              <div>
                <span>Received</span>
                <span className="num">{inr(d.order.paidPaise)}</span>
              </div>
              <div className="strong">
                <span>Balance due</span>
                <span className="num">{inr(d.order.balancePaise)}</span>
              </div>
            </div>
            {d.seller.notes && <p className="muted small">{d.seller.notes}</p>}
          </div>
        )}
      </Loaded>
    </Dialog>
  );
}

// ---------- gates and printing ----------
export function GateOps() {
  const { api } = useOrg();
  const load = useLoad(() => get(`${api}/gate-ops`), [api]);
  const act = useAction();
  const run = (fn, done) => act(() => fn().then(load.reload), done);
  return (
    <div className="stack">
      <PageTitle title="Gates & printing">
        <a className="btn" href={`/api/v1${api}/reports/scans.csv`}>
          Scan log CSV
        </a>
        <Link className="btn primary" to="/gate">
          Open scanner
        </Link>
      </PageTitle>
      <Loaded load={load}>
        {(d) => (
          <>
            <section className="panel" aria-label="Badge print jobs">
              <div className="head">
                <h3>Badge print jobs</h3>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Badge for</th>
                      <th>Gate</th>
                      <th>Printer</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.printJobs]
                      .sort((a, b) => (b.status === 'failed') - (a.status === 'failed'))
                      .slice(0, 25)
                      .map((j) => (
                        <tr key={j.id}>
                          <td>
                            <strong>{j.name}</strong>
                            <div className="muted small">
                              {j.passClass}
                              {j.kind !== 'first' ? ` · ${j.kind}${j.reason ? `: ${j.reason}` : ''}` : ''}
                            </div>
                          </td>
                          <td>{j.gate}</td>
                          <td>{j.printer || '—'}</td>
                          <td>
                            <Status kind="print" value={j.status} />
                            {j.error && (
                              <div className="small" style={{ color: 'var(--error)' }}>
                                {j.error}
                              </div>
                            )}
                          </td>
                          <td className="num">{clock(j.updatedAt)}</td>
                          <td className="actions">
                            {j.status === 'failed' && (
                              <>
                                <button
                                  className="btn sm"
                                  onClick={() => run(() => post(`/gate/print-jobs/${j.id}/retry`), 'Sent to the printer again')}
                                >
                                  Retry
                                </button>
                                <button
                                  className="btn sm primary"
                                  onClick={() => run(() => post(`/gate/print-jobs/${j.id}/spare`), 'Printed on the spare printer')}
                                >
                                  Use spare printer
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!d.printJobs.length && <Empty>No badges printed yet.</Empty>}
            </section>
            <section className="panel" aria-label="Scan conflicts">
              <div className="head">
                <div>
                  <h3>Scan conflicts</h3>
                  <p className="muted small">Two devices accepted the same pass while offline. The earlier scan is the counted entry.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Pass holder</th>
                      <th>Counted entry</th>
                      <th>Conflicting scan</th>
                      <th>Reconciled as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.conflicts.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.holderName}</strong>
                        </td>
                        <td>
                          {clock(c.firstAt)} · {c.firstGate} · {c.firstDevice}
                        </td>
                        <td>
                          {clock(c.scannedAt)} · {c.gate} · {c.device}
                        </td>
                        <td>
                          <Status tone={scanTone(c.result)}>{RESULTS[c.result]?.title}</Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!d.conflicts.length && <Empty>No conflicts.</Empty>}
            </section>
            <section className="panel" aria-label="Devices">
              <div className="head">
                <h3>Scanning devices</h3>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>Gate</th>
                      <th>Enrolled by</th>
                      <th>Status</th>
                      <th className="right">Queued scans</th>
                      <th>Last seen</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.devices.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <strong>{v.name}</strong>
                          <div className="muted small">{v.platform}</div>
                        </td>
                        <td>{v.gate}</td>
                        <td>{v.user}</td>
                        <td>
                          <Status kind="device" value={v.status} />
                        </td>
                        <td className="right num">{v.queued ? <Status tone="pending">{v.queued}</Status> : 0}</td>
                        <td>{ago(v.lastSeenAt)}</td>
                        <td className="actions">
                          {v.status === 'active' && (
                            <button
                              className="btn sm danger"
                              onClick={() =>
                                window.confirm(`Remove ${v.name}? It will clear its saved data on next contact.`) &&
                                run(() => post(`${api}/devices/${v.id}/revoke`), 'Device removed')
                              }
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel" aria-label="Manual overrides">
              <div className="head">
                <h3>Manual overrides</h3>
              </div>
              <div className="list">
                {d.overrides.map((o, i) => (
                  <div key={i}>
                    <span className="num">{dayTime(o.scannedAt)}</span>
                    <span className="grow">
                      <strong>{o.holderName}</strong> at {o.gate}: {o.overrideReason}
                    </span>
                    <span className="muted small">{o.by}</span>
                  </div>
                ))}
                {!d.overrides.length && <Empty>No overrides recorded.</Empty>}
              </div>
            </section>
          </>
        )}
      </Loaded>
    </div>
  );
}

// ---------- messages ----------
export function Comms() {
  const { api, can } = useOrg();
  const load = useLoad(() => get(`${api}/comms`), [api]);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState(null);
  const act = useAction();
  return (
    <div className="stack">
      <PageTitle title="Messages">
        {can('comms.manage') && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            New announcement
          </button>
        )}
      </PageTitle>
      <Loaded load={load}>
        {(d) => (
          <>
            <section className="panel" aria-label="Announcements">
              <div className="head">
                <div>
                  <h3>Announcements</h3>
                  <p className="muted small">
                    Shown in the apps, on the public site and on venue displays. Schedule and gate changes also notify phones that opted in.
                  </p>
                </div>
              </div>
              <div className="list">
                {d.announcements.map((a) => (
                  <div key={a.id}>
                    <span className="grow">
                      <strong>{a.title}</strong> <Status>{a.kind}</Status>
                      <br />
                      <span className="small">{a.body}</span>
                      <br />
                      <span className="muted small">
                        {dayTime(a.publishedAt)} · to {a.audience}
                      </span>
                    </span>
                    {can('comms.manage') && (
                      <button
                        className="btn sm plain"
                        onClick={() =>
                          window.confirm('Remove this announcement?') &&
                          act(() => del(`${api}/announcements/${a.id}`).then(load.reload), 'Removed')
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {!d.announcements.length && <Empty>No announcements yet.</Empty>}
              </div>
            </section>
            <section className="panel" aria-label="Sent messages">
              <div className="head">
                <div>
                  <h3>Sent messages</h3>
                  <p className="muted small">
                    Email: {d.adapters.email}. Push: {d.adapters.push}. WhatsApp: {d.adapters.whatsapp}.
                  </p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sent</th>
                      <th>Channel</th>
                      <th>To</th>
                      <th>Subject</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.outbox.map((o) => (
                      <tr
                        key={o.id}
                        className="click"
                        tabIndex={0}
                        onClick={() => setView(o)}
                        onKeyDown={(e) => e.key === 'Enter' && setView(o)}
                      >
                        <td className="num">{dayTime(o.createdAt)}</td>
                        <td>{o.channel}</td>
                        <td>{o.recipient}</td>
                        <td>{o.subject}</td>
                        <td>
                          <Status kind="outbox" value={o.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!d.outbox.length && <Empty>Nothing sent yet.</Empty>}
            </section>
          </>
        )}
      </Loaded>
      {adding && (
        <FormDialog
          title="New announcement"
          submitLabel="Publish"
          onClose={() => setAdding(false)}
          onSubmit={(v) => post(`${api}/announcements`, v).then(load.reload)}
          fields={[
            { key: 'title', label: 'Title', required: true },
            { key: 'body', label: 'Message', type: 'textarea', required: true },
            {
              key: 'kind',
              label: 'Type',
              type: 'select',
              required: true,
              default: 'general',
              options: [
                { value: 'general', label: 'General (no notification)' },
                { value: 'schedule', label: 'Schedule change (notifies phones)' },
                { value: 'gate', label: 'Gate change (notifies phones)' },
              ],
            },
            {
              key: 'audience',
              label: 'Audience',
              type: 'select',
              required: true,
              default: 'all',
              options: ['all', 'visitors', 'exhibitors', 'staff'],
            },
            { key: 'showOnDisplays', label: 'Show on venue displays', type: 'checkbox', default: true },
          ]}
        />
      )}
      {view && (
        <Dialog title={view.subject || 'Message'} onClose={() => setView(null)}>
          <p className="muted small">
            To {view.recipient} via {view.adapter}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', marginTop: 12 }}>{view.body}</pre>
          {view.error && <Notice tone="error">{view.error}</Notice>}
        </Dialog>
      )}
    </div>
  );
}

// ---------- reports ----------
function Bars({ title, rows, hint }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="panel" aria-label={title}>
      <div className="head">
        <div>
          <h3>{title}</h3>
          {hint && <p className="muted small">{hint}</p>}
        </div>
      </div>
      <div className="body">
        {rows.length ? (
          <div className="bars">
            {rows.map((r) => [
              <span key={`${r.name}l`}>{r.name}</span>,
              <div key={`${r.name}b`}>
                <div className="bar" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>,
              <span key={`${r.name}n`} className="num right">
                {count(r.count)}
              </span>,
            ])}
          </div>
        ) : (
          <span className="muted">No data yet.</span>
        )}
      </div>
    </section>
  );
}
export function Reports() {
  const { api, can } = useOrg();
  const load = useLoad(() => get(`${api}/reports`), [api]);
  const csv = [
    ['registrations', 'Registrations', `${api}/registrations.csv`],
    ['admissions', 'Admissions (unique entries)'],
    ['scans', 'Full scan log'],
    ['exhibitors', 'Exhibitors'],
    ['booths', 'Booth inventory'],
    ...(can('reports.finance')
      ? [
          ['orders', 'Orders'],
          ['payments', 'Payments'],
        ]
      : []),
  ];
  return (
    <div className="stack">
      <PageTitle title="Reports" />
      <section className="panel" aria-label="Downloads">
        <div className="head">
          <div>
            <h3>CSV downloads</h3>
            <p className="muted small">Every download is recorded in the audit log.</p>
          </div>
        </div>
        <div className="body row wrap">
          {csv.map(([k, label, path]) => (
            <a key={k} className="btn" href={`/api/v1${path || `${api}/reports/${k}.csv`}`}>
              {label}
            </a>
          ))}
        </div>
      </section>
      <Loaded load={load}>
        {(d) => (
          <>
            <div className="grid2">
              <Bars
                title="Registrations by pass type"
                hint={d.definitions.registered}
                rows={d.registrationsByPass.map((r) => ({ name: r.name, count: r.registered }))}
              />
              <Bars title="Entries by area" hint={d.definitions.zoneEntries} rows={d.entriesByZone} />
              <Bars title="Entries by day" rows={d.zoneEntriesByDay.map((r) => ({ name: day(r.day), count: r.count }))} />
              <Bars title="Entries by hour, today" rows={d.entriesByHourToday.map((r) => ({ name: r.hour, count: r.count }))} />
              <Bars
                title="Scan results"
                rows={d.scanOutcomes.map((r) => ({ name: RESULTS[r.result]?.title || r.result, count: r.count }))}
              />
              <Bars title="Leads captured by exhibitor" hint={d.definitions.leads} rows={d.leadsByExhibitor} />
            </div>
            <Notice>
              <strong>{count(d.uniqueEntries)} unique entries.</strong> {d.definitions.uniqueEntries}
            </Notice>
            <section className="panel" aria-label="Lead exports">
              <div className="head">
                <h3>Lead exports by exhibitors</h3>
              </div>
              <div className="list">
                {d.leadExports.map((x, i) => (
                  <div key={i}>
                    <span className="num">{dayTime(x.createdAt)}</span>
                    <span className="grow">
                      {x.company}: {x.rowCount} leads
                    </span>
                    <span className="muted small">{x.by}</span>
                  </div>
                ))}
                {!d.leadExports.length && <Empty>No exhibitor has exported leads yet.</Empty>}
              </div>
            </section>
          </>
        )}
      </Loaded>
    </div>
  );
}

// ---------- settings ----------
export function SettingsPage() {
  const { api, cfg, can, role, reloadConfig } = useOrg();
  const [tab, setTab] = useState('event');
  const act = useAction();
  const zoneOptions = cfg.zones.map((z) => ({ value: z.id, label: z.name }));
  const zoneName = (id) => cfg.zones.find((z) => z.id === id)?.name || '—';
  const tabs = [
    { value: 'event', label: 'Event' },
    { value: 'passes', label: 'Passes & form' },
    { value: 'venue', label: 'Venue' },
    { value: 'staff', label: 'Staff' },
    { value: 'privacy', label: 'Privacy & data' },
    ...(role === 'organiser_admin' || role === 'finance' ? [{ value: 'audit', label: 'Audit log' }] : []),
  ];
  return (
    <div className="stack">
      <PageTitle title="Settings" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'event' && <LoginBackground />}
      {tab === 'event' && <EventSettings />}
      {tab === 'passes' && (
        <>
          <CrudList
            title="Pass types"
            name="pass-classes"
            perm="event.manage"
            rows={cfg.passClasses}
            onChanged={reloadConfig}
            hint="Free, paid, invited and approval passes are open to the public. Internal passes are issued by the organiser or to exhibitor teams."
            columns={[
              {
                label: 'Pass',
                render: (c) => (
                  <>
                    <strong>{c.name}</strong>
                    <div className="muted small">{c.code}</div>
                  </>
                ),
              },
              { label: 'How', render: (c) => c.mode },
              { label: 'Price', render: (c) => (c.pricePaise ? `${inr(c.pricePaise)} + ${c.gstPercent}% GST` : 'Free') },
              { label: 'Areas', render: (c) => c.zoneIds.map(zoneName).join(', ') },
              { label: 'Valid', render: (c) => `${day(c.validFrom)} to ${day(c.validTo)}` },
              { label: 'Re-entry', render: (c) => yesNo(c.reentry) },
              { label: 'Lead scans', render: (c) => yesNo(c.leadScannable) },
              { label: 'Open', render: (c) => yesNo(c.active) },
            ]}
            fields={[
              { key: 'code', label: 'Code', required: true },
              { key: 'name', label: 'Name', required: true },
              {
                key: 'kind',
                label: 'Who it is for',
                type: 'select',
                required: true,
                options: ['visitor', 'delegate', 'vip', 'media', 'exhibitor', 'speaker', 'staff'],
              },
              {
                key: 'mode',
                label: 'How people get it',
                type: 'select',
                required: true,
                options: [
                  { value: 'free', label: 'Free registration' },
                  { value: 'paid', label: 'Paid registration' },
                  { value: 'invited', label: 'Invitation code' },
                  { value: 'approval', label: 'Organiser approval' },
                  { value: 'internal', label: 'Issued internally' },
                ],
              },
              { key: 'description', label: 'Description' },
              { key: 'pricePaise', label: 'Price before GST (₹)', type: 'money' },
              { key: 'gstPercent', label: 'GST %', type: 'number', default: 18 },
              { key: 'zoneIds', label: 'Areas this pass opens', type: 'multi', options: zoneOptions },
              { key: 'validFrom', label: 'Valid from', type: 'date' },
              { key: 'validTo', label: 'Valid to', type: 'date' },
              { key: 'capacity', label: 'Limit on passes', type: 'number' },
              { key: 'reentry', label: 'Allow re-entry', type: 'checkbox', default: true },
              { key: 'leadScannable', label: 'Exhibitors may scan this badge for leads', type: 'checkbox' },
              { key: 'active', label: 'Open for new registrations', type: 'checkbox', default: true },
            ]}
          />
          <CrudList
            title="Registration questions"
            name="form-fields"
            perm="event.manage"
            rows={cfg.formFields}
            onChanged={reloadConfig}
            toForm={(f) => ({ ...f, options: f.options.join(', ') })}
            hint="Name, email, company and job title are always asked. Add only what you need."
            columns={[
              { label: 'Question', render: (f) => f.label },
              { label: 'Type', render: (f) => f.type },
              { label: 'Required', render: (f) => yesNo(f.required) },
            ]}
            fields={[
              { key: 'key', label: 'Short key', required: true, hint: 'Letters only, used in exports' },
              { key: 'label', label: 'Question', required: true },
              {
                key: 'type',
                label: 'Answer type',
                type: 'select',
                required: true,
                options: [
                  { value: 'text', label: 'Text' },
                  { value: 'select', label: 'Choose one' },
                  { value: 'checkbox', label: 'Tick box' },
                ],
              },
              { key: 'options', label: 'Choices', hint: 'Comma separated, for "choose one"' },
              { key: 'required', label: 'Required', type: 'checkbox' },
            ]}
          />
          <Invites />
        </>
      )}
      {tab === 'venue' && (
        <>
          <CrudList
            title="Halls and areas"
            name="zones"
            perm="floor.manage"
            rows={cfg.zones}
            onChanged={reloadConfig}
            columns={[
              {
                label: 'Area',
                render: (z) => (
                  <>
                    <strong>{z.name}</strong>
                    <div className="muted small">{z.code}</div>
                  </>
                ),
              },
              { label: 'Type', render: (z) => z.kind },
              { label: 'Floor plan', render: (z) => (z.cols ? `${z.cols} × ${z.rows} m${z.image ? ', with drawing' : ''}` : 'No plan') },
              { label: 'Offline scanning', render: (z) => (z.restricted ? 'Needs online check' : 'Allowed') },
            ]}
            fields={[
              { key: 'code', label: 'Code', required: true },
              { key: 'name', label: 'Name', required: true },
              { key: 'kind', label: 'Type', type: 'select', required: true, options: ['hall', 'conference', 'restricted', 'service'] },
              { key: 'cols', label: 'Hall width (m)', type: 'number', hint: 'Leave empty for areas without a stall plan' },
              { key: 'rows', label: 'Hall depth (m)', type: 'number' },
              { key: 'restricted', label: 'Restricted: scans here must be checked online', type: 'checkbox' },
            ]}
          />
          <CrudList
            title="Gates"
            name="gates"
            perm="floor.manage"
            rows={cfg.gates}
            onChanged={reloadConfig}
            columns={[
              { label: 'Gate', render: (g) => <strong>{g.name}</strong> },
              { label: 'Opens into', render: (g) => zoneName(g.zoneId) },
              { label: 'Direction', render: (g) => (g.direction === 'in' ? 'Entry' : 'Exit') },
            ]}
            fields={[
              { key: 'code', label: 'Code', required: true },
              { key: 'name', label: 'Name', required: true },
              { key: 'zoneId', label: 'Opens into', type: 'select', required: true, options: zoneOptions },
              {
                key: 'direction',
                label: 'Direction',
                type: 'select',
                required: true,
                default: 'in',
                options: [
                  { value: 'in', label: 'Entry' },
                  { value: 'out', label: 'Exit (for occupancy estimates)' },
                ],
              },
              { key: 'x', label: 'Metres from left wall', type: 'number', step: '0.5' },
              { key: 'y', label: 'Metres from top wall', type: 'number', step: '0.5' },
            ]}
          />
          <CrudList
            title="Badge printers"
            name="printers"
            perm="floor.manage"
            rows={cfg.printers}
            onChanged={reloadConfig}
            hint={cfg.adapters.printer}
            columns={[
              { label: 'Printer', render: (p) => <strong>{p.name}</strong> },
              { label: 'Gate', render: (p) => cfg.gates.find((g) => g.id === p.gateId)?.name || (p.isSpare ? 'Spare' : '—') },
              {
                label: 'Status',
                render: (p) => (
                  <Status tone={p.status === 'ready' ? 'ok' : 'error'}>{p.status === 'ready' ? 'Ready' : p.lastError || p.status}</Status>
                ),
              },
            ]}
            fields={[
              { key: 'name', label: 'Name', required: true },
              { key: 'model', label: 'Model' },
              { key: 'gateId', label: 'Gate', type: 'select', options: cfg.gates.map((g) => ({ value: g.id, label: g.name })) },
              { key: 'isSpare', label: 'This is the spare printer', type: 'checkbox' },
              { key: 'status', label: 'Status', type: 'select', required: true, default: 'ready', options: ['ready', 'error', 'offline'] },
              { key: 'lastError', label: 'Fault', hint: 'For example: Out of labels' },
            ]}
          />
          <CrudList
            title="Venue displays"
            name="kiosks"
            perm="floor.manage"
            rows={cfg.kiosks}
            onChanged={reloadConfig}
            hint="Each display has a fixed 'You are here'. Open its link full screen on the kiosk."
            columns={[
              { label: 'Display', render: (k) => <strong>{k.name}</strong> },
              { label: 'Where', render: (k) => zoneName(k.zoneId) },
              { label: 'Shows', render: (k) => k.mode },
            ]}
            extra={(k) => (
              <a className="btn sm plain" href={`/display/${cfg.event.slug}/${k.code}`} target="_blank" rel="noreferrer">
                Open display
              </a>
            )}
            fields={[
              { key: 'code', label: 'Code', required: true },
              { key: 'name', label: 'Name', required: true },
              { key: 'zoneId', label: 'Area', type: 'select', required: true, options: zoneOptions },
              {
                key: 'mode',
                label: 'Shows',
                type: 'select',
                required: true,
                default: 'both',
                options: [
                  { value: 'both', label: 'Map and agenda' },
                  { value: 'map', label: 'Map only' },
                  { value: 'agenda', label: 'Agenda only' },
                ],
              },
              { key: 'x', label: 'You-are-here, metres from left wall', type: 'number', step: '0.5', required: true },
              { key: 'y', label: 'You-are-here, metres from top wall', type: 'number', step: '0.5', required: true },
            ]}
          />
          <CrudList
            title="Exhibitor services"
            name="service-items"
            perm="event.manage"
            rows={cfg.serviceItems}
            onChanged={reloadConfig}
            columns={[
              { label: 'Service', render: (s) => <strong>{s.name}</strong> },
              { label: 'Category', render: (s) => s.category },
              { label: 'Price', render: (s) => `${inr(s.pricePaise)} ${s.unit}` },
            ]}
            fields={[
              { key: 'code', label: 'Code', required: true },
              { key: 'category', label: 'Category', required: true },
              { key: 'name', label: 'Name', required: true },
              { key: 'unit', label: 'Unit', default: 'each' },
              { key: 'pricePaise', label: 'Price before GST (₹)', type: 'money', required: true },
            ]}
          />
        </>
      )}
      {tab === 'staff' && <Staff />}
      {tab === 'privacy' && <Privacy />}
      {tab === 'audit' && <Audit />}
      {tab === 'event' && can('event.manage') && (
        <div className="row">
          <button
            className={`btn ${cfg.event.status === 'published' ? '' : 'primary'}`}
            onClick={() =>
              act(
                () => post(`${api}/publish`, { published: cfg.event.status !== 'published' }).then(reloadConfig),
                cfg.event.status === 'published' ? 'Event is now a draft' : 'Event published',
              )
            }
          >
            {cfg.event.status === 'published' ? 'Unpublish event' : 'Publish event'}
          </button>
          <span className="muted small">
            {cfg.event.status === 'published' ? `Public since ${day(cfg.event.publishedAt)}` : 'Only staff can see a draft.'}
          </span>
        </div>
      )}
    </div>
  );
}

// The photo behind the sign-in page for this exhibition.
function LoginBackground() {
  const { api, cfg, can, reloadConfig } = useOrg();
  const act = useAction();
  const toast = useToast();
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  const preview = useImage(cfg.event.loginImage);
  const upload = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const { blob, ratio } = await shrinkImage(f, 2400);
      if (ratio > 1.2) toast('Tip: a landscape photo works best; the sign-in page crops it to fit each screen.');
      const form = new FormData();
      form.append('file', blob, f.name.replace(/\.[^.]+$/, '') + '.jpg');
      await call(`${api}/login-image`, { method: 'POST', form });
      toast('Sign-in background updated');
      reloadConfig();
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <section className="panel" aria-label="Sign-in page background">
      <div className="head">
        <div>
          <h3>Sign-in page background</h3>
          <p className="muted small">
            The first page everyone sees is the sign-in page, shown over this photo. Use a picture of this exhibition: the venue, last
            year&apos;s show floor or the event&apos;s key visual. A wide landscape photo works best.
          </p>
        </div>
      </div>
      <div className="body row wrap top" style={{ gap: 16 }}>
        <div
          className="login-preview"
          role="img"
          aria-label={preview ? 'Current sign-in background' : 'Standard BrainADZ Live background'}
          style={preview ? { backgroundImage: `url("${preview}")` } : undefined}
        >
          <span>{cfg.event.name}</span>
        </div>
        {can('event.manage') && (
          <div className="stack tight">
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={upload}
            />
            <button type="button" className="btn primary" disabled={busy} onClick={() => file.current.click()}>
              {busy ? 'Uploading…' : cfg.event.loginImage ? 'Change photo' : 'Upload photo'}
            </button>
            {cfg.event.loginImage && (
              <button
                type="button"
                className="btn plain"
                onClick={() => act(() => del(`${api}/login-image`).then(reloadConfig), 'Standard background restored')}
              >
                Use the standard background
              </button>
            )}
            <p className="muted small">PNG or JPG. Large photos are resized before upload.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function EventSettings() {
  const { api, cfg, can, reloadConfig } = useOrg();
  const [f, setF] = useState({ ...cfg.event, faqsText: cfg.event.faqs.map((x) => `${x.q}\n${x.a}`).join('\n\n') });
  const act = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = (e) => {
    e.preventDefault();
    const faqs = f.faqsText
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean)
      .map((b) => {
        const [q, ...a] = b.split('\n');
        return { q, a: a.join(' ') || '-' };
      });
    act(() => put(api, { ...f, faqs }).then(reloadConfig), 'Event saved');
  };
  const input = (k, label, props = {}) => (
    <Field label={label}>
      <input className="input" value={f[k] || ''} onChange={set(k)} {...props} />
    </Field>
  );
  return (
    <form className="panel" onSubmit={save}>
      <fieldset className="body stack" disabled={!can('event.manage')} style={{ border: 0, margin: 0 }}>
        <div className="grid2">
          {input('name', 'Event name', { required: true })}
          {input('edition', 'Edition')}
        </div>
        {input('tagline', 'Tagline')}
        <Field label="Description">
          <textarea className="input" value={f.description || ''} onChange={set('description')} />
        </Field>
        <div className="grid2">
          {input('venueName', 'Venue')}
          {input('city', 'City')}
        </div>
        {input('venueAddress', 'Venue address')}
        <div className="grid2">
          {input('startsOn', 'First day', { type: 'date', required: true })}
          {input('endsOn', 'Last day', { type: 'date', required: true })}
        </div>
        <div className="grid2">
          {input('openTime', 'Opens', { type: 'time' })}
          {input('closeTime', 'Closes', { type: 'time' })}
        </div>
        <Field label="Accessibility information">
          <textarea className="input" value={f.accessibility || ''} onChange={set('accessibility')} />
        </Field>
        <Field label="Questions and answers" hint="Question on one line, answer on the next. Leave a blank line between questions.">
          <textarea className="input" style={{ minHeight: 180 }} value={f.faqsText} onChange={set('faqsText')} />
        </Field>
        <p className="muted small">Times use the event timezone ({cfg.event.timezone}).</p>
        <div>
          <button className="btn primary">Save event</button>
        </div>
      </fieldset>
    </form>
  );
}

function Invites() {
  const { api, cfg, can } = useOrg();
  const load = useLoad(() => get(`${api}/invites`), [api]);
  const [adding, setAdding] = useState(false);
  const invited = cfg.passClasses.filter((c) => c.mode === 'invited');
  return (
    <section className="panel" aria-label="Invitation codes">
      <div className="head">
        <div>
          <h3>Invitation codes</h3>
          <p className="muted small">For invited pass types. A code can be tied to one email address.</p>
        </div>
        {can('reg.manage') && invited.length > 0 && (
          <button className="btn sm" onClick={() => setAdding(true)}>
            Add
          </button>
        )}
      </div>
      <Loaded load={load}>
        {(rows) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Pass</th>
                  <th>For</th>
                  <th>Used</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td className="num">
                      <strong>{i.code}</strong>
                    </td>
                    <td>{i.passClass}</td>
                    <td>{i.email || i.note || 'Anyone with the code'}</td>
                    <td className="num">
                      {i.usedCount} of {i.maxUses}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
      {adding && (
        <FormDialog
          title="New invitation code"
          submitLabel="Create code"
          onClose={() => setAdding(false)}
          onSubmit={(v) => post(`${api}/invites`, v).then(load.reload)}
          fields={[
            {
              key: 'passClassId',
              label: 'Pass type',
              type: 'select',
              required: true,
              options: invited.map((c) => ({ value: c.id, label: c.name })),
            },
            { key: 'email', label: 'Only for this email', type: 'email' },
            { key: 'note', label: 'Note' },
            { key: 'maxUses', label: 'Times it can be used', type: 'number', default: 1, required: true },
            { key: 'expiresOn', label: 'Expires after', type: 'date' },
          ]}
        />
      )}
    </section>
  );
}

function Staff() {
  const { api, cfg, can } = useOrg();
  const load = useLoad(() => get(`${api}/staff`), [api]);
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const manage = can('staff.manage');
  return (
    <section className="panel" aria-label="Staff">
      <div className="head">
        <div>
          <h3>Staff and roles</h3>
          <p className="muted small">
            Gate staff are limited to one gate. Supervisors can override and reprint. Each role sees only its own screens.
          </p>
        </div>
        {manage && (
          <button className="btn sm" onClick={() => setAdding(true)}>
            Add
          </button>
        )}
      </div>
      <Loaded load={load}>
        {(rows) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Gate</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <div className="muted small">{m.email}</div>
                    </td>
                    <td>
                      {ROLE_LABELS[m.role]}
                      {m.eventId == null && <span className="muted small"> · all events</span>}
                    </td>
                    <td>{m.gateName || (m.role.startsWith('gate') ? 'All gates' : '—')}</td>
                    <td>{ago(m.lastLogin)}</td>
                    <td className="actions">
                      {manage && (
                        <button
                          className="btn sm plain"
                          onClick={() =>
                            window.confirm(`Remove ${m.name}'s access? They are signed out and their devices are cleared.`) &&
                            act(() => del(`${api}/staff/${m.id}`).then(load.reload), 'Access removed')
                          }
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
      {adding && (
        <FormDialog
          title="Add staff member"
          submitLabel="Add"
          onClose={() => setAdding(false)}
          onSubmit={(v) => post(`${api}/staff`, v).then(load.reload)}
          intro={<p className="muted">They sign in with this email using a one-time code, or with the password you set here.</p>}
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'email', label: 'Email', type: 'email', required: true },
            {
              key: 'role',
              label: 'Role',
              type: 'select',
              required: true,
              options: ['organiser_admin', 'organiser_staff', 'finance', 'gate_supervisor', 'gate_staff'].map((r) => ({
                value: r,
                label: ROLE_LABELS[r],
              })),
            },
            {
              key: 'gateId',
              label: 'Gate (for gate staff)',
              type: 'select',
              options: cfg.gates.map((g) => ({ value: g.id, label: g.name })),
            },
            { key: 'password', label: 'Password', type: 'password', hint: 'At least 8 characters with letters and numbers' },
          ]}
        />
      )}
    </section>
  );
}

function Privacy() {
  const { api, cfg, can, reloadConfig } = useOrg();
  const s = cfg.settings;
  const [fields, setFields] = useState(s.leadSharing.fields);
  const [notice, setNotice] = useState(s.leadSharing.notice);
  const [retention, setRetention] = useState(s.retentionDays);
  const [tags, setTags] = useState(s.interestTags.join(', '));
  const act = useAction();
  const all = [
    ['name', 'Name'],
    ['company', 'Company'],
    ['jobTitle', 'Job title'],
    ['email', 'Email'],
    ['phone', 'Mobile number'],
  ];
  return (
    <form
      className="panel"
      onSubmit={(e) => (
        e.preventDefault(),
        act(
          () =>
            put(api, { settings: { leadSharing: { fields, notice }, retentionDays: Number(retention), interestTags: tags } }).then(
              reloadConfig,
            ),
          'Saved',
        )
      )}
    >
      <fieldset className="body stack" disabled={!can('event.manage')} style={{ border: 0, margin: 0 }}>
        <div>
          <h3>Lead sharing policy</h3>
          <p className="muted small">
            What an exhibitor receives when a visitor lets them scan a badge. Visitors see this notice when they register and can opt out.
          </p>
          {all.map(([k, label]) => (
            <label key={k} className="check">
              <input
                type="checkbox"
                checked={fields.includes(k)}
                onChange={(e) => setFields(e.target.checked ? [...fields, k] : fields.filter((x) => x !== k))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <Field label="Notice shown at registration">
          <textarea className="input" value={notice} onChange={(e) => setNotice(e.target.value)} />
        </Field>
        <Field label="Interest tags offered to booth staff" hint="Comma separated">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field
          label="Keep personal data for this many days after the event"
          hint="After this an administrator can remove names and contact details. Counts and money totals remain."
        >
          <input
            className="input"
            type="number"
            min="30"
            max="3650"
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            style={{ maxWidth: 160 }}
          />
        </Field>
        <div className="row wrap">
          <button className="btn primary">Save</button>
          {can('data.purge') && (
            <button
              type="button"
              className="btn danger"
              onClick={() =>
                window.confirm('Remove personal data for this event? This cannot be undone.') &&
                act(() => post(`${api}/purge`), 'Personal data removed')
              }
            >
              Remove personal data now
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

function Audit() {
  const { api } = useOrg();
  const load = useLoad(() => get(`${api}/audit`), [api]);
  return (
    <section className="panel" aria-label="Audit log">
      <div className="head">
        <div>
          <h3>Audit log</h3>
          <p className="muted small">Approvals, allocations, overrides, reprints, finance actions and exports.</p>
        </div>
      </div>
      <Loaded load={load}>
        {(rows) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className="num">{dayTime(a.createdAt)}</td>
                    <td>{a.actor}</td>
                    <td>{a.action}</td>
                    <td className="small">
                      {a.detail
                        ? Object.entries(a.detail)
                            .filter(([, v]) => v != null)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(' · ')
                        : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <Empty>Nothing recorded yet.</Empty>}
          </div>
        )}
      </Loaded>
    </section>
  );
}
