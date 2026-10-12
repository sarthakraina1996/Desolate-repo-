import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plane, ClipboardList, UsersRound, CalendarDays, ShieldCheck, Plus, ArrowRight, Download, Pencil, FileText, Bell, Trash2, CalendarRange,
  Palmtree, Cross, Baby, User, House, Ban, Calendar, Eye, HandHeart, ExternalLink, Clock,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { fmtDate, fmtShort, addDays, dowOf, greeting } from '../lib/format.js';
import {
  Card, Kpi, Badge, Button, Tabs, Seg, Empty, Loading, ErrorBox, Person, Avatar, Modal, Field, Input, Select, Textarea, Progress, Menu, useConfirm,
} from '../components/ui.jsx';
import { Ring, HBars, MiniCalendar, Bars, STATUS } from '../components/charts.jsx';
import { ApplyLeaveModal } from '../components/forms.jsx';
import { BrandBanner } from '../components/Layout.jsx';
import { PolicyModal } from './MySpace.jsx';
import Posh from './Posh.jsx';

export const LEAVE_ICONS = { calendar: Calendar, palm: Palmtree, cross: Cross, baby: Baby, user: User, home: House, ban: Ban };

export default function Leave() {
  const [sp, setSp] = useSearchParams();
  const { meta, user, isHR } = useApp();
  const tab = sp.get('tab') || 'overview';
  const [year, setYear] = useState(Number(meta.today.slice(0, 4)));
  const tabs = [{ value: 'overview', label: 'Overview' }, { value: 'manage', label: 'Leave Management' }, { value: 'policies', label: 'Policy Management' }, { value: 'posh', label: 'POSH' }, ...(isHR ? [{ value: 'reports', label: 'Reports' }] : [])];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{greeting()}, {user.firstName}! <span aria-hidden="true">👋</span></h1>
          <div className="sub">Manage leave, policies and a safe, compliant workplace at BrainADZ.</div>
        </div>
        <BrandBanner />
      </div>
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><Tabs value={tab} onChange={(t) => setSp(t === 'overview' ? {} : { tab: t })} tabs={tabs} /></div>
        <div className="row small mb-16" style={{ marginBottom: 16 }}>Policy Year
          <select className="select sm" style={{ width: 100 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i).map((y) => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>
      {tab === 'overview' && <Overview year={year} />}
      {tab === 'manage' && <Manage year={year} />}
      {tab === 'policies' && <Policies focus={Number(sp.get('policy')) || null} />}
      {tab === 'posh' && <Posh embedded />}
      {tab === 'reports' && isHR && <LeaveReports year={year} />}
    </div>
  );
}

// ---------------------------------------------------------------- overview
function Overview({ year }) {
  const { meta, isHR, user } = useApp();
  const { data, error, reload } = useApi(`/leave/overview?year=${year}`);
  const [apply, setApply] = useState(false);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div>
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Kpi icon={Plane} tone="blue" label="Total Leave Balance" value={data.totalBalance} unit="Days" />
        <Kpi icon={ClipboardList} tone="red" label={isHR ? 'Pending Leave Requests' : 'My Pending Requests'} value={data.pendingRequests} />
        <Kpi icon={UsersRound} tone="amber" label="Pending Approvals" value={data.pendingApprovals} extra={data.pendingApprovals > 0 && <span className="delta"><span className="d" style={{ color: 'var(--text-2)' }}><Clock size={13} /> Avg. {data.avgApprovalAgeDays} days</span></span>} />
        <Kpi icon={CalendarDays} tone="blue" label="Company Holidays" value={data.holidays} unit="This Year" />
        <Kpi icon={ShieldCheck} tone="green" label="Policy Acknowledgement" value={`${data.policyAckPct}%`} />
      </div>
      <div className="grid">
        <Card className="span-5" title="Leave Balance Overview" action={user.employeeId && <Button size="sm" variant="primary" icon={Plus} onClick={() => setApply(true)}>Apply leave</Button>}>
          {data.balances.length ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10, marginBottom: 0 }}>
              {data.balances.filter((b) => b.quota != null).map((b) => {
                const Icon = LEAVE_ICONS[b.icon] || Calendar;
                const total = b.entitled + b.carried;
                return (
                  <div key={b.code} className="center" style={{ padding: '10px 4px', borderRadius: 12, border: '1px solid var(--border)' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${b.color}1f`, color: b.color }}><Icon size={20} /></div>
                    <div className="small mt-8" style={{ color: 'var(--text-2)', minHeight: 32 }}>{b.name}</div>
                    <div className="b7" style={{ fontSize: 16 }}>{b.available} / {total}</div>
                    <div className="xs muted mb-8">days</div>
                    <Progress value={total ? ((total - b.available) / total) * 100 : 0} color={b.color} height={6} />
                  </div>
                );
              })}
            </div>
          ) : <Empty text="Leave balances appear for employees" />}
        </Card>
        <Card className="span-4" title="Leave Request Workflow" action={<Link className="link" to="/leave?tab=manage">View all <ArrowRight size={14} /></Link>}>
          <Workflow onChanged={reload} />
        </Card>
        <Card className="span-3" title="Holiday Calendar" action={<Link className="link" to="/leave?tab=manage#holidays">View all <ArrowRight size={14} /></Link>}>
          <HolidayCalendar year={year} today={meta.today} />
        </Card>
      </div>
      <div className="grid">
        <Card className="span-5" title="Team Leave Calendar"><TeamCalendar /></Card>
        <Card className="span-4" title="Leave Policy Builder" action={isHR && <Link className="link" to="/settings?tab=leave">Edit Policy <ArrowRight size={14} /></Link>}><PolicyBuilder /></Card>
        <Card className="span-3" title="Policy Library" action={<Link className="link" to="/leave?tab=policies">View all <ArrowRight size={14} /></Link>}><PolicyLibraryMini /></Card>
      </div>
      <div className="grid">
        <Card className="span-5" title="Policy Acknowledgement"><AckByDepartment /></Card>
        <Card className="span-4" title="POSH Compliance" action={<Link className="link" to="/posh">View details <ArrowRight size={14} /></Link>}><PoshMini /></Card>
        <div className="span-3 card" style={{ background: 'linear-gradient(160deg, #fff 0%, #fde9ef 100%)' }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <HandHeart size={42} className="red" style={{ flexShrink: 0 }} />
            <div>
              <h3 className="red" style={{ fontSize: 16 }}>Confidential POSH Support</h3>
              <p className="small mt-8" style={{ color: 'var(--text-2)', lineHeight: 1.5 }}>A safe and confidential channel to report harassment at the workplace. You can stay anonymous.</p>
            </div>
          </div>
          <Link to="/posh?raise=1" className="btn solid-red block mt-16">Report / Seek Support <ExternalLink size={15} /></Link>
        </div>
      </div>
      {apply && <ApplyLeaveModal onClose={() => setApply(false)} onDone={reload} />}
    </div>
  );
}

function Workflow({ onChanged }) {
  const { toast, isHR, user } = useApp();
  const [scope, setScope] = useState(user.employeeId ? 'mine' : 'approvals');
  const { data, reload } = useApi(`/leave/requests?scope=${scope}&limit=6`);
  const [run] = useAction(toast);
  const decide = async (r, action) => {
    if (await run(() => api.post(`/leave/requests/${r.id}/decision`, { action }), `Request ${action === 'approve' ? 'approved' : 'rejected'}`)) { reload(); onChanged?.(); }
  };
  const tabs = [user.employeeId && { value: 'mine', label: 'My Requests' }, (isHR || user.role === 'manager') && { value: 'approvals', label: 'Pending Approvals' }, (isHR || user.role === 'manager') && { value: 'team', label: 'Team Requests' }].filter(Boolean);
  return (
    <div>
      <Tabs variant="pills" value={scope} onChange={setScope} tabs={tabs} />
      {!data ? <Loading /> : data.items.length ? data.items.map((r) => (
        <div key={r.id} className="list-item">
          <Avatar name={r.name} id={r.employee_id} hasPhoto={r.has_photo} size={36} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="b6 ellipsis">{r.name}</div>
            <div className="small muted ellipsis">{r.type} · {fmtShort(r.from_date)}{r.to_date !== r.from_date ? ` – ${fmtShort(r.to_date)}` : ''} ({r.days} day{r.days === 1 ? '' : 's'})</div>
          </div>
          {r.canDecide ? (
            <Menu label="Decide" items={[{ label: 'Approve', onClick: () => decide(r, 'approve') }, { label: 'Reject', danger: true, onClick: () => decide(r, 'reject') }]} />
          ) : null}
          <Badge>{r.status}</Badge>
        </div>
      )) : <Empty text="Nothing here" />}
    </div>
  );
}

function HolidayCalendar({ year, today }) {
  const start = today.slice(0, 4) === String(year) ? today.slice(0, 7) : `${year}-01`;
  const [month, setMonth] = useState(start);
  const { data } = useApi(`/holidays?year=${month.slice(0, 4)}`);
  const marks = Object.fromEntries((data?.items || []).map((h) => [h.date, { kind: h.type === 'Company' ? 'company' : 'restricted', title: h.name }]));
  const step = (n) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const inMonth = (data?.items || []).filter((h) => h.date.startsWith(month));
  return (
    <div>
      <MiniCalendar month={month} marks={marks} today={today} onPrev={() => step(-1)} onNext={() => step(1)} />
      <div className="row small mt-12" style={{ gap: 14, justifyContent: 'center' }}>
        <span className="row gap-6"><span className="dot" style={{ background: '#1A6DF0' }} />Company Holiday</span>
        <span className="row gap-6"><span className="dot" style={{ background: '#E5243B' }} />Restricted Holiday</span>
      </div>
      {inMonth.length > 0 && <div className="mt-12">{inMonth.map((h) => <div key={h.id} className="small row between"><span>{h.name}</span><span className="muted">{fmtShort(h.date)}</span></div>)}</div>}
    </div>
  );
}

function TeamCalendar() {
  const { meta } = useApp();
  const monday = (() => { const d = dowOf(meta.today); return addDays(meta.today, d === 0 ? -6 : 1 - d); })();
  const [from, setFrom] = useState(monday);
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const to = addDays(from, 6);
  const { data } = useApi(`/leave/calendar?from=${from}&to=${to}${dept ? `&department=${dept}` : ''}${type ? `&type=${type}` : ''}`);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div>
      <div className="row wrap mb-12" style={{ gap: 8 }}>
        <Button size="sm" onClick={() => setFrom(addDays(from, -7))} aria-label="Previous week">‹</Button>
        <b className="small" style={{ minWidth: 120, textAlign: 'center' }}>{fmtShort(from)} – {fmtShort(to)}</b>
        <Button size="sm" onClick={() => setFrom(addDays(from, 7))} aria-label="Next week">›</Button>
        <span className="grow" />
        <select className="select sm" style={{ width: 150 }} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All Departments</option>{meta.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <select className="select sm" style={{ width: 140 }} value={type} onChange={(e) => setType(e.target.value)}><option value="">All Leave Types</option>{meta.leaveTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
      </div>
      {!data ? <Loading /> : (
        <div className="table-wrap">
          <div className="gantt" style={{ gridTemplateColumns: `minmax(130px, 1.4fr) repeat(7, minmax(44px, 1fr))`, minWidth: 520 }}>
            <div className="gh" style={{ textAlign: 'left' }}>Employee</div>
            {days.map((d) => <div key={d} className="gh" style={data.weeklyOffs.includes(dowOf(d)) ? { color: 'var(--faint)' } : undefined}>{Number(d.slice(8))}<br />{new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' })}</div>)}
            {data.employees.length === 0 && <div style={{ gridColumn: '1 / -1' }}><Empty text="No one is on leave this week" /></div>}
            {data.employees.slice(0, 8).map((e) => (
              <Row key={e.id} e={e} days={days} />
            ))}
          </div>
          {data.employees.length > 8 && <div className="small muted mt-8">+{data.employees.length - 8} more on leave this week</div>}
        </div>
      )}
    </div>
  );
}
function Row({ e, days }) {
  const from = days[0];
  const to = days[days.length - 1];
  return (
    <>
      <div className="gn"><Avatar name={e.name} id={e.id} hasPhoto={e.has_photo} size={26} /><span className="small ellipsis">{e.name}</span></div>
      <div className="gc" style={{ gridColumn: 'span 7', position: 'relative', minHeight: 40 }}>
        {e.leaves.map((l) => {
          const s = l.from < from ? from : l.from;
          const en = l.to > to ? to : l.to;
          const si = days.indexOf(s);
          const ei = days.indexOf(en);
          if (si < 0 || ei < 0) return null;
          return (
            <div key={l.id} className="gbar" title={`${l.type} · ${l.from}${l.to !== l.from ? ` to ${l.to}` : ''} · ${l.status}`}
              style={{ left: `calc(${(si / 7) * 100}% + 2px)`, width: `calc(${((ei - si + 1) / 7) * 100}% - 4px)`, background: `${l.color}33`, color: '#1b2848', border: l.status === 'Pending' ? `1.5px dashed ${l.color}` : 'none' }}>
              {ei - si >= 1 ? l.type : l.code}
            </div>
          );
        })}
      </div>
    </>
  );
}

function PolicyBuilder() {
  const { meta } = useApp();
  const [tab, setTab] = useState('types');
  const types = meta.leaveTypes;
  return (
    <div>
      <Tabs variant="pills" value={tab} onChange={setTab} tabs={[{ value: 'types', label: 'Leave Types' }, { value: 'accrual', label: 'Accrual Rules' }, { value: 'cf', label: 'Carry Forward' }, { value: 'sandwich', label: 'Sandwich Rules' }]} />
      {tab === 'types' && types.map((t) => {
        const Icon = LEAVE_ICONS[t.icon] || Calendar;
        return (
          <div key={t.id} className="list-item" style={{ padding: '8px 0' }}>
            <Icon size={20} style={{ color: t.color, flexShrink: 0 }} />
            <div className="grow" style={{ minWidth: 0 }}><div className="b6 small">{t.name} ({t.code})</div><div className="xs muted ellipsis">{t.annual_quota != null ? `${t.annual_quota} days/year` : 'Unlimited'} · {t.rule}</div></div>
          </div>
        );
      })}
      {tab === 'accrual' && types.filter((t) => t.annual_quota != null).map((t) => <div key={t.id} className="list-item small"><span className="grow">{t.name}</span><span className="muted">{t.accrual === 'monthly' ? `${Math.round((t.annual_quota / 12) * 100) / 100} days/month` : 'Credited in January, pro-rated for joiners'}</span></div>)}
      {tab === 'cf' && types.filter((t) => t.annual_quota != null).map((t) => <div key={t.id} className="list-item small"><span className="grow">{t.name}</span><span className="muted">{t.carry_forward_max ? `Up to ${t.carry_forward_max} days` : 'No carry forward'}</span></div>)}
      {tab === 'sandwich' && <div className="small" style={{ lineHeight: 1.6, color: 'var(--text-2)' }}>Weekly offs and company holidays falling inside a leave are <b>not</b> counted as leave (no sandwich rule), except for leave types counted in calendar days such as Maternity Leave. Change weekly offs in Settings.</div>}
    </div>
  );
}

function PolicyLibraryMini() {
  const { data, reload } = useApi('/policies');
  const [open, setOpen] = useState(null);
  const colors = ['var(--blue)', 'var(--purple)', 'var(--green)', 'var(--amber)', 'var(--red)', 'var(--cyan)'];
  if (!data) return <Loading />;
  return (
    <div>
      {data.items.slice(0, 4).map((p, i) => (
        <div key={p.id} className="list-item" style={{ padding: '8px 0', cursor: 'pointer' }} onClick={() => setOpen(p.id)}>
          <FileText size={26} style={{ color: colors[i % colors.length], flexShrink: 0 }} />
          <div className="grow" style={{ minWidth: 0 }}><div className="b6 small ellipsis">{p.title}</div><div className="xs muted">v{p.version} | Updated {fmtDate(p.updated_at)}</div></div>
          {p.requires_ack && !p.myAck ? <Badge tone="amber">Ack</Badge> : <Eye size={16} className="blue" />}
        </div>
      ))}
      {open && <PolicyModal id={open} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}

function AckByDepartment() {
  const { data } = useApi('/policies');
  if (!data) return <Loading />;
  const pct = data.overall.total ? Math.round((data.overall.acked / data.overall.total) * 100) : 0;
  return (
    <div className="row wrap" style={{ gap: 20, alignItems: 'center' }}>
      <Ring size={130} thickness={14} value={pct} label="Policy Acknowledged" sub={`${data.overall.acked} / ${data.overall.total} employees`} />
      <div className="grow" style={{ minWidth: 220 }}>
        <div className="small muted mb-8">All required policies, by department</div>
        <HBars items={data.byDepartment.slice(0, 7).map((d) => ({ label: d.label, value: d.total ? Math.round((d.acked / d.total) * 100) : 0 }))} max={100} format={(v) => `${v}%`} labelWidth={100} />
      </div>
    </div>
  );
}

function PoshMini() {
  const { data } = useApi('/posh');
  if (!data) return <Loading />;
  return (
    <div className="row" style={{ justifyContent: 'space-around' }}>
      <Ring value={data.stats.ackPct} color={STATUS.good} label="POSH Policy Acknowledged" sub={`${data.stats.acked} / ${data.stats.headcount}`} />
      <Ring value={data.stats.trainedPct} color={data.stats.trainedPct >= 90 ? STATUS.good : STATUS.warn} label="POSH Training Completed" sub={`${data.stats.trained} / ${data.stats.headcount}`} />
    </div>
  );
}

// ---------------------------------------------------------------- manage
function Manage({ year }) {
  const { isHR, user, toast, meta } = useApp();
  const [scope, setScope] = useState(isHR ? 'all' : user.role === 'manager' ? 'approvals' : 'mine');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [modal, setModal] = useState(null);
  const { data, reload } = useApi(`/leave/requests?scope=${scope}&limit=300${status ? `&status=${status}` : ''}${type ? `&type=${type}` : ''}&from=${year}-01-01&to=${year}-12-31`);
  const [run] = useAction(toast);
  const [note, setNote] = useState(null);
  const decide = async (r, action, msg) => {
    if (await run(() => api.post(`/leave/requests/${r.id}/decision`, { action, note: msg }), `Request ${action === 'approve' ? 'approved' : 'rejected'}`)) reload();
  };
  const cancel = async (r) => { if (await run(() => api.post(`/leave/requests/${r.id}/cancel`), 'Request cancelled')) reload(); };
  const scopes = [isHR && { value: 'all', label: 'All requests' }, (isHR || user.role === 'manager') && { value: 'approvals', label: 'Pending approvals' }, user.role === 'manager' && { value: 'team', label: 'My team' }, user.employeeId && { value: 'mine', label: 'My requests' }].filter(Boolean);
  return (
    <div>
      <Card flush>
        <div className="row wrap" style={{ padding: 16, gap: 10 }}>
          <Seg value={scope} onChange={setScope} options={scopes} />
          <span className="grow" />
          <select className="select sm" style={{ width: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['Pending', 'Approved', 'Rejected', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}</select>
          <select className="select sm" style={{ width: 160 }} value={type} onChange={(e) => setType(e.target.value)}><option value="">All leave types</option>{meta.leaveTypes.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
          {user.employeeId && <Button size="sm" variant="primary" icon={Plus} onClick={() => setModal('apply')}>Apply leave</Button>}
          {isHR && <Button size="sm" icon={Plus} onClick={() => setModal('behalf')}>On behalf</Button>}
        </div>
        {!data ? <Loading /> : data.items.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th style={{ paddingLeft: 18 }}>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th className="hide-sm">Reason</th><th>Status</th><th /></tr></thead>
              <tbody>{data.items.map((r) => (
                <tr key={r.id}>
                  <td style={{ paddingLeft: 18 }}><Person name={r.name} sub={`${r.vertical || ''}${r.department ? ` • ${r.department}` : ''}`} id={r.employee_id} hasPhoto={r.has_photo} size={32} /></td>
                  <td><span className="row gap-6"><span className="dot" style={{ background: r.color }} />{r.type}</span></td>
                  <td className="nowrap">{fmtDate(r.from_date)}{r.to_date !== r.from_date ? <> – {fmtDate(r.to_date)}</> : r.half_day ? ' (half)' : ''}</td>
                  <td>{r.days}</td>
                  <td className="hide-sm small muted" style={{ maxWidth: 240 }}>{r.reason}{r.decision_note && <div className="xs">Note: {r.decision_note}</div>}</td>
                  <td><Badge>{r.status}</Badge>{r.decided_by_name && r.status !== 'Pending' && <div className="xs muted">by {r.decided_by_name}</div>}</td>
                  <td className="right nowrap" style={{ paddingRight: 18 }}>
                    {r.canDecide && <><Button size="xs" variant="success" onClick={() => decide(r, 'approve')}>Approve</Button> <Button size="xs" variant="reject" onClick={() => setNote({ r, text: '' })}>Reject</Button></>}
                    {!r.canDecide && ['Pending', 'Approved'].includes(r.status) && (isHR || (r.employee_id === user.employeeId && r.from_date > meta.today)) && <Button size="xs" variant="ghost" onClick={() => cancel(r)}>Cancel</Button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty text="No leave requests match" />}
      </Card>
      {isHR && <div className="grid mt-16" id="holidays"><Card className="span-6" title={`Holidays ${year}`}><HolidayManager year={year} /></Card><Card className="span-6" title={`Leave register ${year}`} action={<Button size="sm" icon={Download} onClick={() => download(`/reports/leave-register.csv?year=${year}`)}>CSV</Button>}><LeaveRegister year={year} /></Card></div>}
      {!isHR && <div className="grid mt-16"><Card className="span-6" title={`Holidays ${year}`}><HolidayManager year={year} /></Card></div>}
      {modal === 'apply' && <ApplyLeaveModal onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'behalf' && <ApplyLeaveModal onBehalf onClose={() => setModal(null)} onDone={reload} />}
      {note && (
        <Modal title={`Reject ${note.r.name}'s request`} size="narrow" onClose={() => setNote(null)} footer={<><Button onClick={() => setNote(null)}>Cancel</Button><Button variant="solid-red" onClick={async () => { await decide(note.r, 'reject', note.text); setNote(null); }}>Reject</Button></>}>
          <Field label="Reason (shared with the employee)"><Textarea value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} placeholder="e.g. Peak project week, please pick other dates" /></Field>
        </Modal>
      )}
    </div>
  );
}

function HolidayManager({ year }) {
  const { isHR, toast } = useApp();
  const { data, reload } = useApi(`/holidays?year=${year}`);
  const [f, setF] = useState({ date: `${year}-01-01`, name: '', type: 'Company' });
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  if (!data) return <Loading />;
  return (
    <div>
      {isHR && (
        <div className="row wrap mb-12" style={{ gap: 8 }}>
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} style={{ width: 150 }} />
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Holiday name" style={{ flex: 1, minWidth: 140 }} />
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={['Company', 'Restricted']} style={{ width: 130 }} />
          <Button variant="primary" loading={busy} icon={Plus} onClick={async () => { if (await run(() => api.post('/holidays', f), 'Holiday added')) { setF({ ...f, name: '' }); reload(); } }}>Add</Button>
        </div>
      )}
      {data.items.length ? data.items.map((h) => (
        <div key={h.id} className="list-item" style={{ padding: '8px 0' }}>
          <span className="small muted nowrap" style={{ width: 110 }}>{fmtDate(h.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <span className="grow">{h.name}</span>
          <Badge tone={h.type === 'Company' ? 'blue' : 'pink'}>{h.type}</Badge>
          {isHR && <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete holiday" onClick={async () => { if (await confirm({ title: 'Delete holiday?', text: `${h.name} on ${fmtDate(h.date)}`, danger: true, confirmLabel: 'Delete' })) { await run(() => api.del(`/holidays/${h.id}`), 'Holiday removed'); reload(); } }} />}
        </div>
      )) : <Empty text="No holidays for this year yet" />}
      <div className="xs muted mt-8">Restricted holidays are optional and are taken as Casual Leave. Festival dates change every year, so check them each January.</div>
      {confirmEl}
    </div>
  );
}

function LeaveRegister({ year }) {
  const { data } = useApi(`/leave/register?year=${year}`);
  const [q, setQ] = useState('');
  const items = useMemo(() => (data?.items || []).filter((e) => e.name.toLowerCase().includes(q.toLowerCase())), [data, q]);
  if (!data) return <Loading />;
  const codes = ['EL', 'CL', 'SL', 'WFH'];
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee" className="sm mb-12" />
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="table compact">
          <thead><tr><th>Employee</th>{codes.map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
          <tbody>{items.map((e) => (
            <tr key={e.id}><td><Link to={`/employees/${e.id}`}>{e.name}</Link><div className="xs muted">{e.department}</div></td>
              {codes.map((c) => { const b = e.balances.find((x) => x.code === c); return <td key={c} className="num">{b ? <>{b.available}<span className="xs muted">/{b.entitled + b.carried}</span></> : '—'}</td>; })}</tr>
          ))}</tbody>
        </table>
      </div>
      <div className="xs muted mt-8">Available / entitled (including carry forward).</div>
    </div>
  );
}

// ---------------------------------------------------------------- policies
function Policies({ focus }) {
  const { isHR, toast } = useApp();
  const { data, reload } = useApi('/policies');
  const [view, setView] = useState(focus);
  const [edit, setEdit] = useState(null);
  const [pending, setPending] = useState(null);
  const [run] = useAction(toast);
  if (!data) return <Loading />;
  return (
    <div>
      <Card flush title="Policy Library" action={isHR && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEdit({})} style={{ marginRight: 18 }}>New policy</Button>}>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead><tr><th style={{ paddingLeft: 18 }}>Policy</th><th>Category</th><th>Version</th><th>Updated</th><th>Acknowledged</th><th>My status</th><th /></tr></thead>
            <tbody>{data.items.map((p) => (
              <tr key={p.id} className="click" onClick={() => setView(p.id)}>
                <td style={{ paddingLeft: 18 }}><div className="b6 row gap-6"><FileText size={16} className="blue" />{p.title}</div><div className="small muted">{p.summary}</div></td>
                <td><Badge tone="gray">{p.category}</Badge></td>
                <td>v{p.version}</td>
                <td className="small muted nowrap">{fmtDate(p.updated_at)}</td>
                <td style={{ minWidth: 140 }}>{p.requires_ack ? <><div className="small b6">{p.acked} / {p.total}</div><Progress value={p.total ? (p.acked / p.total) * 100 : 0} color="var(--green)" height={6} /></> : <span className="small muted">Not required</span>}</td>
                <td>{p.requires_ack ? (p.myAck ? <Badge tone="green">Acknowledged</Badge> : <Badge tone="amber">Pending</Badge>) : '—'}</td>
                <td className="right nowrap" style={{ paddingRight: 18 }} onClick={(e) => e.stopPropagation()}>
                  {isHR && <Menu items={[
                    { label: 'Edit / new version', icon: Pencil, onClick: () => setEdit(p) },
                    p.requires_ack && { label: 'Who has not acknowledged', icon: Eye, onClick: () => setPending(p.id) },
                    p.requires_ack && { label: 'Send reminder', icon: Bell, onClick: async () => { await run(() => api.post(`/policies/${p.id}/remind`), (r) => `Reminder sent to ${r.sent} people`); } },
                  ]} />}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      {view && <PolicyModal id={view} onClose={() => setView(null)} onDone={reload} />}
      {edit && <PolicyEditor policy={edit} onClose={() => setEdit(null)} onDone={reload} />}
      {pending && <PendingAcks id={pending} onClose={() => setPending(null)} />}
    </div>
  );
}

function PendingAcks({ id, onClose }) {
  const { data } = useApi(`/policies/${id}`);
  return (
    <Modal title={data ? `${data.title}: not yet acknowledged` : 'Loading'} onClose={onClose}>
      {!data ? <Loading /> : data.pending.length ? data.pending.map((e) => <div key={e.id} className="list-item"><Person name={e.name} sub={`${e.code} · ${e.department || ''}`} id={e.id} size={30} /></div>) : <Empty text="Everyone has acknowledged this policy" />}
    </Modal>
  );
}

function PolicyEditor({ policy, onClose, onDone }) {
  const { toast } = useApp();
  const isNew = !policy.id;
  const { data: full } = useApi(isNew ? null : `/policies/${policy.id}`);
  const [f, setF] = useState(null);
  const [file, setFile] = useState(null);
  const [run, busy] = useAction(toast);
  const src = isNew ? { title: '', category: 'General', version: '1.0', summary: '', content: '', requires_ack: 1 } : full;
  const v = f || (src && { ...src, new_version: false });
  if (!v) return <Modal title="Edit policy" onClose={onClose}><Loading /></Modal>;
  const set = (k) => (e) => setF({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const form = new FormData();
    for (const k of ['title', 'category', 'summary', 'content', 'version']) form.append(k, v[k] ?? '');
    form.append('requires_ack', v.requires_ack ? 'true' : 'false');
    form.append('new_version', v.new_version ? 'true' : 'false');
    if (file) form.append('file', file);
    if (await run(() => api.upload(isNew ? '/policies' : `/policies/${policy.id}`, form, isNew ? 'POST' : 'PUT'), isNew ? 'Policy published' : 'Policy saved')) { onDone(); onClose(); }
  };
  return (
    <Modal title={isNew ? 'New policy' : `Edit ${src.title}`} size="wide" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{isNew ? 'Publish' : 'Save'}</Button></>}>
      <div className="form-grid">
        <Field label="Title"><Input value={v.title} onChange={set('title')} /></Field>
        <Field label="Category"><Select value={v.category} onChange={set('category')} options={['Leave', 'General', 'Compliance', 'POSH', 'IT', 'Finance', 'HR']} /></Field>
        {isNew && <Field label="Version"><Input value={v.version} onChange={set('version')} /></Field>}
        <Field label="Summary" className="full"><Input value={v.summary || ''} onChange={set('summary')} maxLength={300} /></Field>
        <Field label="Policy text" hint="Use ## for headings and - for bullet points" className="full"><Textarea value={v.content || ''} onChange={set('content')} style={{ minHeight: 260, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} /></Field>
        <Field label="Attach document (PDF/DOCX, optional)" className="full"><input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <label className="check"><input type="checkbox" checked={Boolean(v.requires_ack)} onChange={set('requires_ack')} />Employees must acknowledge</label>
        {!isNew && <label className="check"><input type="checkbox" checked={Boolean(v.new_version)} onChange={set('new_version')} />Publish as new version (v{bump(src.version)}) and ask everyone to re-acknowledge</label>}
      </div>
    </Modal>
  );
}
const bump = (ver) => { const [a, b = '0'] = String(ver).split('.'); return `${a}.${Number(b) + 1}`; };

// ---------------------------------------------------------------- reports
function LeaveReports({ year }) {
  const { data } = useApi('/reports/summary');
  if (!data) return <Loading />;
  const used = data.leaveUse.filter((l) => l.days > 0);
  return (
    <div className="grid">
      <Card className="span-7" title={`Leave taken by type · ${year}`}>
        <Bars categories={used.map((l) => l.code)} series={[{ name: 'Days', color: '#1A6DF0', values: used.map((l) => l.days) }]} height={220} />
      </Card>
      <Card className="span-5" title="Downloads">
        {[['Leave register (balances)', `/reports/leave-register.csv?year=${year}`], ['All leave requests', '/reports/leave-requests.csv'], ['Attendance register (this month)', '/attendance/export.csv']].map(([l, p]) => (
          <div key={p} className="list-item"><CalendarRange size={18} className="blue" /><span className="grow">{l}</span><Button size="sm" icon={Download} onClick={() => download(p)}>CSV</Button></div>
        ))}
        <div className="mt-12"><HBars items={data.leaveUse.map((l) => ({ label: l.name, value: l.requests, color: l.color }))} format={(v) => `${v} req`} labelWidth={120} /></div>
      </Card>
    </div>
  );
}

