import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarCheck, FileText, User, Download, Plus, Cake, PartyPopper, CircleAlert, CircleCheck, ArrowRight, Receipt, Wallet, Trash2 } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { greeting, fmtDate, fmtShort, fmtTime, inr, fmtMonth, fmtDay } from '../lib/format.js';
import { Card, Badge, Button, Empty, Loading, ErrorBox, Progress, Tabs, Person, Avatar, Modal, SimpleMarkdown, useConfirm } from '../components/ui.jsx';
import { ApplyLeaveModal, RaiseRequestModal, ClaimModal } from '../components/forms.jsx';
import { NoticeBoard } from './Dashboard.jsx';
import { ClockActions, AttentionBanner } from '../components/WorkClock.jsx';
import { useWorkday, useNow, workedNow, clockText, useOnWorkdayChange } from '../lib/workday.js';
import { EmployeeForm, Onboarding } from './Employees.jsx';

export default function MySpace() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  const { user } = useApp();
  return (
    <div>
      <div className="page-head">
        <div><h1>{greeting()}, {user.firstName}! <span aria-hidden="true">👋</span></h1><div className="sub">Your attendance, leave, pay and requests in one place.</div></div>
      </div>
      <Tabs value={tab} onChange={(t) => setSp(t === 'overview' ? {} : { tab: t })} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'payslips', label: 'Payslips & Claims' }, { value: 'requests', label: 'My Requests' }]} />
      {tab === 'overview' && <Overview />}
      {tab === 'payslips' && <Payslips />}
      {tab === 'requests' && <MyRequests />}
    </div>
  );
}

function CheckIn({ data }) {
  const s = useWorkday();
  const now = useNow(1000);
  const st = data.attendance.todayStatus;
  const off = st && ['H', 'WO', 'L'].includes(st.code);
  const w = s?.workday;
  const running = Boolean(w?.openSince);
  const worked = workedNow(s, now);
  const first = w?.sessions[0];
  return (
    <div className="card" style={{ background: 'linear-gradient(135deg, #1f2b7b, #3346b8)', color: '#fff', border: 0 }}>
      <div className="row between wrap" style={{ gap: 14 }}>
        <div>
          <div style={{ opacity: 0.8, fontSize: 13 }}>{fmtDay(data.today)}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
            {running ? `Working · ${clockText(worked)}` : w?.sessions.length ? `Paused · ${clockText(worked, false)} worked` : off ? (st.code === 'L' ? `On ${st.leave?.name || 'leave'} today` : st.code === 'H' ? 'Holiday today' : 'Weekly off today') : 'Not checked in yet'}
          </div>
          {first && <div style={{ opacity: 0.85, marginTop: 4 }}>
            Checked in at {fmtTime(first.start)}{w.sessions.length > 1 ? ` · ${w.sessions.length} sessions` : ''}{!running && w.awaySince ? ` · away since ${fmtTime(w.awaySince)}` : ''}{first.mode === 'wfh' ? ' · Work from home' : ''}
          </div>}
        </div>
        <ClockActions light />
      </div>
      <div className="row wrap mt-16" style={{ gap: 18, fontSize: 13, opacity: 0.9 }}>
        <span>This month:</span>
        <span>Present <b>{data.attendance.monthSummary.P}</b></span><span>WFH <b>{data.attendance.monthSummary.WFH}</b></span>
        <span>Half day <b>{data.attendance.monthSummary.HD}</b></span><span>Leave <b>{data.attendance.monthSummary.L}</b></span>
        {data.attendance.monthSummary.A > 0 && <span>Absent <b>{data.attendance.monthSummary.A}</b></span>}
        <Link to="/attendance" style={{ color: '#fff', textDecoration: 'underline' }}>View attendance</Link>
      </div>
    </div>
  );
}

function Overview() {
  const { toast } = useApp();
  const { data, error, reload } = useApi('/dashboard/me');
  const [modal, setModal] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [run] = useAction(toast);
  useOnWorkdayChange(reload);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.employee) return <Card><Empty text="Your login is not linked to an employee record. HR can link it in Settings → Users." /></Card>;
  const e = data.employee;
  return (
    <div>
      <AttentionBanner />
      <div className="grid">
        <div className="span-8"><CheckIn data={data} /></div>
        <Card className="span-4" title="Quick actions">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 0 }}>
            <Button icon={CalendarCheck} onClick={() => setModal('leave')}>Apply leave</Button>
            <Button icon={FileText} onClick={() => setModal('request')}>Raise request</Button>
            <Button icon={Receipt} onClick={() => setModal('claim')}>Claim expense</Button>
            <Button icon={User} onClick={() => setModal('profile')}>Update profile</Button>
          </div>
        </Card>
      </div>

      {data.onboarding.length > 0 && data.onboarding.some((t) => !t.done) && <div className="mb-16"><Onboarding tasks={data.onboarding} reload={reload} canEdit={false} /></div>}

      {data.pendingPolicies.length > 0 && (
        <div className="alert warn mb-16" style={{ alignItems: 'center' }}>
          <CircleAlert size={18} />
          <span className="grow">Please read and acknowledge: {data.pendingPolicies.map((p) => <button key={p.id} type="button" className="link" style={{ marginLeft: 6 }} onClick={() => setPolicy(p.id)}>{p.title} v{p.version}</button>)}</span>
        </div>
      )}
      {!data.poshTrained && <div className="alert info mb-16"><CircleAlert size={18} /><span>You have not completed POSH awareness training. <Link to="/posh">Take it now</Link> (10 minutes).</span></div>}

      <div className="grid">
        <Card className="span-8" title="Leave balance" action={<Link className="link" to="/leave">Leave & Policies <ArrowRight size={14} /></Link>}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 0 }}>
            {data.balances.filter((b) => b.quota != null).map((b) => (
              <div key={b.code} className="card tight" style={{ boxShadow: 'none', textAlign: 'center' }}>
                <div className="small" style={{ color: 'var(--text-2)' }}>{b.name}</div>
                <div style={{ fontSize: 20, fontWeight: 700, margin: '4px 0' }}>{b.available}<span className="small muted" style={{ fontWeight: 500 }}> / {b.entitled + b.carried}</span></div>
                <Progress value={((b.used + b.pending) / Math.max(1, b.entitled + b.carried)) * 100} color={b.color} height={6} />
              </div>
            ))}
          </div>
          <h3 className="mt-16 mb-8" style={{ fontSize: 15 }}>My recent requests</h3>
          {data.myRequests.length ? data.myRequests.map((r) => (
            <div key={r.id} className="list-item"><span className="dot" style={{ background: r.color }} /><span className="grow">{r.type}<span className="small muted"> · {fmtShort(r.from_date)}{r.to_date !== r.from_date ? ` – ${fmtShort(r.to_date)}` : ''} ({r.days} day{r.days === 1 ? '' : 's'})</span></span><Badge>{r.status}</Badge>
              {['Pending', 'Approved'].includes(r.status) && r.from_date > data.today && <Button size="xs" variant="ghost" onClick={async () => { if (await run(() => api.post(`/leave/requests/${r.id}/cancel`), 'Request cancelled')) reload(); }}>Cancel</Button>}
            </div>
          )) : <Empty text="No leave requests yet" />}
        </Card>
        <div className="span-4 col" style={{ gap: 16 }}>
          <Card title="Latest payslip" action={<Link className="link" to="/my?tab=payslips">All payslips <ArrowRight size={14} /></Link>}>
            {data.payslip ? (
              <div className="row between"><div><div className="muted small">{fmtMonth(data.payslip.month)}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{inr(data.payslip.net)}</div><div className="small muted">Net pay · Gross {inr(data.payslip.gross)}</div></div>
                <a className="btn sm" href={`/print/payslip/${data.payslip.id}`} target="_blank" rel="noreferrer"><Download size={15} />PDF</a></div>
            ) : <Empty icon={Wallet} text="No payslips yet" />}
          </Card>
          <Card title="Upcoming holidays">
            {data.holidays.length ? data.holidays.map((h) => <div key={h.id} className="list-item" style={{ padding: '7px 0' }}><span className="grow">{h.name}</span><Badge tone={h.type === 'Company' ? 'blue' : 'pink'}>{h.type}</Badge><span className="small muted nowrap">{fmtDay(h.date)}</span></div>) : <Empty text="No upcoming holidays" />}
          </Card>
        </div>
      </div>

      <div className="grid">
        <Card className="span-4" title={data.cycle ? `My goals · ${data.cycle.name}` : 'My goals'} action={<Link className="link" to="/performance">Open <ArrowRight size={14} /></Link>}>
          {data.goals.length ? data.goals.map((g) => <div key={g.id} className="mb-12"><div className="row between small"><span className="ellipsis">{g.title}</span><b>{g.progress}%</b></div><Progress value={g.progress} color={g.progress >= 80 ? 'var(--green)' : 'var(--blue)'} height={6} /></div>) : <Empty text="No goals yet" />}
          {data.review && <div className="small muted">Review status: <Badge>{data.review.status}</Badge></div>}
        </Card>
        <Card className="span-4" title="Team">
          {data.teamOnLeave.length > 0 && <div className="mb-12">{data.teamOnLeave.map((l) => <div key={`${l.employee_id}${l.from_date}`} className="small mb-8"><b>{l.name}</b> <span className="muted">· {l.type} · {fmtShort(l.from_date)}{l.to_date !== l.from_date ? ` – ${fmtShort(l.to_date)}` : ''}</span></div>)}</div>}
          {data.team.length ? data.team.slice(0, 6).map((t) => <div key={t.id} className="list-item" style={{ padding: '6px 0' }}><Person name={t.name} sub={t.designation} id={t.id} hasPhoto={t.has_photo} size={30} /></div>) : <Empty text="No teammates" />}
        </Card>
        <div className="span-4 col" style={{ gap: 16 }}>
          <Card title="Celebrations">
            {data.celebrations.length ? data.celebrations.map((c) => (
              <div key={`${c.id}${c.kind}`} className="list-item" style={{ padding: '7px 0' }}>
                <Avatar name={c.name} size={30} />
                <span className="grow small"><b>{c.name}</b><div className="muted">{c.kind === 'Birthday' ? 'Birthday' : `${c.years} year${c.years === 1 ? '' : 's'} at BrainADZ`}</div></span>
                {c.kind === 'Birthday' ? <Cake size={18} className="red" /> : <PartyPopper size={18} className="amber" />}
                <span className="small muted">{c.date === data.today ? 'Today' : fmtShort(c.date)}</span>
              </div>
            )) : <Empty text="No celebrations in the next 2 weeks" />}
          </Card>
          <div className="card tight"><NoticeBoard notices={data.notices} onChange={reload} compact /></div>
        </div>
      </div>
      {modal === 'leave' && <ApplyLeaveModal onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'request' && <RaiseRequestModal onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'claim' && <ClaimModal onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'profile' && <ProfileLoader id={e.id} onClose={() => setModal(null)} />}
      {policy && <PolicyModal id={policy} onClose={() => setPolicy(null)} onDone={reload} />}
    </div>
  );
}

function ProfileLoader({ id, onClose }) {
  const { data } = useApi(`/employees/${id}`);
  if (!data) return null;
  return <EmployeeForm employee={data} selfOnly onClose={onClose} />;
}

export function PolicyModal({ id, onClose, onDone }) {
  const { toast, user } = useApp();
  const { data } = useApi(`/policies/${id}`);
  const [run, busy] = useAction(toast);
  return (
    <Modal title={data ? `${data.title} · v${data.version}` : 'Policy'} size="wide" onClose={onClose}
      footer={data && <>
        {data.hasFile && <Button icon={Download} onClick={() => download(`/policies/${id}/file`)}>Download document</Button>}
        {data.requires_ack && user.employeeId ? (data.myAck ? <span className="row gap-6 green b6"><CircleCheck size={18} />Acknowledged {fmtDate(data.myAck)}</span>
          : <Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post(`/policies/${id}/ack`), 'Thank you for acknowledging')) { onDone?.(); onClose(); } }}>I have read and agree</Button>) : <Button onClick={onClose}>Close</Button>}
      </>}>
      {!data ? <Loading /> : (
        <div>
          {data.summary && <p className="muted mb-12">{data.summary}</p>}
          {data.content ? <SimpleMarkdown text={data.content} /> : <Empty text="See the attached document" />}
          <div className="small muted mt-16">Last updated {fmtDate(data.updated_at)}</div>
        </div>
      )}
    </Modal>
  );
}

function Payslips() {
  const { toast } = useApp();
  const { data, reload } = useApi('/payroll/my');
  const [claim, setClaim] = useState(false);
  const [run] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  if (!data) return <Loading />;
  return (
    <div className="grid">
      <Card className="span-7" title="Payslips" flush>
        {data.items.length ? (
          <table className="table"><thead><tr><th style={{ paddingLeft: 18 }}>Month</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net pay</th><th /></tr></thead>
            <tbody>{data.items.map((p) => (
              <tr key={p.id}><td style={{ paddingLeft: 18 }} className="b6">{p.label}</td><td className="num">{inr(p.gross)}</td><td className="num">{inr(p.deductions)}</td><td className="num b7">{inr(p.net)}</td>
                <td className="right" style={{ paddingRight: 18 }}><a className="btn sm" href={`/print/payslip/${p.id}`} target="_blank" rel="noreferrer"><Download size={15} />View / PDF</a></td></tr>
            ))}</tbody></table>
        ) : <div style={{ padding: 18 }}><Empty icon={Wallet} text="Payslips appear here once payroll is paid" /></div>}
      </Card>
      <Card className="span-5" title="Reimbursement claims" action={<Button size="sm" variant="primary" icon={Plus} onClick={() => setClaim(true)}>New claim</Button>}>
        {data.claims.length ? data.claims.map((c) => (
          <div key={c.id} className="list-item">
            <div className="grow"><div className="b6">{inr(c.amount)} <span className="small muted">· {c.kind}</span></div><div className="small muted">{c.note || '—'} · {fmtMonth(c.month)}</div></div>
            <Badge>{c.status}</Badge>
            {c.status === 'Pending' && <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete claim" onClick={async () => { if (await confirm({ title: 'Withdraw claim?', text: `${inr(c.amount)} · ${c.note || c.kind}`, danger: true, confirmLabel: 'Withdraw' })) { await run(() => api.del(`/payroll/adjustments/${c.id}`), 'Claim withdrawn'); reload(); } }} />}
          </div>
        )) : <Empty icon={Receipt} text="No claims yet" />}
        <div className="small muted mt-12">Approved claims are paid with that month's salary.</div>
      </Card>
      {claim && <ClaimModal onClose={() => setClaim(false)} onDone={reload} />}
      {confirmEl}
    </div>
  );
}

function MyRequests() {
  const { data, reload } = useApi('/requests?mine=1');
  const [open, setOpen] = useState(false);
  if (!data) return <Loading />;
  return (
    <Card title="Helpdesk requests" action={<Button size="sm" variant="primary" icon={Plus} onClick={() => setOpen(true)}>Raise a request</Button>}>
      {data.items.length ? data.items.map((r) => (
        <div key={r.id} className="list-item" style={{ alignItems: 'flex-start' }}>
          <Badge tone="blue">{r.category}</Badge>
          <div className="grow"><div className="b6">{r.subject}</div>{r.description && <div className="small muted">{r.description}</div>}{r.response && <div className="small green mt-8">HR: {r.response}</div>}</div>
          <span className="small muted">{fmtDate(r.created_at)}</span>
          <Badge tone={r.status === 'Resolved' ? 'green' : r.status === 'Open' ? 'amber' : 'blue'}>{r.status}</Badge>
        </div>
      )) : <Empty text="You have not raised any requests" />}
      {open && <RaiseRequestModal onClose={() => setOpen(false)} onDone={reload} />}
    </Card>
  );
}
