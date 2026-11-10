// Organiser console: shell and the day-to-day screens (live operations, registrations,
// exhibitors, floor plan). Configuration, finance and reporting live in OrgAdmin.jsx.
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Coins,
  Contact,
  Map as MapIcon,
  Megaphone,
  Radio,
  ScanLine,
  Settings,
  Users,
} from 'lucide-react';
import { get, post, put } from '../api.js';
import { useMe } from '../App.jsx';
import { Dialog, Empty, FormDialog, Loaded, Notice, Status, Tabs, useAction, useFormDialog, useLoad } from '../ui.jsx';
import { HallPlan } from '../components.jsx';
import { clock, count, dateRange, day, dayTime, inr, ROLE_LABELS, STATES } from '../format.js';
import { RESULTS } from '../../../shared/scanRules.js';
import { AgendaAdmin, Comms, Finance, GateOps, Reports, SettingsPage } from './OrgAdmin.jsx';
import { OrgCtx, PageTitle, scanTone, useOrg } from './shared.jsx';

// Picks the event to open: the only one, or a list.
export function OrgHome() {
  const { me } = useMe();
  if (me.organiser.length === 1) return <Navigate to={`/org/${me.organiser[0].eventId}`} replace />;
  return (
    <main id="main" className="site-main narrow stack">
      <h1>Your events</h1>
      <div className="panel list">
        {me.organiser.map((o) => (
          <Link key={o.eventId} className="list-row" to={`/org/${o.eventId}`}>
            <span className="grow">
              <strong>{o.name}</strong>
              <br />
              <span className="muted small">{ROLE_LABELS[o.role]}</span>
            </span>
            <Status tone={o.status === 'published' ? 'ok' : ''}>{o.status === 'published' ? 'Published' : 'Draft'}</Status>
          </Link>
        ))}
        {!me.organiser.length && (
          <Empty>
            You do not have organiser access. <Link to="/account">Go to my passes</Link>
          </Empty>
        )}
      </div>
    </main>
  );
}

const NAV = [
  { to: '', label: 'Live operations', icon: Radio, perm: 'event.view', end: true },
  { to: 'registrations', label: 'Registrations', icon: Contact, perm: 'reg.view' },
  { to: 'exhibitors', label: 'Exhibitors', icon: Users, perm: 'exh.view' },
  { to: 'floor', label: 'Floor plan', icon: MapIcon, perm: 'exh.view' },
  { to: 'agenda', label: 'Agenda', icon: CalendarDays, perm: 'event.view' },
  { to: 'finance', label: 'Finance', icon: Coins, perm: 'finance.view' },
  { to: 'gates', label: 'Gates & printing', icon: ScanLine, perm: 'gate.view' },
  { to: 'messages', label: 'Messages', icon: Megaphone, perm: 'event.view' },
  { to: 'reports', label: 'Reports', icon: BarChart3, perm: 'reports.view' },
  { to: 'settings', label: 'Settings', icon: Settings, perm: 'event.view' },
];

export default function OrgShell() {
  const { eid } = useParams();
  const { me, signOut } = useMe();
  const nav = useNavigate();
  const mine = me.organiser.find((o) => String(o.eventId) === eid);
  const load = useLoad(() => get(`/org/events/${eid}`), [eid]);
  if (!mine) return <Navigate to="/org" replace />;
  const can = (perm) => mine.perms.includes('*') || mine.perms.includes(perm);
  const base = `/org/${eid}`;
  const items = NAV.filter((n) => can(n.perm));
  return (
    <Loaded load={load}>
      {(cfg) => (
        <OrgCtx.Provider value={{ eid, base, api: `/org/events/${eid}`, cfg, can, role: mine.role, reloadConfig: load.reload }}>
          <div className="shell">
            <aside className="side no-print">
              <Link to={base} className="brand">
                BrainADZ Events
              </Link>
              <nav aria-label="Console">
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
                <button className="btn sm" onClick={() => signOut().then(() => nav('/signin'))}>
                  Sign out
                </button>
              </div>
            </aside>
            <div>
              <div className="topbar no-print">
                <strong style={{ fontSize: 18 }}>{cfg.event.name}</strong>
                <span className="muted small">
                  {dateRange(cfg.event.startsOn, cfg.event.endsOn)} · {cfg.event.venueName}
                </span>
                <span className="grow" />
                {cfg.event.status !== 'published' && <Status tone="pending">Draft, not public</Status>}
                <a className="btn sm" href={`/e/${cfg.event.slug}`} target="_blank" rel="noreferrer">
                  Public site
                </a>
              </div>
              <main id="main" className="page">
                <Routes>
                  <Route index element={<Live />} />
                  <Route path="registrations" element={<Registrations />} />
                  <Route path="exhibitors" element={<Exhibitors />} />
                  <Route path="floor" element={<Floor />} />
                  <Route path="agenda" element={<AgendaAdmin />} />
                  <Route path="finance" element={<Finance />} />
                  <Route path="gates" element={<GateOps />} />
                  <Route path="messages" element={<Comms />} />
                  <Route path="reports" element={<Reports />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to={base} replace />} />
                </Routes>
              </main>
            </div>
            <nav className="tabbar no-print" aria-label="Console">
              {items.slice(0, 5).map((n) => (
                <NavLink key={n.to} to={n.to ? `${base}/${n.to}` : base} end={n.end}>
                  <n.icon className="icon" aria-hidden="true" />
                  {n.label.split(' ')[0]}
                </NavLink>
              ))}
            </nav>
          </div>
        </OrgCtx.Provider>
      )}
    </Loaded>
  );
}

// ---------- live operations ----------
function Live() {
  const { api, base } = useOrg();
  const load = useLoad(() => get(`${api}/live`), [api]);
  useEffect(() => {
    const t = setInterval(load.reload, 15000);
    return () => clearInterval(t);
  }, [load.reload]);
  return (
    <Loaded load={load}>
      {(d) => (
        <div className="stack">
          <PageTitle title="Live operations">
            <span className="muted">{day(d.today)} · updates every 15 seconds</span>
          </PageTitle>
          <div className="strip" role="group" aria-label="Headline numbers">
            <div>
              <div className="small">Registered</div>
              <div className="v">{count(d.metrics.registered)}</div>
            </div>
            <div>
              <div className="small">Checked in (unique entries)</div>
              <div className="v">{count(d.metrics.checkedIn)}</div>
              <div className="small muted">{count(d.metrics.checkedInToday)} today</div>
            </div>
            <div>
              <div className="small">Booths confirmed</div>
              <div className="v">
                {d.metrics.boothsConfirmed} / {d.metrics.boothsTotal}
              </div>
            </div>
            <div>
              <div className="small">Estimated inside now</div>
              <div className="v">{d.occupancy.tracked ? count(d.occupancy.estimate) : '—'}</div>
              <div className="small muted">
                {d.occupancy.tracked ? 'Entries minus exits; an estimate' : 'Not tracked: no exit scanning'}
              </div>
            </div>
          </div>
          <div className="split">
            <section className="panel" aria-label="Gate status">
              <div className="head">
                <h3>Gate status</h3>
                <Link to={`${base}/gates`} className="btn sm">
                  Devices and printers
                </Link>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Gate</th>
                      <th>Status</th>
                      <th className="right">Scans today</th>
                      <th className="right">Admitted</th>
                      <th className="right">Last scan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.gates.map((g) => (
                      <tr key={g.id}>
                        <td>
                          <strong>{g.name}</strong>
                          <div className="muted small">{g.zone}</div>
                        </td>
                        <td>
                          <Status tone={STATES.gate[g.status][0]}>{g.statusText}</Status>
                        </td>
                        <td className="right num">{count(g.scansToday)}</td>
                        <td className="right num">{count(g.admittedToday)}</td>
                        <td className="right num">{clock(g.lastScanAt) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel" aria-label="Needs attention">
              <div className="head">
                <h3>Needs attention</h3>
              </div>
              <div className="list">
                {d.attention.map((a) => (
                  <Link key={a.key} className="list-row" to={`${base}/${a.link}`}>
                    <span className="grow">{a.text}</span>
                    <ChevronRight className="icon" aria-hidden="true" />
                  </Link>
                ))}
                {!d.attention.length && <Empty>Nothing needs attention.</Empty>}
              </div>
            </section>
          </div>
          <section className="panel" aria-label="Recent scans">
            <div className="head">
              <h3>Recent scans</h3>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Gate</th>
                    <th>Pass holder</th>
                    <th>Pass</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentScans.map((s) => (
                    <tr key={s.id}>
                      <td className="num">{clock(s.scannedAt)}</td>
                      <td>{s.gate}</td>
                      <td>{s.holderName || '—'}</td>
                      <td>{s.className || '—'}</td>
                      <td>
                        <Status tone={scanTone(s.result)}>{RESULTS[s.result]?.title || s.result}</Status>
                        {s.conflict ? (
                          <>
                            {' '}
                            <Status tone="error">Conflict</Status>
                          </>
                        ) : null}
                        {s.mode === 'offline' && <span className="muted small"> offline</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Loaded>
  );
}

// ---------- registrations ----------
function Registrations() {
  const { api, cfg, can } = useOrg();
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') || '',
    status: params.get('status') || '',
    payment: params.get('payment') || '',
    passClass: params.get('passClass') || '',
    admitted: params.get('admitted') || '',
    page: params.get('page') || '1',
  };
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const load = useLoad(() => get(`${api}/registrations?${qs}`), [api, qs]);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const setFilter = (k, v) =>
    setParams({ ...Object.fromEntries(Object.entries({ ...filters, [k]: v, page: '' }).filter(([, x]) => x)) }, { replace: true });
  const select = (k, label, options) => (
    <select className="input" aria-label={label} value={filters[k]} onChange={(e) => setFilter(k, e.target.value)}>
      <option value="">{label}: all</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
  return (
    <div className="stack">
      <PageTitle title="Registrations">
        {can('reports.view') && (
          <a className="btn" href={`/api/v1${api}/registrations.csv?${qs}`}>
            Export CSV
          </a>
        )}
        {can('reg.manage') && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Register at desk
          </button>
        )}
      </PageTitle>
      <div className="toolbar">
        <input
          className="input grow"
          type="search"
          placeholder="Search name, email, company or reference"
          aria-label="Search registrations"
          defaultValue={filters.q}
          onKeyDown={(e) => e.key === 'Enter' && setFilter('q', e.target.value)}
          onBlur={(e) => e.target.value !== filters.q && setFilter('q', e.target.value)}
        />
        {select(
          'status',
          'Status',
          Object.entries(STATES.registration).map(([v, s]) => [v, s[1]]),
        )}
        {select(
          'payment',
          'Payment',
          ['not_required', 'pending', 'paid', 'failed', 'refunded'].map((v) => [v, STATES.payment[v][1]]),
        )}
        {select(
          'passClass',
          'Pass',
          cfg.passClasses.map((c) => [c.code, c.name]),
        )}
        {select('admitted', 'Admitted', [
          ['yes', 'Admitted'],
          ['no', 'Not yet admitted'],
        ])}
      </div>
      <Loaded load={load}>
        {(d) => (
          <div className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Pass</th>
                    <th>Registration</th>
                    <th>Payment</th>
                    <th>Admission</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr
                      key={r.id}
                      className="click"
                      tabIndex={0}
                      onClick={() => setOpen(r.id)}
                      onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}
                    >
                      <td className="num">{r.ref}</td>
                      <td>
                        <strong>{r.name}</strong>
                        <div className="muted small">{r.email}</div>
                      </td>
                      <td>{r.company}</td>
                      <td>{r.passClass}</td>
                      <td>
                        <Status kind="registration" value={r.status} />
                      </td>
                      <td>
                        <Status kind="payment" value={r.paymentStatus} />
                      </td>
                      <td>
                        {r.admittedAt ? <Status tone="ok">Admitted {clock(r.admittedAt)}</Status> : <span className="muted">Not yet</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.rows.length && <Empty>No registrations match these filters.</Empty>}
            <div className="row between" style={{ padding: '8px 16px' }}>
              <span className="muted small" role="status">
                {count(d.total)} registrations
              </span>
              <span className="row">
                <button
                  className="btn sm"
                  disabled={d.page <= 1}
                  onClick={() => setParams({ ...Object.fromEntries(params), page: String(d.page - 1) })}
                >
                  Previous
                </button>
                <span className="small">
                  Page {d.page} of {Math.max(1, Math.ceil(d.total / d.pageSize))}
                </span>
                <button
                  className="btn sm"
                  disabled={d.page * d.pageSize >= d.total}
                  onClick={() => setParams({ ...Object.fromEntries(params), page: String(d.page + 1) })}
                >
                  Next
                </button>
              </span>
            </div>
          </div>
        )}
      </Loaded>
      {open && <RegistrationDialog id={open} onClose={() => setOpen(null)} onChanged={load.reload} />}
      {adding && (
        <FormDialog
          title="Register at desk"
          intro={
            <p className="muted">For walk-ins the desk has seen in person. Free passes are issued at once; paid passes wait for payment.</p>
          }
          submitLabel="Register"
          fields={[
            {
              key: 'passClass',
              label: 'Pass type',
              type: 'select',
              required: true,
              options: cfg.passClasses.filter((c) => c.kind !== 'exhibitor' && c.active).map((c) => ({ value: c.code, label: c.name })),
            },
            { key: 'name', label: 'Full name', required: true },
            { key: 'email', label: 'Email', type: 'email', required: true },
            { key: 'phone', label: 'Mobile number' },
            { key: 'company', label: 'Company' },
            { key: 'jobTitle', label: 'Job title' },
          ]}
          onSubmit={(v) => post(`${api}/registrations`, v).then(load.reload)}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function RegistrationDialog({ id, onClose, onChanged }) {
  const { api, can } = useOrg();
  const load = useLoad(() => get(`${api}/registrations/${id}`), [id]);
  const act = useAction();
  const [form, ask] = useFormDialog();
  const run = (fn, done) => act(() => fn().then(() => (load.reload(), onChanged())), done);
  return (
    <Dialog title="Registration" onClose={onClose} wide>
      <Loaded load={load}>
        {(r) => (
          <div className="stack">
            <div className="row between wrap">
              <div>
                <h2>{r.name}</h2>
                <span className="muted">{[r.jobTitle, r.company].filter(Boolean).join(', ')}</span>
              </div>
              <div className="row wrap">
                <Status kind="registration" value={r.status} />
                <Status kind="payment" value={r.paymentStatus} />
              </div>
            </div>
            <dl className="kv">
              <dt>Reference</dt>
              <dd>{r.ref}</dd>
              <dt>Pass type</dt>
              <dd>{r.passClass.name}</dd>
              <dt>Email</dt>
              <dd>
                {r.email}
                {r.contactVerifiedAt ? '' : ' (not confirmed)'}
              </dd>
              <dt>Phone</dt>
              <dd>{r.phone || '—'}</dd>
              <dt>Registered</dt>
              <dd>
                {dayTime(r.createdAt)} via {r.source}
              </dd>
              {Object.entries(r.answers).map(([k, v]) => (
                <FragmentKV key={k} k={k} v={v === true ? 'Yes' : v === false ? 'No' : v} />
              ))}
              <dt>Lead sharing</dt>
              <dd>{r.leadOptOut ? 'Opted out' : 'Allowed when badge is scanned'}</dd>
              {r.reviewNote && (
                <>
                  <dt>Review note</dt>
                  <dd>{r.reviewNote}</dd>
                </>
              )}
            </dl>
            {r.orders.map((o) => (
              <div key={o.id} className="row between">
                <span>
                  Order {o.number} · {inr(o.totalPaise)}
                </span>
                <Status kind="order" value={o.status} />
              </div>
            ))}
            {r.scans.length > 0 && (
              <div>
                <h3>Scans</h3>
                <div className="list">
                  {r.scans.map((s, i) => (
                    <div key={i}>
                      <span className="num">{dayTime(s.scannedAt)}</span>
                      <span className="grow">{s.gate}</span>
                      <Status tone={scanTone(s.result)}>{RESULTS[s.result]?.title || s.result}</Status>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {can('reg.manage') && (
              <div className="row wrap">
                {r.status === 'pending_review' && (
                  <button
                    className="btn primary"
                    onClick={() =>
                      run(
                        () => post(`${api}/registrations/${id}/decision`, { decision: 'approve' }),
                        'Approved. The visitor has been emailed.',
                      )
                    }
                  >
                    Approve
                  </button>
                )}
                {r.status === 'pending_review' && (
                  <button
                    className="btn"
                    onClick={() =>
                      ask({
                        title: 'Reject registration',
                        submitLabel: 'Reject',
                        fields: [{ key: 'note', label: 'Note for the visitor', type: 'textarea', required: true }],
                        onSubmit: (v) =>
                          post(`${api}/registrations/${id}/decision`, { decision: 'reject', ...v }).then(
                            () => (load.reload(), onChanged()),
                          ),
                      })
                    }
                  >
                    Reject…
                  </button>
                )}
                {!['unverified', 'cancelled'].includes(r.status) && (
                  <button
                    className="btn"
                    onClick={() => run(() => post(`${api}/registrations/${id}/resend`), 'A new pass link has been emailed')}
                  >
                    Resend pass link
                  </button>
                )}
                {r.status !== 'cancelled' && (
                  <button
                    className="btn danger"
                    onClick={() =>
                      window.confirm(`Cancel ${r.name}'s registration? Their pass will stop working.`) &&
                      run(() => post(`${api}/registrations/${id}/cancel`), 'Registration cancelled')
                    }
                  >
                    Cancel registration
                  </button>
                )}
              </div>
            )}
            {form}
          </div>
        )}
      </Loaded>
    </Dialog>
  );
}
const FragmentKV = ({ k, v }) => (
  <>
    <dt>{k}</dt>
    <dd>{String(v)}</dd>
  </>
);

// ---------- exhibitors ----------
function Exhibitors() {
  const { api } = useOrg();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const load = useLoad(() => get(`${api}/exhibitors`), [api]);
  const [open, setOpen] = useState(null);
  return (
    <div className="stack">
      <PageTitle title="Exhibitors">
        <a className="btn" href={`/api/v1${api}/reports/exhibitors.csv`}>
          Export CSV
        </a>
      </PageTitle>
      <Loaded load={load}>
        {(all) => {
          const n = (s) => all.filter((e) => e.status === s).length;
          const rows = all.filter((e) => !status || e.status === status);
          return (
            <>
              <Tabs
                value={status}
                onChange={(v) => setParams(v ? { status: v } : {}, { replace: true })}
                tabs={[
                  { value: '', label: 'All', count: all.length },
                  { value: 'submitted', label: 'Awaiting review', count: n('submitted') },
                  { value: 'approved', label: 'Approved', count: n('approved') },
                  { value: 'changes_requested', label: 'Changes requested', count: n('changes_requested') },
                  { value: 'rejected', label: 'Not approved', count: n('rejected') },
                ]}
              />
              <div className="panel">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Application</th>
                        <th>Booth</th>
                        <th className="right">Paid / billed</th>
                        <th>To review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e) => (
                        <tr
                          key={e.id}
                          className="click"
                          tabIndex={0}
                          onClick={() => setOpen(e.id)}
                          onKeyDown={(k) => k.key === 'Enter' && setOpen(e.id)}
                        >
                          <td>
                            <strong>{e.companyName}</strong>
                            <div className="muted small">{e.industry}</div>
                          </td>
                          <td>
                            <Status kind="exhibitor" value={e.status} />
                          </td>
                          <td>
                            {e.boothCode ? (
                              <>
                                <strong>{e.boothCode}</strong> <Status kind="booth" value={e.boothStatus} />
                              </>
                            ) : (
                              <span className="muted">Not allocated</span>
                            )}
                          </td>
                          <td className="right num">{e.billedPaise ? `${inr(e.paidPaise)} / ${inr(e.billedPaise)}` : '—'}</td>
                          <td>
                            {e.toReview ? (
                              <Status tone="pending">
                                {e.toReview} upload{e.toReview > 1 ? 's' : ''}
                              </Status>
                            ) : (
                              ''
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length && <Empty>No exhibitors here.</Empty>}
              </div>
            </>
          );
        }}
      </Loaded>
      {open && <ExhibitorDialog id={open} onClose={() => setOpen(null)} onChanged={load.reload} />}
    </div>
  );
}

function ExhibitorDialog({ id, onClose, onChanged }) {
  const { api, can } = useOrg();
  const load = useLoad(() => get(`${api}/exhibitors/${id}`), [id]);
  const floor = useLoad(() => get(`${api}/floor`), [api]);
  const act = useAction();
  const [form, ask] = useFormDialog();
  const [boothId, setBoothId] = useState('');
  const refresh = () => (load.reload(), floor.reload(), onChanged());
  const run = (fn, done) => act(() => fn().then(refresh), done);
  const review = (decision, title) =>
    ask({
      title,
      submitLabel: title,
      fields: [{ key: 'note', label: 'Note for the exhibitor', type: 'textarea', required: true }],
      onSubmit: (v) => post(`${api}/exhibitors/${id}/review`, { decision, ...v }).then(refresh),
    });
  const free = (floor.data || []).flatMap((z) => z.booths.filter((b) => b.status === 'available').map((b) => ({ ...b, hall: z.name })));
  return (
    <Dialog title="Exhibitor" onClose={onClose} wide>
      <Loaded load={load}>
        {({ exhibitor: x, booth, orders, checklist, team, leadCount }) => (
          <div className="stack">
            <div className="row between wrap">
              <div>
                <h2>{x.companyName}</h2>
                <span className="muted">{x.industry}</span>
              </div>
              <Status kind="exhibitor" value={x.status} />
            </div>
            {x.reviewNote && <Notice tone="pending">Note sent to exhibitor: {x.reviewNote}</Notice>}
            <dl className="kv">
              <dt>Contact</dt>
              <dd>
                {x.contactName} · {x.contactEmail} · {x.contactPhone}
              </dd>
              <dt>Billing</dt>
              <dd>
                {x.billingName}
                {x.gstin ? ` · GSTIN ${x.gstin}` : ''}
                <br />
                {x.billingAddress}
              </dd>
              <dt>Space wanted</dt>
              <dd>
                {[x.spacePref.hall, x.spacePref.kind, x.spacePref.sizeSqm && `${x.spacePref.sizeSqm} sq m`].filter(Boolean).join(' · ')}
              </dd>
              <dt>Showing</dt>
              <dd>{x.description || '—'}</dd>
              <dt>Leads captured</dt>
              <dd>{leadCount} (lead details stay with the exhibitor)</dd>
            </dl>
            {x.status === 'submitted' && can('exh.review') && (
              <div className="row wrap">
                <button
                  className="btn primary"
                  onClick={() =>
                    run(() => post(`${api}/exhibitors/${id}/review`, { decision: 'approve' }), 'Approved. The exhibitor has been emailed.')
                  }
                >
                  Approve application
                </button>
                <button className="btn" onClick={() => review('changes', 'Request changes')}>
                  Request changes…
                </button>
                <button className="btn danger" onClick={() => review('reject', 'Reject application')}>
                  Reject…
                </button>
              </div>
            )}
            {x.status === 'approved' && (
              <section className="stack tight" aria-label="Booth">
                <h3>Booth</h3>
                {booth ? (
                  <div className="row between wrap">
                    <span>
                      <strong>{booth.code}</strong>, {booth.hall} <Status kind="booth" value={booth.status} />
                      {booth.holdExpiresAt && <span className="muted small"> hold ends {dayTime(booth.holdExpiresAt)}</span>}
                    </span>
                    {can('exh.allocate') && (
                      <span className="row">
                        {booth.status === 'held' && (
                          <button
                            className="btn sm"
                            onClick={() => run(() => post(`${api}/assignments/${booth.assignmentId}/confirm`), 'Booth confirmed')}
                          >
                            Confirm without deposit
                          </button>
                        )}
                        <button
                          className="btn sm danger"
                          onClick={() =>
                            window.confirm(`Release booth ${booth.code}?`) &&
                            run(() => post(`${api}/assignments/${booth.assignmentId}/release`), 'Booth released')
                          }
                        >
                          Release
                        </button>
                      </span>
                    )}
                  </div>
                ) : can('exh.allocate') ? (
                  <div className="row wrap">
                    <select
                      className="input grow"
                      aria-label="Booth to allocate"
                      value={boothId}
                      onChange={(e) => setBoothId(e.target.value)}
                      style={{ width: 'auto' }}
                    >
                      <option value="">Choose an available booth…</option>
                      {free.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} · {b.hall} · {b.sizeSqm} sq m · {inr(b.pricePaise)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn primary"
                      disabled={!boothId}
                      onClick={() =>
                        run(
                          () => post(`${api}/exhibitors/${id}/allocate`, { boothId: Number(boothId) }),
                          'Booth held. The exhibitor has been asked for the deposit.',
                        )
                      }
                    >
                      Hold for deposit
                    </button>
                    <button
                      className="btn"
                      disabled={!boothId}
                      onClick={() =>
                        run(() => post(`${api}/exhibitors/${id}/allocate`, { boothId: Number(boothId), confirm: true }), 'Booth confirmed')
                      }
                    >
                      Confirm now
                    </button>
                  </div>
                ) : (
                  <span className="muted">Not allocated</span>
                )}
                {orders.map((o) => (
                  <div key={o.id} className="row between">
                    <span>
                      Order {o.number} · {o.items[0]?.description}
                    </span>
                    <span className="num">
                      {inr(o.paidPaise)} of {inr(o.totalPaise)} <Status kind="order" value={o.status} />
                    </span>
                  </div>
                ))}
                <h3 style={{ marginTop: 8 }}>Setup checklist</h3>
                <div className="list">
                  {checklist.map((c) => (
                    <div key={c.id}>
                      <span className="grow">
                        {c.title}
                        <span className="muted small"> · due {day(c.dueOn)}</span>
                      </span>
                      {c.hasUpload && (
                        <a className="btn sm" href={`/api/v1${api}/checklist/${c.id}/file`}>
                          View file
                        </a>
                      )}
                      {c.status === 'awaiting_review' && can('exh.review') ? (
                        <>
                          <button
                            className="btn sm primary"
                            onClick={() => run(() => post(`${api}/checklist/${c.id}/review`, { decision: 'complete' }), 'Marked complete')}
                          >
                            Accept
                          </button>
                          <button
                            className="btn sm"
                            onClick={() =>
                              ask({
                                title: 'Ask for changes',
                                submitLabel: 'Send',
                                fields: [{ key: 'note', label: 'What needs to change', type: 'textarea', required: true }],
                                onSubmit: (v) => post(`${api}/checklist/${c.id}/review`, { decision: 'changes', ...v }).then(refresh),
                              })
                            }
                          >
                            Changes…
                          </button>
                        </>
                      ) : (
                        <Status kind="checklist" value={c.status} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="row between wrap" style={{ marginTop: 8 }}>
                  <h3>
                    Team badges: {team.length} of {x.badgeQuota}
                  </h3>
                  {can('exh.review') && (
                    <button
                      className="btn sm"
                      onClick={() =>
                        ask({
                          title: 'Badge quota',
                          fields: [{ key: 'badgeQuota', label: 'Badges this exhibitor may issue', type: 'number', required: true }],
                          initial: { badgeQuota: x.badgeQuota },
                          onSubmit: (v) => put(`${api}/exhibitors/${id}/quota`, { badgeQuota: Number(v.badgeQuota) }).then(refresh),
                        })
                      }
                    >
                      Change quota
                    </button>
                  )}
                </div>
                <div className="list">
                  {team.map((t) => (
                    <div key={t.email}>
                      <span className="grow">
                        {t.name}
                        <span className="muted small"> · {t.email}</span>
                      </span>
                      <span className="muted small">{ROLE_LABELS[t.role]}</span>
                      <Status kind="team" value={t.status} />
                    </div>
                  ))}
                </div>
              </section>
            )}
            {form}
          </div>
        )}
      </Loaded>
    </Dialog>
  );
}

// ---------- floor plan ----------
function Floor() {
  const { api, can, cfg } = useOrg();
  const load = useLoad(() => get(`${api}/floor`), [api]);
  const [sel, setSel] = useState(null);
  const [edit, setEdit] = useState(null);
  const [openEx, setOpenEx] = useState(null);
  const act = useAction();
  const halls = useMemo(() => (load.data || []).map((z) => ({ ...z, cols: z.cols || 0, rows: z.rows || 0, amenities: [] })), [load.data]);
  const booth = halls.flatMap((h) => h.booths).find((b) => b.id === sel);
  const tone = (b) => (b.status === 'available' ? 'free' : b.status === 'confirmed' ? '' : b.status);
  const label = (b) => `Booth ${b.code}, ${STATES.booth[b.status][1]}${b.exhibitor ? `, ${b.exhibitor}` : ''}`;
  const totals = halls.flatMap((h) => h.booths).reduce((a, b) => ((a[b.status] = (a[b.status] || 0) + 1), a), {});
  const boothFields = [
    { key: 'code', label: 'Booth code', required: true },
    {
      key: 'zoneId',
      label: 'Hall',
      type: 'select',
      required: true,
      options: cfg.zones.filter((z) => z.cols > 0).map((z) => ({ value: z.id, label: z.name })),
    },
    { key: 'kind', label: 'Type', type: 'select', required: true, options: ['shell', 'raw', 'premium'] },
    { key: 'sizeSqm', label: 'Size (sq m)', type: 'number', required: true },
    { key: 'pricePaise', label: 'Price before GST (₹)', type: 'money', required: true },
    { key: 'x', label: 'Column on plan', type: 'number', step: '0.5', required: true },
    { key: 'y', label: 'Row on plan', type: 'number', step: '0.5', required: true },
    { key: 'w', label: 'Width in cells', type: 'number', step: '0.5', required: true, default: 2 },
    { key: 'h', label: 'Depth in cells', type: 'number', step: '0.5', required: true, default: 1 },
    { key: 'blocked', label: 'Blocked (cannot be allocated)', type: 'checkbox' },
    { key: 'note', label: 'Note' },
  ];
  const save = (v) => (edit.id ? put(`${api}/booths/${edit.id}`, v) : post(`${api}/booths`, v)).then(load.reload);
  return (
    <div className="stack">
      <PageTitle title="Floor plan">
        <a className="btn" href={`/api/v1${api}/reports/booths.csv`}>
          Export CSV
        </a>
        {can('floor.manage') && (
          <button className="btn primary" onClick={() => setEdit({})}>
            Add booth
          </button>
        )}
      </PageTitle>
      <div className="row wrap" role="group" aria-label="Booth totals">
        {['confirmed', 'held', 'available', 'blocked'].map((s) => (
          <span key={s}>
            <Status kind="booth" value={s} /> <span className="num">{totals[s] || 0}</span>
          </span>
        ))}
      </div>
      <Loaded load={load}>
        {() => (
          <div className="split">
            <HallPlan halls={halls} selected={sel} onSelect={(b) => setSel(b.id)} tone={tone} label={label} />
            <aside className="panel" aria-live="polite">
              {booth ? (
                <div className="body stack tight">
                  <div className="row between">
                    <h2>Booth {booth.code}</h2>
                    <Status kind="booth" value={booth.status} />
                  </div>
                  <dl className="kv">
                    <dt>Type</dt>
                    <dd>
                      {booth.kind}, {booth.sizeSqm} sq m
                    </dd>
                    <dt>Price</dt>
                    <dd>{inr(booth.pricePaise)} + GST</dd>
                    <dt>Exhibitor</dt>
                    <dd>{booth.exhibitor || '—'}</dd>
                    {booth.holdExpiresAt && (
                      <>
                        <dt>Hold ends</dt>
                        <dd>{dayTime(booth.holdExpiresAt)}</dd>
                      </>
                    )}
                    {booth.note && (
                      <>
                        <dt>Note</dt>
                        <dd>{booth.note}</dd>
                      </>
                    )}
                  </dl>
                  {booth.exhibitorId && (
                    <button className="btn" onClick={() => setOpenEx(booth.exhibitorId)}>
                      Open exhibitor
                    </button>
                  )}
                  {booth.status === 'held' && can('exh.allocate') && (
                    <button
                      className="btn primary"
                      onClick={() =>
                        act(() => post(`${api}/assignments/${booth.assignmentId}/confirm`).then(load.reload), 'Booth confirmed')
                      }
                    >
                      Confirm booth
                    </button>
                  )}
                  {booth.assignmentId && can('exh.allocate') && (
                    <button
                      className="btn danger"
                      onClick={() =>
                        window.confirm(`Release booth ${booth.code}?`) &&
                        act(() => post(`${api}/assignments/${booth.assignmentId}/release`).then(load.reload), 'Booth released')
                      }
                    >
                      Release booth
                    </button>
                  )}
                  {can('floor.manage') && (
                    <button className="btn" onClick={() => setEdit({ ...booth, zoneId: halls.find((h) => h.booths.includes(booth))?.id })}>
                      Edit booth
                    </button>
                  )}
                  {booth.status === 'available' && (
                    <p className="muted small">To allocate this booth, open an approved exhibitor and choose it.</p>
                  )}
                </div>
              ) : (
                <Empty>Choose a booth on the plan or in the list.</Empty>
              )}
            </aside>
          </div>
        )}
      </Loaded>
      {edit && (
        <FormDialog
          title={edit.id ? `Edit booth ${edit.code}` : 'Add booth'}
          fields={boothFields}
          initial={edit}
          onSubmit={save}
          onClose={() => setEdit(null)}
        />
      )}
      {openEx && <ExhibitorDialog id={openEx} onClose={() => setOpenEx(null)} onChanged={load.reload} />}
    </div>
  );
}
