import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, UserRound, UserPlus, CalendarPlus, ArrowRight, MapPin, Megaphone, FileText, Trophy, HeartPulse, Plus, Trash2, Video, Building2 } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { fmtShort, fmtTime, greeting, fmtMonth, fmtDate } from '../lib/format.js';
import { Card, Kpi, Person, Button, Badge, Empty, Loading, ErrorBox, Seg, Modal, Field, Input, Textarea, Select, DateBox, Menu, useConfirm } from '../components/ui.jsx';
import { Donut, Legend, Funnel, PipelineDots, Bars, HBars, Ring, STATUS } from '../components/charts.jsx';
import { BrandBanner } from '../components/Layout.jsx';
import { AttentionBanner } from '../components/WorkClock.jsx';

const NOTICE_ICON = { health: HeartPulse, policy: FileText, award: Trophy, event: Megaphone, general: Megaphone };
const NOTICE_TONE = { health: 'var(--red)', policy: 'var(--blue)', award: 'var(--green)', event: 'var(--purple)', general: 'var(--amber)' };

export function VerticalFilterNote() {
  const { vertical, setVertical, verticalById } = useApp();
  const v = vertical && verticalById(vertical);
  if (!v) return null;
  return <span className="chip" style={{ background: '#fff', border: '1px solid var(--border)' }}>Showing {v.name}<button type="button" onClick={() => setVertical(null)} aria-label="Clear vertical filter">✕</button></span>;
}

export function NoticeBoard({ notices, onChange, compact }) {
  const { isHR, toast } = useApp();
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', body: '', kind: 'general' });
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const list = (items) => items.map((n) => {
    const Icon = NOTICE_ICON[n.kind] || Megaphone;
    return (
      <div key={n.id} className="list-item" style={{ padding: compact ? '7px 0' : undefined }}>
        <Icon size={18} style={{ color: NOTICE_TONE[n.kind], flexShrink: 0 }} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ fontSize: 13.5 }}>{n.title}</div>
          {all && n.body && <div className="small muted mt-8" style={{ marginTop: 2 }}>{n.body}</div>}
        </div>
        <span className="small muted nowrap">{fmtDate(n.created_at)}</span>
        {all && isHR && <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Delete notice" onClick={async () => { if (await confirm({ title: 'Delete notice?', text: n.title, danger: true, confirmLabel: 'Delete' })) { await run(() => api.del(`/notices/${n.id}`), 'Notice deleted'); onChange?.(); } }}><Trash2 size={15} /></button>}
      </div>
    );
  });
  return (
    <>
      <div className="card-head" style={{ marginBottom: 6 }}>
        <h3>Notice Board</h3>
        <div className="row">
          {isHR && <button type="button" className="link" onClick={() => setAdding(true)}><Plus size={14} />Post</button>}
          <button type="button" className="link" onClick={() => setAll(true)}>View all <ArrowRight size={14} /></button>
        </div>
      </div>
      {notices.length ? list(notices.slice(0, 3)) : <Empty text="No notices yet" />}
      {all && <NoticeList onClose={() => setAll(false)} render={list} />}
      {adding && (
        <Modal title="Post a notice" onClose={() => setAdding(false)} footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/notices', f), 'Notice posted')) { setAdding(false); setF({ title: '', body: '', kind: 'general' }); onChange?.(); } }}>Post notice</Button></>}>
          <div className="col" style={{ gap: 14 }}>
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} /></Field>
            <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: 'general', label: 'General' }, { value: 'event', label: 'Event' }, { value: 'policy', label: 'Policy' }, { value: 'health', label: 'Health & wellness' }, { value: 'award', label: 'Awards' }]} /></Field>
            <Field label="Details"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
            <div className="small muted">Everyone with a login gets a notification.</div>
          </div>
        </Modal>
      )}
      {confirmEl}
    </>
  );
}

function NoticeList({ onClose, render }) {
  const { data } = useApi('/notices');
  return <Modal title="Notice board" size="wide" onClose={onClose}>{data ? (data.items.length ? render(data.items) : <Empty />) : <Loading />}</Modal>;
}

export default function Dashboard() {
  const { user, vertical, toast, info } = useApp();
  const nav = useNavigate();
  const { data, error, reload } = useApi(`/dashboard${vertical ? `?vertical=${vertical}` : ''}`);
  const [tab, setTab] = useState('departments');
  const [run] = useAction(toast);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const decide = async (id, action) => {
    if (await run(() => api.post(`/leave/requests/${id}/decision`, { action }), action === 'approve' ? 'Leave approved' : 'Leave rejected')) reload();
  };
  const analyticsItems = { departments: data.analytics.departments, tenure: data.analytics.tenure, location: data.analytics.locations, gender: data.analytics.gender }[tab];
  const p = data.payroll;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{greeting()}, {user.firstName}! <span aria-hidden="true">👋</span></h1>
          <div className="sub">Here's what's happening across {data.scope === 'team' ? 'your team' : info.companyName || 'BrainADZ'} today. <VerticalFilterNote /></div>
        </div>
        <BrandBanner />
      </div>
      <AttentionBanner />

      <div className="kpis">
        <Kpi icon={Users} tone="blue" label={data.scope === 'team' ? 'Team Members' : 'Total Employees'} value={k.headcount} delta={k.headcountChange} onClick={() => nav('/employees')} />
        <Kpi icon={UserRound} tone="red" label="Open Positions" value={k.openPositions} delta={k.openChange} onClick={() => nav('/hiring')} />
        <Kpi icon={UserPlus} tone="green" label="New Joiners (This Month)" value={k.joiners} delta={k.joinersChange} />
        <Kpi icon={CalendarPlus} tone="amber" label="On Leave Today" value={k.onLeave} extra={<span className="delta"><span className="d" style={{ color: 'var(--text-2)' }}>{k.onLeavePct}%</span><small>of total employees</small></span>} onClick={() => nav('/leave?tab=manage')} />
      </div>

      <div className="grid">
        <Card className="span-4" title="Employee Distribution by Vertical">
          <div className="row donut-row" style={{ gap: 22 }}>
            <Donut data={data.byVertical} center={{ value: k.headcount, label: 'Employees' }} />
            <Legend items={data.byVertical.map((v) => ({ label: v.label, value: v.value, color: v.color }))} />
          </div>
        </Card>
        <Card className="span-4" title="Employee Lifecycle Funnel">
          <Funnel steps={[
            { label: 'Applications', value: data.funnel.applications || 0 },
            { label: 'Screened (AI)', value: data.funnel.screened || 0 },
            { label: 'Interviews', value: data.funnel.interviews || 0 },
            { label: 'Offers', value: data.funnel.offers || 0 },
            { label: 'Hired', value: data.funnel.hired || 0 },
          ]} />
        </Card>
        <Card className="span-4" title="Hiring Pipeline" action={<Link className="link" to="/hiring">View all jobs <ArrowRight size={14} /></Link>}>
          <div style={{ paddingTop: 10 }}>
            <PipelineDots items={[
              { label: 'Open Positions', value: data.pipeline.open }, { label: 'Screening', value: data.pipeline.screening },
              { label: 'Interviews', value: data.pipeline.interviews }, { label: 'Offers', value: data.pipeline.offers }, { label: 'Hired', value: data.pipeline.hired },
            ]} />
          </div>
        </Card>
      </div>

      <div className="grid">
        <Card className="span-4" title="Upcoming Interviews" action={<Link className="link" to="/hiring">View all <ArrowRight size={14} /></Link>}>
          {data.interviews.length ? data.interviews.map((i) => (
            <div key={i.id} className="list-item">
              <DateBox date={i.scheduled_at.slice(0, 10)} />
              <span className="small muted nowrap" style={{ width: 66 }}>{fmtTime(i.scheduled_at.slice(11, 16))}</span>
              <div className="grow" style={{ minWidth: 0 }}><div className="b6 ellipsis">{i.name}</div><div className="small muted ellipsis">{i.title}</div></div>
              <Badge tone="blue">{i.mode === 'Virtual' ? <><Video size={12} />{i.round}</> : i.round}</Badge>
              <Menu items={[{ label: 'Open candidate', onClick: () => nav(`/hiring?candidate=${i.candidate_id}`) }]} />
            </div>
          )) : <Empty text="No interviews scheduled" />}
        </Card>
        <Card className="span-4" title={<>Leave Requests <span className="sub">(Pending Approval{data.pendingLeaveCount > 5 ? ` · ${data.pendingLeaveCount}` : ''})</span></>} action={<Link className="link" to="/leave?tab=manage">View all <ArrowRight size={14} /></Link>}>
          {data.pendingLeaves.length ? data.pendingLeaves.map((l) => (
            <div key={l.id} className="list-item">
              <div className="grow" style={{ minWidth: 0 }}>
                <Person name={l.name} id={l.employee_id} sub={<span className="row gap-6"><span className="dot" style={{ background: l.vertical_color || 'var(--amber)' }} />{l.vertical} • {l.department}</span>} />
              </div>
              <div className="small hide-sm" style={{ width: 96 }}><div className="b6">{l.days} day{l.days === 1 ? '' : 's'}</div><div className="muted">{fmtShort(l.from_date)}{l.to_date !== l.from_date ? ` – ${fmtShort(l.to_date)}` : ''}</div></div>
              <Button size="sm" variant="success" onClick={() => decide(l.id, 'approve')}>Approve</Button>
              <Button size="sm" variant="reject" onClick={() => decide(l.id, 'reject')}>Reject</Button>
            </div>
          )) : <Empty text="No leave requests waiting for you" />}
        </Card>
        {p ? (
          <Card className="span-4" title={<>Payroll Status <span className="sub">({fmtMonth(p.month)})</span></>} action={<Link className="link" to={`/payroll?month=${p.month}`}>View details <ArrowRight size={14} /></Link>}>
            <div className="row donut-row" style={{ gap: 22 }}>
              <Donut size={150} thickness={20} data={[
                { label: 'Paid', value: p.paid, color: STATUS.good },
                { label: 'Processed (awaiting payment)', value: p.processed, color: STATUS.info },
                { label: 'On hold', value: p.onHold, color: STATUS.bad },
                { label: 'Not applicable', value: p.notApplicable, color: STATUS.neutral },
              ]} center={{ value: `${Math.round(p.percent)}%`, label: p.status === 'Completed' ? 'Paid' : 'Processed' }} />
              <Legend showPct={false} items={[
                { label: 'Paid', value: p.paid, color: STATUS.good, showPct: false },
                { label: 'Processed', value: p.processed, color: STATUS.info, showPct: false },
                { label: 'On hold', value: p.onHold, color: STATUS.bad, showPct: false },
                { label: 'Not applicable', value: p.notApplicable, color: STATUS.neutral, showPct: false },
              ]} />
            </div>
            <div className="small muted mt-12">Run status: <Badge>{p.status}</Badge></div>
          </Card>
        ) : (
          <Card className="span-4" title="Your Team">
            <TeamQuick />
          </Card>
        )}
      </div>

      <div className="grid">
        <Card className="span-3" title="Attrition vs Hiring Trend">
          <div className="row small mb-8" style={{ gap: 14 }}>
            <span className="row gap-6"><span className="dot" style={{ background: '#1A6DF0' }} />New Joiners</span>
            <span className="row gap-6"><span className="dot" style={{ background: '#E5243B' }} />Attrition</span>
          </div>
          <Bars height={180} categories={data.trend.map((t) => t.label)} series={[
            { name: 'New Joiners', color: '#1A6DF0', values: data.trend.map((t) => t.joiners) },
            { name: 'Attrition', color: '#E5243B', values: data.trend.map((t) => t.exits) },
          ]} />
        </Card>
        <Card className="span-3" title="People Analytics">
          <Seg value={tab} onChange={setTab} options={[{ value: 'departments', label: 'Departments' }, { value: 'tenure', label: 'Tenure' }, { value: 'location', label: 'Location' }, { value: 'gender', label: 'Gender' }]} />
          <div className="mt-12"><HBars items={analyticsItems.slice(0, 7)} labelWidth={92} /></div>
        </Card>
        <Card className="span-3" title="Policy & Compliance" action={<Link className="link" to="/leave?tab=policies">View all <ArrowRight size={14} /></Link>}>
          <div className="row" style={{ justifyContent: 'space-around', paddingTop: 6 }}>
            <Ring value={data.compliance.ackPct} color={STATUS.good} label="Policy Acknowledged" sub={`${data.compliance.acknowledged} / ${data.compliance.headcount}`} />
            <Ring value={data.compliance.poshPct} color={data.compliance.poshPct >= 90 ? STATUS.good : STATUS.warn} label="POSH Training Completed" sub={`${data.compliance.poshTrained} / ${data.compliance.headcount}`} />
          </div>
        </Card>
        <div className="span-3 col" style={{ gap: 16 }}>
          <div className="card tight row" style={{ gap: 14 }}>
            <b>Org Summary</b>
            <span className="row gap-6"><Building2 size={20} className="blue" /><span><b>{data.org.departments}</b><div className="xs muted">Departments</div></span></span>
            <span className="row gap-6"><MapPin size={20} className="blue" /><span><b>{data.org.locations}</b><div className="xs muted">Locations</div></span></span>
          </div>
          <div className="card tight" style={{ flex: 1 }}><NoticeBoard notices={data.notices} onChange={reload} compact /></div>
        </div>
      </div>
    </div>
  );
}

function TeamQuick() {
  const { data } = useApi('/employees?team=1&pageSize=8');
  if (!data) return <Loading />;
  return data.items.length ? data.items.map((e) => (
    <div key={e.id} className="list-item"><Person name={e.name} id={e.id} hasPhoto={e.has_photo} sub={e.designation} /><span className="grow" /><Badge>{e.status}</Badge></div>
  )) : <Empty text="No direct reports" />;
}
