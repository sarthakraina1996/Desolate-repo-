import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plane,
  ClipboardList,
  UsersRound,
  ShieldCheck,
  Plus,
  ArrowRight,
  Download,
  Pencil,
  FileText,
  Bell,
  Palmtree,
  Cross,
  Baby,
  User,
  House,
  Ban,
  Calendar,
  Eye,
  Clock,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { fmtDate, fmtShort, addDays, dowOf, greeting } from '../lib/format.js';
import {
  Card,
  Kpi,
  Badge,
  Button,
  Tabs,
  Seg,
  Empty,
  Loading,
  ErrorBox,
  Person,
  Avatar,
  Modal,
  Field,
  Input,
  Select,
  Textarea,
  Progress,
  Menu,
} from '../components/ui.jsx';
import { Ring, HBars } from '../components/charts.jsx';
import { ApplyLeaveModal } from '../components/forms.jsx';
import { BrandBanner } from '../components/Layout.jsx';
import { PolicyModal } from './MySpace.jsx';

// Icon component for each leave type's icon key.
export const LEAVE_ICONS = {
  calendar: Calendar,
  palm: Palmtree,
  cross: Cross,
  baby: Baby,
  user: User,
  home: House,
  ban: Ban,
};
// Holidays, POSH, reports and leave types live on their own pages, so they aren't repeated here.
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'manage', label: 'Leave Management' },
  { value: 'policies', label: 'Policy Management' },
];

// Leave page: overview, request management and policy tabs, with a policy year picker.
export default function Leave() {
  const [sp, setSp] = useSearchParams();
  const { meta, user } = useApp();
  // Tab comes from the URL; unknown values fall back to Overview
  const tab = TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'overview';
  const [year, setYear] = useState(Number(meta.today.slice(0, 4)));
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>
            {greeting()}, {user.firstName}! <span aria-hidden="true">👋</span>
          </h1>
          <div className="sub">Leave, approvals and company policies at BrainADZ.</div>
        </div>
        <BrandBanner />
      </div>
      {/* Tabs and policy year picker */}
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        {/* Wide enough that the year picker drops below the tabs on phones */}
        <div className="grow" style={{ flexBasis: 320 }}>
          <Tabs
            value={tab}
            onChange={(t) => setSp(t === 'overview' ? {} : { tab: t })}
            tabs={TABS}
          />
        </div>
        <div className="row small mb-16" style={{ marginBottom: 16 }}>
          Policy Year
          <select
            className="select sm"
            style={{ width: 100 }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {/* Previous, current and next year */}
            {[year - 1, year, year + 1]
              .filter((y, i, a) => a.indexOf(y) === i)
              .map((y) => (
                <option key={y}>{y}</option>
              ))}
          </select>
        </div>
      </div>
      {/* Active tab */}
      {tab === 'overview' && <Overview year={year} />}
      {tab === 'manage' && <Manage year={year} />}
      {tab === 'policies' && <Policies focus={Number(sp.get('policy')) || null} />}
    </div>
  );
}

// ---------------------------------------------------------------- overview
// Overview tab: KPIs, balances, recent requests, who's on leave and policy acknowledgement.
function Overview({ year }) {
  const { isHR, user } = useApp();
  const { data, error, reload } = useApi(`/leave/overview?year=${year}`);
  const [apply, setApply] = useState(false);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div>
      {/* KPI cards */}
      <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Kpi
          icon={Plane}
          tone="blue"
          label="Total Leave Balance"
          value={data.totalBalance}
          unit="Days"
        />
        <Kpi
          icon={ClipboardList}
          tone="red"
          label={isHR ? 'Pending Leave Requests' : 'My Pending Requests'}
          value={data.pendingRequests}
        />
        <Kpi
          icon={UsersRound}
          tone="amber"
          label="Pending Approvals"
          value={data.pendingApprovals}
          extra={
            data.pendingApprovals > 0 && (
              <span className="delta">
                <span className="d" style={{ color: 'var(--text-2)' }}>
                  <Clock size={13} /> Avg. {data.avgApprovalAgeDays} days
                </span>
              </span>
            )
          }
        />
        <Kpi
          icon={ShieldCheck}
          tone="green"
          label="Policy Acknowledgement"
          value={`${data.policyAckPct}%`}
        />
      </div>
      {/* Leave balances and recent requests */}
      <div className="grid">
        <Card
          className="span-7"
          title="Leave Balance Overview"
          action={
            user.employeeId && (
              <Button size="sm" variant="primary" icon={Plus} onClick={() => setApply(true)}>
                Apply leave
              </Button>
            )
          }
        >
          {data.balances.length ? (
            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
                gap: 10,
                marginBottom: 0,
              }}
            >
              {/* One tile per leave type that has a quota */}
              {data.balances
                .filter((b) => b.quota != null)
                .map((b) => {
                  const Icon = LEAVE_ICONS[b.icon] || Calendar;
                  // Entitlement plus days carried forward
                  const total = b.entitled + b.carried;
                  return (
                    <div
                      key={b.code}
                      className="center"
                      style={{
                        padding: '10px 4px',
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          margin: '0 auto',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: `${b.color}1f`,
                          color: b.color,
                        }}
                      >
                        <Icon size={20} />
                      </div>
                      <div className="small mt-8" style={{ color: 'var(--text-2)', minHeight: 32 }}>
                        {b.name}
                      </div>
                      <div className="b7" style={{ fontSize: 16 }}>
                        {b.available} / {total}
                      </div>
                      <div className="xs muted mb-8">days</div>
                      {/* Bar shows the share already used */}
                      <Progress
                        value={total ? ((total - b.available) / total) * 100 : 0}
                        color={b.color}
                        height={6}
                      />
                    </div>
                  );
                })}
            </div>
          ) : (
            <Empty text="Leave balances appear for employees" />
          )}
        </Card>
        <Card
          className="span-5"
          title="Leave Request Workflow"
          action={
            <Link className="link" to="/leave?tab=manage">
              View all <ArrowRight size={14} />
            </Link>
          }
        >
          <Workflow onChanged={reload} />
        </Card>
      </div>
      {/* Who's on leave this week */}
      <div className="grid">
        <Card className="span-12" title="Who's on Leave">
          <TeamCalendar />
        </Card>
      </div>
      {/* Policy library and acknowledgement stats */}
      <div className="grid">
        <Card
          className="span-5"
          title="Policy Library"
          action={
            <Link className="link" to="/leave?tab=policies">
              View all <ArrowRight size={14} />
            </Link>
          }
        >
          <PolicyLibraryMini />
        </Card>
        <Card className="span-7" title="Policy Acknowledgement">
          <AckByDepartment />
        </Card>
      </div>
      {apply && <ApplyLeaveModal onClose={() => setApply(false)} onDone={reload} />}
    </div>
  );
}

// Recent requests card with My / Pending / Team tabs and a quick approve or reject menu.
function Workflow({ onChanged }) {
  const { toast, isHR, user } = useApp();
  // Logins without an employee record have no own requests, so start on approvals
  const [scope, setScope] = useState(user.employeeId ? 'mine' : 'approvals');
  const { data, reload } = useApi(`/leave/requests?scope=${scope}&limit=6`);
  const [run] = useAction(toast);
  // Approves or rejects a request, then refreshes this list and the page KPIs.
  const decide = async (r, action) => {
    if (
      await run(
        () => api.post(`/leave/requests/${r.id}/decision`, { action }),
        `Request ${action === 'approve' ? 'approved' : 'rejected'}`,
      )
    ) {
      reload();
      onChanged?.();
    }
  };
  // Only the tabs the viewer can use
  const tabs = [
    user.employeeId && { value: 'mine', label: 'My Requests' },
    (isHR || user.role === 'manager') && { value: 'approvals', label: 'Pending Approvals' },
    (isHR || user.role === 'manager') && { value: 'team', label: 'Team Requests' },
  ].filter(Boolean);
  return (
    <div>
      <Tabs variant="pills" value={scope} onChange={setScope} tabs={tabs} />
      {!data ? (
        <Loading />
      ) : data.items.length ? (
        data.items.map((r) => (
          <div key={r.id} className="list-item">
            <Avatar name={r.name} id={r.employee_id} hasPhoto={r.has_photo} size={36} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="b6 ellipsis">{r.name}</div>
              <div className="small muted ellipsis">
                {r.type} · {fmtShort(r.from_date)}
                {r.to_date !== r.from_date ? ` – ${fmtShort(r.to_date)}` : ''} ({r.days} day
                {r.days === 1 ? '' : 's'})
              </div>
            </div>
            {r.canDecide ? (
              <Menu
                label="Decide"
                items={[
                  { label: 'Approve', onClick: () => decide(r, 'approve') },
                  { label: 'Reject', danger: true, onClick: () => decide(r, 'reject') },
                ]}
              />
            ) : null}
            <Badge>{r.status}</Badge>
          </div>
        ))
      ) : (
        <Empty text="Nothing here" />
      )}
    </div>
  );
}

// Week view of who is on leave, filterable by department and leave type.
function TeamCalendar() {
  const { meta } = useApp();
  // Monday of the current week (Sunday counts as the end of the week)
  const monday = (() => {
    const d = dowOf(meta.today);
    return addDays(meta.today, d === 0 ? -6 : 1 - d);
  })();
  const [from, setFrom] = useState(monday);
  const [dept, setDept] = useState('');
  const [type, setType] = useState('');
  const to = addDays(from, 6);
  const { data } = useApi(
    `/leave/calendar?from=${from}&to=${to}${dept ? `&department=${dept}` : ''}${type ? `&type=${type}` : ''}`,
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div>
      {/* Week switcher and filters */}
      <div className="row wrap mb-12" style={{ gap: 8 }}>
        <Button size="sm" onClick={() => setFrom(addDays(from, -7))} aria-label="Previous week">
          ‹
        </Button>
        <b className="small" style={{ minWidth: 120, textAlign: 'center' }}>
          {fmtShort(from)} – {fmtShort(to)}
        </b>
        <Button size="sm" onClick={() => setFrom(addDays(from, 7))} aria-label="Next week">
          ›
        </Button>
        <span className="grow" />
        <select
          className="select sm"
          style={{ width: 150 }}
          value={dept}
          onChange={(e) => setDept(e.target.value)}
        >
          <option value="">All Departments</option>
          {meta.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          className="select sm"
          style={{ width: 140 }}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All Leave Types</option>
          {meta.leaveTypes.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <div
            className="gantt"
            style={{
              gridTemplateColumns: `minmax(130px, 1.4fr) repeat(7, minmax(44px, 1fr))`,
              minWidth: 520,
            }}
          >
            {/* Header row: employee column, then one column per day */}
            <div className="gh" style={{ textAlign: 'left' }}>
              Employee
            </div>
            {days.map((d) => (
              <div
                key={d}
                className="gh"
                style={data.weeklyOffs.includes(dowOf(d)) ? { color: 'var(--faint)' } : undefined}
              >
                {Number(d.slice(8))}
                <br />
                {new Date(`${d}T00:00:00Z`).toLocaleString('en-US', {
                  weekday: 'short',
                  timeZone: 'UTC',
                })}
              </div>
            ))}
            {data.employees.length === 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <Empty text="No one is on leave this week" />
              </div>
            )}
            {/* First eight people; the rest are counted below */}
            {data.employees.slice(0, 8).map((e) => (
              <Row key={e.id} e={e} days={days} />
            ))}
          </div>
          {data.employees.length > 8 && (
            <div className="small muted mt-8">
              +{data.employees.length - 8} more on leave this week
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// One employee's row in the week view, with a bar per leave.
function Row({ e, days }) {
  const from = days[0];
  const to = days[days.length - 1];
  return (
    <>
      <div className="gn">
        <Avatar name={e.name} id={e.id} hasPhoto={e.has_photo} size={26} />
        <span className="small ellipsis">{e.name}</span>
      </div>
      <div className="gc" style={{ gridColumn: 'span 7', position: 'relative', minHeight: 40 }}>
        {e.leaves.map((l) => {
          // Clip the leave to the visible week and find its start and end columns
          const s = l.from < from ? from : l.from;
          const en = l.to > to ? to : l.to;
          const si = days.indexOf(s);
          const ei = days.indexOf(en);
          if (si < 0 || ei < 0) return null;
          // Pending leave gets a dashed border; one-day bars show the short code
          return (
            <div
              key={l.id}
              className="gbar"
              title={`${l.type} · ${l.from}${l.to !== l.from ? ` to ${l.to}` : ''} · ${l.status}`}
              style={{
                left: `calc(${(si / 7) * 100}% + 2px)`,
                width: `calc(${((ei - si + 1) / 7) * 100}% - 4px)`,
                background: `${l.color}33`,
                color: '#1b2848',
                border: l.status === 'Pending' ? `1.5px dashed ${l.color}` : 'none',
              }}
            >
              {ei - si >= 1 ? l.type : l.code}
            </div>
          );
        })}
      </div>
    </>
  );
}

// First four policies; flags ones the viewer still has to acknowledge and opens them on click.
function PolicyLibraryMini() {
  const { data, reload } = useApi('/policies');
  const [open, setOpen] = useState(null);
  // Icon colours, cycled per row
  const colors = [
    'var(--blue)',
    'var(--purple)',
    'var(--green)',
    'var(--amber)',
    'var(--red)',
    'var(--cyan)',
  ];
  if (!data) return <Loading />;
  return (
    <div>
      {data.items.slice(0, 4).map((p, i) => (
        <div
          key={p.id}
          className="list-item"
          style={{ padding: '8px 0', cursor: 'pointer' }}
          onClick={() => setOpen(p.id)}
        >
          <FileText size={26} style={{ color: colors[i % colors.length], flexShrink: 0 }} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="b6 small ellipsis">{p.title}</div>
            <div className="xs muted">
              v{p.version} | Updated {fmtDate(p.updated_at)}
            </div>
          </div>
          {p.requires_ack && !p.myAck ? (
            <Badge tone="amber">Ack</Badge>
          ) : (
            <Eye size={16} className="blue" />
          )}
        </div>
      ))}
      {open && <PolicyModal id={open} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}

// Overall policy acknowledgement ring plus a percentage bar per department.
function AckByDepartment() {
  const { data } = useApi('/policies');
  if (!data) return <Loading />;
  const pct = data.overall.total ? Math.round((data.overall.acked / data.overall.total) * 100) : 0;
  return (
    <div className="row wrap" style={{ gap: 20, alignItems: 'center' }}>
      <Ring
        size={130}
        thickness={14}
        value={pct}
        label="Policy Acknowledged"
        sub={`${data.overall.acked} / ${data.overall.total} employees`}
      />
      <div className="grow" style={{ minWidth: 220 }}>
        <div className="small muted mb-8">All required policies, by department</div>
        <HBars
          items={data.byDepartment.slice(0, 7).map((d) => ({
            label: d.label,
            value: d.total ? Math.round((d.acked / d.total) * 100) : 0,
          }))}
          max={100}
          format={(v) => `${v}%`}
          labelWidth={100}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- manage
// Leave Management tab: filterable request table with approve, reject and cancel actions.
function Manage({ year }) {
  const { isHR, user, toast, meta } = useApp();
  // Default list: everything for HR, approvals for managers, own requests for others
  const [scope, setScope] = useState(isHR ? 'all' : user.role === 'manager' ? 'approvals' : 'mine');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [modal, setModal] = useState(null);
  const { data, reload } = useApi(
    `/leave/requests?scope=${scope}&limit=300${status ? `&status=${status}` : ''}${type ? `&type=${type}` : ''}&from=${year}-01-01&to=${year}-12-31`,
  );
  const [run] = useAction(toast);
  // Reject dialog state: the request and the reason being typed
  const [note, setNote] = useState(null);
  // Approves or rejects a request, with an optional note for the employee.
  const decide = async (r, action, msg) => {
    if (
      await run(
        () => api.post(`/leave/requests/${r.id}/decision`, { action, note: msg }),
        `Request ${action === 'approve' ? 'approved' : 'rejected'}`,
      )
    )
      reload();
  };
  // Cancels a pending or approved request.
  const cancel = async (r) => {
    if (await run(() => api.post(`/leave/requests/${r.id}/cancel`), 'Request cancelled')) reload();
  };
  // Scope options the viewer is allowed to use
  const scopes = [
    isHR && { value: 'all', label: 'All requests' },
    (isHR || user.role === 'manager') && { value: 'approvals', label: 'Pending approvals' },
    user.role === 'manager' && { value: 'team', label: 'My team' },
    user.employeeId && { value: 'mine', label: 'My requests' },
  ].filter(Boolean);
  return (
    <div>
      <Card flush>
        {/* Scope, status and type filters, plus apply buttons */}
        <div className="row wrap" style={{ padding: 16, gap: 10 }}>
          <Seg value={scope} onChange={setScope} options={scopes} />
          <span className="grow" />
          <select
            className="select sm"
            style={{ width: 140 }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {['Pending', 'Approved', 'Rejected', 'Cancelled'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className="select sm"
            style={{ width: 160 }}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All leave types</option>
            {meta.leaveTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
          {user.employeeId && (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setModal('apply')}>
              Apply leave
            </Button>
          )}
          {isHR && (
            <Button size="sm" icon={Plus} onClick={() => setModal('behalf')}>
              On behalf
            </Button>
          )}
        </div>
        {/* Requests table */}
        {!data ? (
          <Loading />
        ) : data.items.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 18 }}>Employee</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Days</th>
                  <th className="hide-sm">Reason</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td style={{ paddingLeft: 18 }}>
                      <Person
                        name={r.name}
                        sub={`${r.vertical || ''}${r.department ? ` • ${r.department}` : ''}`}
                        id={r.employee_id}
                        hasPhoto={r.has_photo}
                        size={32}
                      />
                    </td>
                    <td>
                      <span className="row gap-6">
                        <span className="dot" style={{ background: r.color }} />
                        {r.type}
                      </span>
                    </td>
                    <td className="nowrap">
                      {fmtDate(r.from_date)}
                      {r.to_date !== r.from_date ? (
                        <> – {fmtDate(r.to_date)}</>
                      ) : r.half_day ? (
                        ' (half)'
                      ) : (
                        ''
                      )}
                    </td>
                    <td>{r.days}</td>
                    <td className="hide-sm small muted" style={{ maxWidth: 240 }}>
                      {r.reason}
                      {r.decision_note && <div className="xs">Note: {r.decision_note}</div>}
                    </td>
                    <td>
                      <Badge>{r.status}</Badge>
                      {r.decided_by_name && r.status !== 'Pending' && (
                        <div className="xs muted">by {r.decided_by_name}</div>
                      )}
                    </td>
                    <td className="right nowrap" style={{ paddingRight: 18 }}>
                      {/* Deciders approve or reject; reject asks for a reason first */}
                      {r.canDecide && (
                        <>
                          <Button size="xs" variant="success" onClick={() => decide(r, 'approve')}>
                            Approve
                          </Button>{' '}
                          <Button
                            size="xs"
                            variant="reject"
                            onClick={() => setNote({ r, text: '' })}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {/* HR can cancel any time; employees only before the leave starts */}
                      {!r.canDecide &&
                        ['Pending', 'Approved'].includes(r.status) &&
                        (isHR ||
                          (r.employee_id === user.employeeId && r.from_date > meta.today)) && (
                          <Button size="xs" variant="ghost" onClick={() => cancel(r)}>
                            Cancel
                          </Button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No leave requests match" />
        )}
      </Card>
      {/* Balance register, HR only */}
      {isHR && (
        <Card
          className="mt-16"
          title={`Leave register ${year}`}
          action={
            <Button
              size="sm"
              icon={Download}
              onClick={() => download(`/reports/leave-register.csv?year=${year}`)}
            >
              CSV
            </Button>
          }
        >
          <LeaveRegister year={year} />
        </Card>
      )}
      {/* Apply leave, for yourself or (HR) on someone's behalf */}
      {modal === 'apply' && <ApplyLeaveModal onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'behalf' && (
        <ApplyLeaveModal onBehalf onClose={() => setModal(null)} onDone={reload} />
      )}
      {/* Reject dialog with a reason for the employee */}
      {note && (
        <Modal
          title={`Reject ${note.r.name}'s request`}
          size="narrow"
          onClose={() => setNote(null)}
          footer={
            <>
              <Button onClick={() => setNote(null)}>Cancel</Button>
              <Button
                variant="solid-red"
                onClick={async () => {
                  await decide(note.r, 'reject', note.text);
                  setNote(null);
                }}
              >
                Reject
              </Button>
            </>
          }
        >
          <Field label="Reason (shared with the employee)">
            <Textarea
              value={note.text}
              onChange={(e) => setNote({ ...note, text: e.target.value })}
              placeholder="e.g. Peak project week, please pick other dates"
            />
          </Field>
        </Modal>
      )}
    </div>
  );
}

// Per-employee balances for the main leave types, with a name search.
function LeaveRegister({ year }) {
  const { data } = useApi(`/leave/register?year=${year}`);
  const [q, setQ] = useState('');
  const items = useMemo(
    () => (data?.items || []).filter((e) => e.name.toLowerCase().includes(q.toLowerCase())),
    [data, q],
  );
  if (!data) return <Loading />;
  // Leave types shown as columns
  const codes = ['EL', 'CL', 'SL', 'WFH'];
  return (
    <div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search employee"
        className="sm mb-12"
      />
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="table compact">
          <thead>
            <tr>
              <th>Employee</th>
              {codes.map((c) => (
                <th key={c} className="num">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to={`/employees/${e.id}`}>{e.name}</Link>
                  <div className="xs muted">{e.department}</div>
                </td>
                {codes.map((c) => {
                  const b = e.balances.find((x) => x.code === c);
                  return (
                    <td key={c} className="num">
                      {b ? (
                        <>
                          {b.available}
                          <span className="xs muted">/{b.entitled + b.carried}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="xs muted mt-8">Available / entitled (including carry forward).</div>
    </div>
  );
}

// ---------------------------------------------------------------- policies
// Policy Management tab: policy list with ack progress; HR can edit and chase acknowledgements.
function Policies({ focus }) {
  const { isHR, toast } = useApp();
  const { data, reload } = useApi('/policies');
  // Opens the policy named in the URL, if any
  const [view, setView] = useState(focus);
  const [edit, setEdit] = useState(null);
  const [pending, setPending] = useState(null);
  const [run] = useAction(toast);
  if (!data) return <Loading />;
  return (
    <div>
      <Card
        flush
        title="Policy Library"
        action={
          isHR && (
            <Button
              size="sm"
              variant="primary"
              icon={Plus}
              onClick={() => setEdit({})}
              style={{ marginRight: 18 }}
            >
              New policy
            </Button>
          )
        }
      >
        {/* Policy table; clicking a row opens the policy */}
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 18 }}>Policy</th>
                <th>Category</th>
                <th>Version</th>
                <th>Updated</th>
                <th>Acknowledged</th>
                <th>My status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="click" onClick={() => setView(p.id)}>
                  <td style={{ paddingLeft: 18 }}>
                    <div className="b6 row gap-6">
                      <FileText size={16} className="blue" />
                      {p.title}
                    </div>
                    <div className="small muted">{p.summary}</div>
                  </td>
                  <td>
                    <Badge tone="gray">{p.category}</Badge>
                  </td>
                  <td>v{p.version}</td>
                  <td className="small muted nowrap">{fmtDate(p.updated_at)}</td>
                  <td style={{ minWidth: 140 }}>
                    {p.requires_ack ? (
                      <>
                        <div className="small b6">
                          {p.acked} / {p.total}
                        </div>
                        <Progress
                          value={p.total ? (p.acked / p.total) * 100 : 0}
                          color="var(--green)"
                          height={6}
                        />
                      </>
                    ) : (
                      <span className="small muted">Not required</span>
                    )}
                  </td>
                  <td>
                    {p.requires_ack ? (
                      p.myAck ? (
                        <Badge tone="green">Acknowledged</Badge>
                      ) : (
                        <Badge tone="amber">Pending</Badge>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className="right nowrap"
                    style={{ paddingRight: 18 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* HR actions; clicks here don't open the policy */}
                    {isHR && (
                      <Menu
                        items={[
                          { label: 'Edit / new version', icon: Pencil, onClick: () => setEdit(p) },
                          p.requires_ack && {
                            label: 'Who has not acknowledged',
                            icon: Eye,
                            onClick: () => setPending(p.id),
                          },
                          p.requires_ack && {
                            label: 'Send reminder',
                            icon: Bell,
                            onClick: async () => {
                              await run(
                                () => api.post(`/policies/${p.id}/remind`),
                                (r) => `Reminder sent to ${r.sent} people`,
                              );
                            },
                          },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {/* View, edit and pending-acknowledgement modals */}
      {view && <PolicyModal id={view} onClose={() => setView(null)} onDone={reload} />}
      {edit && <PolicyEditor policy={edit} onClose={() => setEdit(null)} onDone={reload} />}
      {pending && <PendingAcks id={pending} onClose={() => setPending(null)} />}
    </div>
  );
}

// Modal listing the employees who have not acknowledged a policy yet.
function PendingAcks({ id, onClose }) {
  const { data } = useApi(`/policies/${id}`);
  return (
    <Modal title={data ? `${data.title}: not yet acknowledged` : 'Loading'} onClose={onClose}>
      {!data ? (
        <Loading />
      ) : data.pending.length ? (
        data.pending.map((e) => (
          <div key={e.id} className="list-item">
            <Person name={e.name} sub={`${e.code} · ${e.department || ''}`} id={e.id} size={30} />
          </div>
        ))
      ) : (
        <Empty text="Everyone has acknowledged this policy" />
      )}
    </Modal>
  );
}

// Creates or edits a policy; an edit can be published as a new version to re-collect acks.
function PolicyEditor({ policy, onClose, onDone }) {
  const { toast } = useApp();
  const isNew = !policy.id;
  // Existing policies are loaded in full (with their text) before editing
  const { data: full } = useApi(isNew ? null : `/policies/${policy.id}`);
  const [f, setF] = useState(null);
  const [file, setFile] = useState(null);
  const [run, busy] = useAction(toast);
  // Blank template for a new policy, else the loaded one
  const src = isNew
    ? { title: '', category: 'General', version: '1.0', summary: '', content: '', requires_ack: 1 }
    : full;
  // Form values: edits so far, else the source with "new version" unticked
  const v = f || (src && { ...src, new_version: false });
  if (!v)
    return (
      <Modal title="Edit policy" onClose={onClose}>
        <Loading />
      </Modal>
    );
  // Change handler for field k; checkboxes store their checked state.
  const set = (k) => (e) =>
    setF({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  // Sends the form as multipart so an attached document can go with it.
  const save = async () => {
    const form = new FormData();
    for (const k of ['title', 'category', 'summary', 'content', 'version'])
      form.append(k, v[k] ?? '');
    form.append('requires_ack', v.requires_ack ? 'true' : 'false');
    form.append('new_version', v.new_version ? 'true' : 'false');
    if (file) form.append('file', file);
    if (
      await run(
        () =>
          api.upload(isNew ? '/policies' : `/policies/${policy.id}`, form, isNew ? 'POST' : 'PUT'),
        isNew ? 'Policy published' : 'Policy saved',
      )
    ) {
      onDone();
      onClose();
    }
  };
  return (
    <Modal
      title={isNew ? 'New policy' : `Edit ${src.title}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {isNew ? 'Publish' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Title">
          <Input value={v.title} onChange={set('title')} />
        </Field>
        <Field label="Category">
          <Select
            value={v.category}
            onChange={set('category')}
            options={['Leave', 'General', 'Compliance', 'POSH', 'IT', 'Finance', 'HR']}
          />
        </Field>
        {/* Version is typed only for a new policy; edits bump it via the checkbox below */}
        {isNew && (
          <Field label="Version">
            <Input value={v.version} onChange={set('version')} />
          </Field>
        )}
        <Field label="Summary" className="full">
          <Input value={v.summary || ''} onChange={set('summary')} maxLength={300} />
        </Field>
        <Field
          label="Policy text"
          hint="Use ## for headings and - for bullet points"
          className="full"
        >
          <Textarea
            value={v.content || ''}
            onChange={set('content')}
            style={{ minHeight: 260, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
          />
        </Field>
        <Field label="Attach document (PDF/DOCX, optional)" className="full">
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
        </Field>
        <label className="check">
          <input type="checkbox" checked={Boolean(v.requires_ack)} onChange={set('requires_ack')} />
          Employees must acknowledge
        </label>
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={Boolean(v.new_version)} onChange={set('new_version')} />
            Publish as new version (v{bump(src.version)}) and ask everyone to re-acknowledge
          </label>
        )}
      </div>
    </Modal>
  );
}
// Next minor version, e.g. 1.2 -> 1.3.
const bump = (ver) => {
  const [a, b = '0'] = String(ver).split('.');
  return `${a}.${Number(b) + 1}`;
};
