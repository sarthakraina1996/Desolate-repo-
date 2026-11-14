// Exhibitor workspace: booth and orders, setup checklist, team badges, leads and the
// one-handed scan-and-qualify view for booth staff. The server scopes everything to the
// signed-in person's own company.
import logo from '../assets/brainadz-live.png';
import { createContext, useContext, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Coins, FileText, Home, IdCard, ScanLine, ShieldCheck, Store, Users, Wifi } from 'lucide-react';
import { api as call, del, get, goTo, post, put } from '../api.js';
import { useMe } from '../App.jsx';
import { Empty, Field, FormDialog, Loaded, Notice, Status, useAction, useFormDialog, useLoad } from '../ui.jsx';
import { QrCamera } from '../camera.jsx';
import { InvoiceDialog } from '../org/OrgAdmin.jsx';
import { ago, day, dayTime, inr, ROLE_LABELS } from '../format.js';

const ExCtx = createContext(null);
const useEx = () => useContext(ExCtx);
const RATINGS = [
  ['hot', 'Hot'],
  ['warm', 'Warm'],
  ['cold', 'Cold'],
];

export default function ExhShell() {
  const { xid } = useParams();
  const { me, signOut } = useMe();
  const nav = useNavigate();
  const mine = me.exhibitor.find((x) => String(x.exhibitorId) === xid);
  const load = useLoad(() => get(`/exhibitor/${xid}`), [xid]);
  if (!mine) return <Navigate to="/account" replace />;
  const can = (perm) => mine.perms.includes(perm);
  const base = `/x/${xid}`;
  return (
    <Loaded load={load}>
      {(ws) => {
        const approved = ws.exhibitor.status === 'approved';
        const items = [
          { to: '', label: 'Overview', icon: Home, end: true },
          ...(approved
            ? [
                { to: 'booth', label: 'Booth & orders', icon: Store },
                { to: 'team', label: 'Team badges', icon: IdCard },
                { to: 'leads', label: 'Leads', icon: Users },
              ]
            : []),
          ...(can('x.manage') ? [{ to: 'profile', label: approved ? 'Company profile' : 'Application', icon: FileText }] : []),
        ];
        return (
          <ExCtx.Provider value={{ ws, xid, base, api: `/exhibitor/${xid}`, can, reload: load.reload }}>
            <Routes>
              <Route path="scan" element={<LeadScan />} />
              <Route
                path="*"
                element={
                  <div className="shell">
                    <aside className="side no-print">
                      <Link to={base} className="brand" aria-label="BrainADZ Live">
                        <img src={logo} alt="BrainADZ Live" width="85" height="40" />
                      </Link>
                      <nav aria-label="Workspace">
                        {items.map((n) => (
                          <NavLink key={n.to} to={n.to ? `${base}/${n.to}` : base} end={n.end} className="nav-item">
                            <n.icon aria-hidden="true" />
                            {n.label}
                          </NavLink>
                        ))}
                      </nav>
                      <div className="foot stack tight">
                        <span>
                          {me.user.name}
                          <br />
                          <span className="muted">{ROLE_LABELS[mine.role]}</span>
                        </span>
                        <button className="btn sm" onClick={() => signOut().then(() => nav('/', { replace: true }))}>
                          Sign out
                        </button>
                      </div>
                    </aside>
                    <div>
                      <div className="topbar no-print">
                        <strong>{ws.event.name}</strong>
                        <span className="muted">/ Exhibitor workspace</span>
                        <span className="grow" />
                        <Link className="btn sm" to="/account">
                          My badge
                        </Link>
                      </div>
                      <main id="main" className="page">
                        <Routes>
                          <Route index element={<Overview />} />
                          <Route path="booth" element={<Booth />} />
                          <Route path="team" element={<Team />} />
                          <Route path="leads" element={<Leads />} />
                          <Route path="profile" element={<Profile />} />
                          <Route path="*" element={<Navigate to={base} replace />} />
                        </Routes>
                      </main>
                    </div>
                    <nav className="tabbar no-print" aria-label="Workspace">
                      {items.slice(0, 4).map((n) => (
                        <NavLink key={n.to} to={n.to ? `${base}/${n.to}` : base} end={n.end}>
                          <n.icon className="icon" aria-hidden="true" />
                          {n.label.split(' ')[0]}
                        </NavLink>
                      ))}
                      {approved && can('x.leads.capture') && (
                        <NavLink to={`${base}/scan`}>
                          <ScanLine className="icon" aria-hidden="true" />
                          Scan
                        </NavLink>
                      )}
                    </nav>
                  </div>
                }
              />
            </Routes>
          </ExCtx.Provider>
        );
      }}
    </Loaded>
  );
}

// Leads with the booth, hall and the one thing to do next.
function Head() {
  const { ws, base, can } = useEx();
  const b = ws.booth;
  const next = ws.next;
  const action =
    (next.key === 'pay' || next.key === 'checklist:balance') && can('x.orders') ? (
      <Link className="btn primary" to={`${base}/booth`}>
        {b?.status === 'held' ? 'Pay deposit' : 'Pay balance'}
      </Link>
    ) : next.key === 'submit' && can('x.manage') ? (
      <Link className="btn primary" to={`${base}/profile`}>
        Open application
      </Link>
    ) : next.key === 'checklist:team' && can('x.team') ? (
      <Link className="btn primary" to={`${base}/team`}>
        Invite staff
      </Link>
    ) : next.key.startsWith('checklist:') && can('x.manage') ? (
      <Link className="btn primary" to={`${base}/booth`}>
        Open checklist
      </Link>
    ) : ws.exhibitor.status === 'approved' && can('x.leads.capture') ? (
      <Link className="btn primary" to={`${base}/scan`}>
        Scan a badge
      </Link>
    ) : null;
  return (
    <div className="title">
      <div>
        <div className="row wrap">
          <h1>{b ? `Booth ${b.code}` : ws.exhibitor.companyName}</h1>
          {b ? <Status kind="booth" value={b.status} /> : <Status kind="exhibitor" value={ws.exhibitor.status} />}
        </div>
        <p className="muted" style={{ fontSize: 18 }}>
          {b ? `${b.hall} / ${ws.exhibitor.companyName}` : ws.event.name}
        </p>
        <p style={{ marginTop: 8 }}>
          <span className="eyebrow">Next</span> {next.text}
        </p>
      </div>
      <div className="no-print">{action}</div>
    </div>
  );
}

const CHECK_ICON = { profile: Store, stand_drawing: FileText, power_wifi: Wifi, team: Users, balance: Coins, safety: ShieldCheck };
function Checklist({ actions }) {
  const { ws, base, api, can, reload } = useEx();
  const act = useAction();
  const file = useRef(null);
  const [target, setTarget] = useState(null);
  const upload = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const form = new FormData();
    form.append('file', f);
    act(() => call(`${api}/checklist/${target}/upload`, { method: 'POST', form }).then(reload), 'Uploaded. The organiser will review it.');
    e.target.value = '';
  };
  if (!ws.checklist.length) return <Empty>Your checklist appears once the application is approved.</Empty>;
  return (
    <div className="list">
      <input ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={upload} />
      {ws.checklist.map((c) => {
        const Icon = CHECK_ICON[c.key] || FileText;
        const open = c.status === 'todo' || c.status === 'changes_requested';
        return (
          <div key={c.id} style={c.status === 'complete' ? { background: 'var(--selected)' } : undefined}>
            <Icon className="icon" aria-hidden="true" />
            <span className="grow">
              <strong>{c.title}</strong>
              <br />
              <span
                className={`small ${c.overdue ? '' : 'muted'}`}
                style={c.overdue ? { color: 'var(--error)', fontWeight: 600 } : undefined}
              >
                {c.status === 'complete' ? 'Done' : `${c.overdue ? 'Overdue, was due' : 'Due'} ${day(c.dueOn)}`}
              </span>
              {c.note && (
                <>
                  <br />
                  <span className="small" style={{ color: 'var(--error)' }}>
                    Organiser: {c.note}
                  </span>
                </>
              )}
            </span>
            {c.key === 'team' && c.status !== 'complete' ? (
              <Status>
                {ws.team.length} of {ws.badgeQuota} added
              </Status>
            ) : (
              <Status kind="checklist" value={c.status} />
            )}
            {actions &&
              open &&
              can('x.manage') &&
              (c.kind === 'upload' ? (
                <button className="btn sm" onClick={() => (setTarget(c.id), file.current.click())}>
                  Upload file
                </button>
              ) : c.kind === 'confirm' ? (
                <button className="btn sm" onClick={() => act(() => post(`${api}/checklist/${c.id}/confirm`).then(reload), 'Confirmed')}>
                  Confirm
                </button>
              ) : c.kind === 'team' ? (
                <Link className="btn sm" to={`${base}/team`}>
                  Add staff
                </Link>
              ) : c.kind === 'profile' ? (
                <Link className="btn sm" to={`${base}/profile`}>
                  Edit profile
                </Link>
              ) : null)}
            {actions && c.hasUpload && (
              <a className="btn sm plain" href={`/api/v1${api}/checklist/${c.id}/file`}>
                View
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OrderSummary() {
  const { ws } = useEx();
  const t = ws.totals;
  if (!ws.orders.length) return <Empty>No orders yet.</Empty>;
  return (
    <div className="totals">
      {ws.orders.map((o) => (
        <div key={o.id}>
          <span>
            {o.kind === 'booth' ? 'Stand package' : 'Services'}
            <span className="muted small"> · {o.number}</span>
          </span>
          <span className="num">{inr(o.totalPaise)}</span>
        </div>
      ))}
      <div>
        <span>Received</span>
        <span className="num" style={{ color: 'var(--ok)' }}>
          {inr(t.paidPaise)}
        </span>
      </div>
      <div className="strong">
        <span>Balance due</span>
        <span className="num">{inr(t.balancePaise)}</span>
      </div>
    </div>
  );
}

function Overview() {
  const { ws, base, can } = useEx();
  const x = ws.exhibitor;
  return (
    <div className="stack">
      <Head />
      {x.status === 'changes_requested' && (
        <Notice tone="pending">
          <strong>The organiser asked for changes.</strong> {x.reviewNote}
        </Notice>
      )}
      {x.status === 'rejected' && (
        <Notice tone="error">
          <strong>Not approved.</strong> {x.reviewNote}
        </Notice>
      )}
      {x.status === 'submitted' && (
        <Notice tone="pending">Submitted {dayTime(x.submittedAt)}. You will get an email when the organiser decides.</Notice>
      )}
      {x.status === 'approved' && (
        <>
          <div className="split">
            <section className="panel" aria-label="Setup checklist">
              <div className="head">
                <h3>Setup checklist</h3>
                <Link className="btn sm" to={`${base}/booth`}>
                  Open
                </Link>
              </div>
              <Checklist />
            </section>
            <section className="panel" aria-label="Order summary">
              <div className="head">
                <h3>Order summary</h3>
              </div>
              <div className="body">
                <OrderSummary />
              </div>
            </section>
          </div>
          {can('x.leads.view') && (
            <section className="panel" aria-label="Recent leads">
              <div className="head">
                <h3>Recent leads</h3>
                <Link className="btn sm" to={`${base}/leads`}>
                  All {ws.leadCount} leads
                </Link>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ws.recentLeads.map((l) => (
                      <tr key={l.id}>
                        <td>{l.name}</td>
                        <td>{l.company}</td>
                        <td>{l.tags.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!ws.recentLeads.length && <Empty>No leads yet. Scan a visitor's badge at your booth to capture one.</Empty>}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Booth() {
  const { ws, api, can, reload } = useEx();
  const act = useAction();
  const [invoice, setInvoice] = useState(null);
  const [shop, setShop] = useState(false);
  const pay = (o, amountPaise) => act(async () => goTo((await post(`${api}/orders/${o.id}/checkout`, { amountPaise })).url));
  return (
    <div className="stack">
      <Head />
      <div className="split">
        <section className="panel" aria-label="Setup checklist">
          <div className="head">
            <h3>Setup checklist</h3>
          </div>
          <Checklist actions />
        </section>
        <section className="panel" aria-label="Order summary">
          <div className="head">
            <h3>Order summary</h3>
          </div>
          <div className="body">
            <OrderSummary />
          </div>
        </section>
      </div>
      <section className="panel" aria-label="Orders">
        <div className="head">
          <h3>Orders</h3>
          {can('x.orders') && (
            <button className="btn sm" onClick={() => setShop(true)}>
              Order power, Wi-Fi and services
            </button>
          )}
        </div>
        <div className="list">
          {ws.orders.map((o) => {
            const deposit = o.kind === 'booth' && o.paidPaise === 0 ? Math.round(o.totalPaise / 2) : null;
            return (
              <div key={o.id} style={{ alignItems: 'flex-start' }}>
                <span className="grow">
                  <strong>{o.number}</strong> <Status kind="order" value={o.status} />
                  {o.items.map((i) => (
                    <div key={i.description} className="small">
                      {i.qty} × {i.description}
                    </div>
                  ))}
                  <div className="muted small">
                    {inr(o.subtotalPaise)} + {inr(o.gstPaise)} GST = {inr(o.totalPaise)}
                    {o.dueOn ? ` · due ${day(o.dueOn)}` : ''}
                  </div>
                </span>
                <span className="row wrap" style={{ justifyContent: 'flex-end' }}>
                  {o.invoiceNo && (
                    <button className="btn sm plain" onClick={() => setInvoice(o.id)}>
                      Invoice
                    </button>
                  )}
                  {can('x.orders') && o.balancePaise > 0 && deposit && (
                    <button className="btn sm primary" onClick={() => pay(o, deposit)}>
                      Pay 50% deposit {inr(deposit)}
                    </button>
                  )}
                  {can('x.orders') && o.balancePaise > 0 && (
                    <button className={`btn sm ${deposit ? '' : 'primary'}`} onClick={() => pay(o)}>
                      Pay {deposit ? 'in full ' : 'balance '}
                      {inr(o.balancePaise)}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {!ws.orders.length && <Empty>Your stand order appears here once a booth is allocated.</Empty>}
        </div>
      </section>
      {shop && <Services onClose={() => setShop(false)} onDone={reload} />}
      {invoice && <InvoiceDialog path={`${api}/orders/${invoice}/invoice`} onClose={() => setInvoice(null)} />}
    </div>
  );
}

function Services({ onClose, onDone }) {
  const { api } = useEx();
  const load = useLoad(() => get(`${api}/services`), [api]);
  if (!load.data) return null;
  return (
    <FormDialog
      title="Order services"
      submitLabel="Place order"
      onClose={onClose}
      intro={<p className="muted">Enter a quantity for what you need. Prices are before 18% GST. You can pay from the orders list.</p>}
      fields={load.data.map((s) => ({ key: s.code, label: `${s.name}, ${inr(s.pricePaise)} ${s.unit}`, type: 'number' }))}
      onSubmit={(v) =>
        post(`${api}/service-orders`, {
          items: Object.entries(v)
            .filter(([, q]) => Number(q) > 0)
            .map(([code, qty]) => ({ code, qty: Number(qty) })),
        }).then(onDone)
      }
    />
  );
}

function Team() {
  const { ws, api, can, reload } = useEx();
  const [adding, setAdding] = useState(false);
  const act = useAction();
  const full = ws.team.length >= ws.badgeQuota;
  return (
    <div className="stack">
      <div className="title">
        <div>
          <h1>Team badges</h1>
          <p className="muted">
            {ws.team.length} of {ws.badgeQuota} badges used. Each person gets an exhibitor badge and signs in with their own email.
          </p>
        </div>
        {can('x.team') && (
          <button className="btn primary" disabled={full} onClick={() => setAdding(true)}>
            Invite staff
          </button>
        )}
      </div>
      {full && <Notice tone="pending">All badges are in use. Ask the organiser if you need a larger quota.</Notice>}
      <div className="panel list">
        {ws.team.map((t) => (
          <div key={t.id}>
            <span className="grow">
              <strong>{t.name}</strong>
              <br />
              <span className="muted small">{t.email}</span>
            </span>
            <span className="muted small">
              {t.role === 'exhibitor_admin' ? 'Admin: booth, orders, team, export' : 'Booth staff: scan and view leads'}
            </span>
            <Status kind="team" value={t.status} />
            {can('x.team') && (
              <button
                className="btn sm plain"
                onClick={() =>
                  window.confirm(`Remove ${t.name}? Their badge stops working.`) &&
                  act(() => del(`${api}/team/${t.id}`).then(reload), 'Removed')
                }
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {adding && (
        <FormDialog
          title="Invite staff"
          submitLabel="Send invitation"
          onClose={() => setAdding(false)}
          onSubmit={(v) => post(`${api}/team`, v).then(reload)}
          fields={[
            { key: 'name', label: 'Name on badge', required: true },
            { key: 'email', label: 'Email', type: 'email', required: true },
            {
              key: 'role',
              label: 'Role',
              type: 'select',
              required: true,
              default: 'booth_staff',
              options: [
                { value: 'booth_staff', label: 'Booth staff (scan and view leads)' },
                { value: 'exhibitor_admin', label: 'Admin (also orders, team and lead export)' },
              ],
            },
          ]}
        />
      )}
    </div>
  );
}

function Leads() {
  const { ws, api, base, can } = useEx();
  const [q, setQ] = useState('');
  const [rating, setRating] = useState('');
  const [tag, setTag] = useState('');
  const qs = new URLSearchParams(Object.entries({ q, rating, tag }).filter(([, v]) => v)).toString();
  const load = useLoad(() => get(`${api}/leads?${qs}`), [api, qs]);
  const [form, ask] = useFormDialog();
  const tags = [...new Set([...ws.interestTags, ...(load.data || []).flatMap((l) => l.tags)])];
  const edit = (l) =>
    ask({
      title: l.name,
      initial: { ...l, tags: l.tags.join(', ') },
      fields: [
        { key: 'rating', label: 'Rating', type: 'select', options: RATINGS.map(([value, label]) => ({ value, label })) },
        { key: 'tags', label: 'Interest tags', hint: 'Comma separated' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSubmit: (v) => put(`${api}/leads/${l.id}`, v).then(load.reload),
    });
  return (
    <div className="stack">
      <div className="title">
        <div>
          <h1>Leads</h1>
          <p className="muted">Visitors whose badges your team scanned. Each visitor appears once, however many times they were scanned.</p>
        </div>
        <div className="row wrap">
          {can('x.leads.export') && (
            <a className="btn" href={`/api/v1${api}/leads/export.csv?${qs}`}>
              Export CSV
            </a>
          )}
          {can('x.leads.capture') && (
            <Link className="btn primary" to={`${base}/scan`}>
              Scan a badge
            </Link>
          )}
        </div>
      </div>
      <div className="toolbar">
        <input
          className="input grow"
          type="search"
          placeholder="Search name, company or notes"
          aria-label="Search leads"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input" aria-label="Rating" value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">Rating: all</option>
          {RATINGS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Interest" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Interest: all</option>
          {tags.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <Loaded load={load}>
        {(rows) => (
          <div className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Interest</th>
                    <th>Rating</th>
                    <th>Notes</th>
                    <th>Last scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr
                      key={l.id}
                      className="click"
                      tabIndex={0}
                      onClick={() => can('x.leads.capture') && edit(l)}
                      onKeyDown={(e) => e.key === 'Enter' && can('x.leads.capture') && edit(l)}
                    >
                      <td>
                        <strong>{l.name}</strong>
                        <div className="muted small">{[l.jobTitle, l.email].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{l.company}</td>
                      <td>{l.tags.join(', ')}</td>
                      <td>
                        {l.rating ? (
                          <Status tone={l.rating === 'hot' ? 'error' : l.rating === 'warm' ? 'pending' : ''}>
                            {l.rating[0].toUpperCase() + l.rating.slice(1)}
                          </Status>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="small" style={{ maxWidth: 280 }}>
                        {l.notes}
                      </td>
                      <td className="small">
                        {ago(l.lastScannedAt)}
                        {l.scanCount > 1 ? ` · ${l.scanCount} scans` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <Empty>No leads match.</Empty>}
          </div>
        )}
      </Loaded>
      {!can('x.leads.export') && <p className="muted small">Only an exhibitor admin can export leads. Exports are logged.</p>}
      {form}
    </div>
  );
}

// One-handed scan-and-qualify: scan, tap a rating and tags, save, scan the next badge.
function LeadScan() {
  const { ws, api, base, reload } = useEx();
  const [lead, setLead] = useState(null);
  const [dup, setDup] = useState(false);
  const [error, setError] = useState(null);
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState({ rating: '', tags: [], notes: '' });
  const scan = (qr) =>
    post(`${api}/leads/scan`, { qr })
      .then(
        (out) => (
          setLead(out.lead),
          setDup(out.duplicate),
          setError(null),
          setQ({ rating: out.lead.rating || '', tags: out.lead.tags, notes: out.lead.notes || '' })
        ),
      )
      .catch((e) => setError(e.message));
  const save = () =>
    put(`${api}/leads/${lead.id}`, q)
      .then(() => (setLead(null), reload()))
      .catch((e) => setError(e.message));
  return (
    <div className="scanner">
      <header className="row between">
        <Link to={`${base}/leads`} className="btn plain" aria-label="Back to leads">
          <ArrowLeft />
        </Link>
        <div>
          <strong>{ws.booth ? `Booth ${ws.booth.code}` : ws.exhibitor.companyName}</strong>
          <div className="muted small">Lead capture</div>
        </div>
        <span style={{ width: 40 }} />
      </header>
      {lead ? (
        <>
          <main id="main">
            <div className="result ok">
              <div>
                <div className="t">{dup ? 'Already a lead' : 'Lead saved'}</div>
                <div>{dup ? `Scanned ${lead.scanCount} times. Details updated.` : 'Add what you learned.'}</div>
              </div>
            </div>
            <div>
              <h2>{lead.name}</h2>
              <p className="muted">{[lead.jobTitle, lead.company].filter(Boolean).join(', ')}</p>
            </div>
            <div>
              <div className="label">How interested?</div>
              <div className="chips" style={{ marginTop: 4 }}>
                {RATINGS.map(([v, l]) => (
                  <button
                    key={v}
                    className="chip"
                    style={{ minHeight: 44, flex: 1 }}
                    aria-pressed={q.rating === v}
                    onClick={() => setQ({ ...q, rating: q.rating === v ? '' : v })}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="label">Interested in</div>
              <div className="chips" style={{ marginTop: 4 }}>
                {[...new Set([...ws.interestTags, ...q.tags])].map((t) => (
                  <button
                    key={t}
                    className="chip"
                    style={{ minHeight: 44 }}
                    aria-pressed={q.tags.includes(t)}
                    onClick={() => setQ({ ...q, tags: q.tags.includes(t) ? q.tags.filter((x) => x !== t) : [...q.tags, t] })}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Notes (optional)">
              <textarea className="input" value={q.notes} onChange={(e) => setQ({ ...q, notes: e.target.value })} />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
          </main>
          <footer>
            <button className="btn primary big block" onClick={save}>
              Save and scan next
            </button>
          </footer>
        </>
      ) : (
        <main id="main">
          <QrCamera onCode={scan} />
          {error ? (
            <Notice tone="error">{error}</Notice>
          ) : (
            <p className="muted" role="status">
              Point the camera at the QR on a visitor's badge. Ask before you scan.
            </p>
          )}
          <form className="row" onSubmit={(e) => (e.preventDefault(), typed && scan(typed), setTyped(''))}>
            <input
              className="input"
              placeholder="Or scan with a USB scanner / paste a code"
              aria-label="Badge code"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button className="btn">Add</button>
          </form>
        </main>
      )}
    </div>
  );
}

// Application (while it can still change) and the public company profile.
function Profile() {
  const { ws, api, reload } = useEx();
  const x = ws.exhibitor;
  const editable = ['draft', 'changes_requested'].includes(x.status);
  const [f, setF] = useState({
    ...x,
    categoriesText: x.categories.join(', '),
    catalogueUrl: x.catalogueLinks[0]?.url || '',
    hall: x.spacePref.hall || '',
    kind: x.spacePref.kind || 'shell',
    sizeSqm: x.spacePref.sizeSqm || 9,
  });
  const act = useAction();
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = (submit) =>
    act(
      () =>
        put(api, {
          ...f,
          categories: f.categoriesText,
          catalogueLinks: f.catalogueUrl ? [{ label: 'Product catalogue', url: f.catalogueUrl }] : [],
          spacePref: { hall: f.hall, kind: f.kind, sizeSqm: Number(f.sizeSqm) },
          submit,
        }).then(reload),
      submit ? 'Application submitted' : 'Saved',
    );
  const input = (k, label, props = {}) => (
    <Field label={label}>
      <input className="input" value={f[k] || ''} onChange={set(k)} {...props} />
    </Field>
  );
  return (
    <form className="stack" style={{ maxWidth: 640 }} onSubmit={(e) => (e.preventDefault(), save(editable))}>
      <div className="title">
        <h1>{editable ? 'Application' : 'Company profile'}</h1>
        <Status kind="exhibitor" value={x.status} />
      </div>
      {x.status === 'changes_requested' && (
        <Notice tone="pending">
          <strong>Changes requested.</strong> {x.reviewNote}
        </Notice>
      )}
      {editable && (
        <>
          {input('companyName', 'Company name', { required: true })}
          {input('industry', 'Industry', { required: true })}
          {input('contactName', 'Contact name', { required: true })}
          {input('contactEmail', 'Contact email', { type: 'email', required: true })}
          {input('contactPhone', 'Contact phone', { type: 'tel', required: true })}
          {input('billingName', 'Billing name', { required: true })}
          {input('gstin', 'GSTIN (optional)')}
          <Field label="Billing address">
            <textarea className="input" value={f.billingAddress || ''} onChange={set('billingAddress')} required />
          </Field>
          <Field label="Stand type">
            <select className="input" value={f.kind} onChange={set('kind')}>
              <option value="shell">Shell scheme</option>
              <option value="raw">Raw space</option>
              <option value="premium">Premium corner</option>
            </select>
          </Field>
          <Field label="Stand size in square metres">
            <input className="input" type="number" min="6" value={f.sizeSqm} onChange={set('sizeSqm')} />
          </Field>
        </>
      )}
      <Field label="What you are showing" hint="Shown in the exhibitor directory">
        <textarea className="input" value={f.description || ''} onChange={set('description')} />
      </Field>
      {input('categoriesText', 'Product categories', { placeholder: 'Digital signage, Video walls' })}
      {input('website', 'Website', { type: 'url', placeholder: 'https://' })}
      {input('catalogueUrl', 'Catalogue link', { type: 'url', placeholder: 'https://' })}
      {x.status === 'approved' && (
        <label className="check">
          <input type="checkbox" checked={Boolean(f.profilePublished)} onChange={set('profilePublished')} />
          <span>Show our company in the public exhibitor directory and on the floor plan</span>
        </label>
      )}
      <div className="row wrap">
        <button className="btn primary">{editable ? 'Submit application' : 'Save profile'}</button>
        {editable && (
          <button type="button" className="btn" onClick={() => save(false)}>
            Save draft
          </button>
        )}
      </div>
    </form>
  );
}
