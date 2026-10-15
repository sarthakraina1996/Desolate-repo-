import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Briefcase, Users, FileCheck, Handshake, ArrowRight, Plus, ChevronLeft, ChevronRight, Mail, Phone, MapPin, Link2, CalendarPlus, X, Star,
  Video, Download, Pencil, UserCheck, Sparkles, CircleCheck,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction, useDebounced } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { fmtDate, fmtShort, fmtTime, ago, lpa, plural } from '../lib/format.js';
import {
  Card, Kpi, Badge, Button, Empty, Loading, ErrorBox, Person, Avatar, Modal, Field, Input, Select, Textarea, Tabs, Progress, Menu, EmployeeSelect,
} from '../components/ui.jsx';
import { Bars, CAT } from '../components/charts.jsx';
import { TempPasswordModal } from '../components/forms.jsx';
import { VerticalFilterNote } from './Dashboard.jsx';

export const STAGES = ['Applied', 'AI Screened', 'Shortlisted', 'Interview 1', 'Interview 2', 'Offer', 'Hired'];
const STAGE_STYLE = {
  Applied: ['#F3F5F9', '#1b2848'], 'AI Screened': ['#EAF1FE', '#1A6DF0'], Shortlisted: ['#F1ECFF', '#6B4FE0'], 'Interview 1': ['#FDECEF', '#E31B3B'],
  'Interview 2': ['#FFF5DC', '#B47B00'], Offer: ['#E8F6EE', '#1FA855'], Hired: ['#EAF1FE', '#1350B8'],
};

export default function Hiring() {
  const { meta, vertical, isHR } = useApp();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [f, setF] = useState({ department: '', location: '', type: '', from: '', to: '' });
  const qs = new URLSearchParams({ ...(vertical ? { vertical } : {}), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...(sp.get('job') ? { job: sp.get('job') } : {}) });
  const { data, error, reload } = useApi(`/hiring?${qs}`);
  const selected = Number(sp.get('candidate')) || null;
  const [modal, setModal] = useState(null);
  const select = (id) => setSp((p) => { const n = new URLSearchParams(p); if (id) n.set('candidate', id); else n.delete('candidate'); return n; });
  const flat = useMemo(() => (data?.pipeline || []).flatMap((c) => c.candidates.map((x) => x.id)), [data]);
  const current = selected || flat[0];
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const set = (key) => (e) => setF({ ...f, [key]: e.target.value });
  const idx = flat.indexOf(current);
  return (
    <div>
      <div className="page-head">
        <div><h1>Hiring</h1><div className="sub">Find Exceptional Talent. Build Stronger Teams. <VerticalFilterNote /></div></div>
        <div className="filters">
          <Select value={f.department} onChange={set('department')} placeholder="All Departments" options={meta.departments.map((d) => ({ value: d.id, label: d.name }))} />
          <Select value={f.location} onChange={set('location')} placeholder="All Locations" options={meta.locations.map((l) => ({ value: l.id, label: l.name }))} />
          <Select value={f.type} onChange={set('type')} placeholder="All Employment Types" options={['Full-time', 'Part-time', 'Contract', 'Intern']} />
          <div className="row gap-4"><Input type="date" value={f.from || data.from} onChange={set('from')} style={{ width: 150 }} aria-label="From" /><span className="muted">–</span><Input type="date" value={f.to || data.to} onChange={set('to')} style={{ width: 150 }} aria-label="To" /></div>
          {sp.get('job') && <span className="chip">Job filter<button type="button" onClick={() => setSp({})}>✕</button></span>}
        </div>
      </div>
      <div className="kpis">
        <Kpi icon={Briefcase} tone="blue" label="Open Roles" value={k.openRoles} delta={k.openChange} deltaLabel="vs. previous period" />
        <Kpi icon={Users} tone="red" label="Time to Fill (Avg)" value={k.timeToFill != null ? `${k.timeToFill} Days` : '—'} delta={k.timeToFillChange} deltaLabel="vs. previous period" invert />
        <Kpi icon={FileCheck} tone="green" label="Offers Sent" value={k.offersSent} delta={k.offersChange} deltaLabel="vs. previous period" />
        <Kpi icon={Handshake} tone="amber" label="Offer Acceptance Rate" value={k.acceptance != null ? `${k.acceptance}%` : '—'} delta={k.acceptanceChange} deltaLabel="vs. previous period" />
      </div>

      <div className="grid" style={{ alignItems: 'start' }}>
        <Card className="span-9" title={<>Hiring Pipeline <span className="sub">({plural(data.totalCandidates, 'Candidate')})</span></>} action={<button type="button" className="link" onClick={() => setModal({ type: 'all' })}>View all candidates <ArrowRight size={14} /></button>}>
          <div className="kanban">
            {data.pipeline.map((col) => {
              const [bg, fg] = STAGE_STYLE[col.stage];
              return (
                <div key={col.stage} className="kcol" style={{ background: bg }}>
                  <h4 style={{ color: fg }}>{col.stage}<span style={{ color: fg, fontWeight: 500 }}>({col.total})</span></h4>
                  {col.candidates.map((c) => (
                    <div key={c.id} className={`kcard ${c.id === current ? 'sel' : ''}`} onClick={() => select(c.id)}>
                      <div className="row" style={{ gap: 8 }}>
                        <Avatar name={c.name} size={30} />
                        <div style={{ minWidth: 0 }}><div className="small b6 ellipsis">{c.name}</div><div className="xs muted ellipsis">{c.title}</div></div>
                      </div>
                      <div className="row between xs muted mt-8" style={{ marginTop: 6 }}><span>{ago(c.updated_at)}</span>{c.ai_score != null && <span className="b6" style={{ color: fg }}>{c.ai_score}%</span>}</div>
                    </div>
                  ))}
                  {col.total > col.candidates.length && <div className="more" style={{ color: fg }} onClick={() => setModal({ type: 'stage', stage: col.stage })}>+ {col.total - col.candidates.length} more</div>}
                  {col.total === 0 && <div className="xs muted center" style={{ padding: 10 }}>No candidates</div>}
                </div>
              );
            })}
          </div>
        </Card>
        <div className="span-3">
          <Card title="Candidate Details" action={<div className="row gap-4"><Button size="xs" variant="ghost" disabled={idx <= 0} onClick={() => select(flat[idx - 1])} aria-label="Previous candidate"><ChevronLeft size={16} /></Button><Button size="xs" variant="ghost" disabled={idx < 0 || idx >= flat.length - 1} onClick={() => select(flat[idx + 1])} aria-label="Next candidate"><ChevronRight size={16} /></Button></div>}>
            {current ? <CandidatePanel key={current} id={current} onChanged={reload} /> : <Empty text="Select a candidate" />}
          </Card>
        </div>
      </div>

      <div className="grid">
        <Card className="span-5" title={<>Job Requisitions <span className="sub">({data.jobs.length})</span></>} action={isHR && <Button size="sm" variant="primary" icon={Plus} onClick={() => setModal({ type: 'job' })}>Create Job</Button>}>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Job Title</th><th>Vertical</th><th className="hide-sm">Location</th><th>Applicants</th><th>Status</th><th /></tr></thead>
              <tbody>{data.jobs.slice(0, 8).map((j) => (
                <tr key={j.id}>
                  <td><div className="b6">{j.title}</div><div className="xs muted">{j.department} · posted {fmtShort(j.posted_on)}</div></td>
                  <td><span className="row gap-6 small"><span className="dot" style={{ background: j.vertical_color }} />{j.vertical_short}</span></td>
                  <td className="hide-sm small">{j.work_mode === 'Remote' ? 'Remote' : j.location}</td>
                  <td>{j.applicants}</td>
                  <td><Badge>{j.status}</Badge></td>
                  <td><Menu items={[
                    { label: 'View candidates', onClick: () => setModal({ type: 'all', job: j.id }) },
                    isHR && { label: 'Screen resumes', onClick: () => navigate(`/screener?job=${j.id}`) },
                    isHR && { label: 'Edit job', onClick: () => setModal({ type: 'job', job: j }) },
                    isHR && j.status !== 'Active' && { label: 'Mark Active', onClick: () => api.put(`/jobs/${j.id}`, { status: 'Active' }).then(reload) },
                    isHR && j.status === 'Active' && { label: 'Put on hold', onClick: () => api.put(`/jobs/${j.id}`, { status: 'On Hold' }).then(reload) },
                    isHR && j.status !== 'Closed' && { label: 'Close job', onClick: () => api.put(`/jobs/${j.id}`, { status: 'Closed' }).then(reload) },
                  ]} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {data.jobs.length > 8 && <button type="button" className="link mt-8" onClick={() => setModal({ type: 'jobs' })}>View all jobs <ArrowRight size={14} /></button>}
        </Card>
        <Card className="span-4" title={data.interviewsToday.length ? 'Interview Schedule (Today)' : 'Upcoming Interviews'}>
          {(data.interviewsToday.length ? data.interviewsToday : data.upcoming).map((i) => (
            <div key={i.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => select(i.candidate_id)}>
              <span className="small muted nowrap" style={{ width: 70 }}>{data.interviewsToday.length ? fmtTime(i.scheduled_at.slice(11)) : `${fmtShort(i.scheduled_at.slice(0, 10))}`}</span>
              <Avatar name={i.name} size={32} />
              <div className="grow" style={{ minWidth: 0 }}><div className="b6 small ellipsis">{i.name}</div><div className="xs muted ellipsis">{i.title}</div></div>
              <div className="col" style={{ gap: 3, alignItems: 'flex-end' }}><Badge tone={i.round === 'Interview 1' ? 'pink' : 'amber'}>{i.round}</Badge><span className="xs muted row gap-4">{i.mode === 'Virtual' ? <Video size={12} /> : <MapPin size={12} />}{i.mode}</span></div>
            </div>
          ))}
          {!data.interviewsToday.length && !data.upcoming.length && <Empty text="No interviews scheduled" />}
        </Card>
        <Card className="span-3" title="Hiring Team Scorecards">
          {data.scorecards.length ? data.scorecards.map((s) => (
            <div key={s.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => select(s.id)}>
              <Avatar name={s.name} size={32} />
              <div className="grow" style={{ minWidth: 0 }}><div className="b6 small ellipsis">{s.name}</div><div className="xs muted ellipsis">{s.title}</div></div>
              <div className="right"><div className="row gap-4 small b7"><Star size={14} fill="#F2A600" color="#F2A600" />{s.avg} / 5</div><div className="xs muted">{plural(s.n, 'interview')}</div></div>
            </div>
          )) : <Empty text="No scorecards yet" />}
        </Card>
      </div>

      <div className="grid">
        <Card className="span-6" title="Candidate Source Performance">
          <div className="row small mb-8" style={{ gap: 14 }}>
            {[['Applied', CAT[0]], ['Shortlisted', CAT[1]], ['Hired', CAT[2]]].map(([l, c]) => <span key={l} className="row gap-6"><span className="dot" style={{ background: c }} />{l}</span>)}
          </div>
          <Bars height={210} categories={data.sources.map((s) => s.source)} series={[
            { name: 'Applied', color: CAT[0], values: data.sources.map((s) => s.applied) },
            { name: 'Shortlisted', color: CAT[1], values: data.sources.map((s) => s.shortlisted) },
            { name: 'Hired', color: CAT[2], values: data.sources.map((s) => s.hired) },
          ]} />
        </Card>
        <Card className="span-6" title={<>Onboarding Handoff <span className="sub">(New Hires)</span></>}>
          {data.onboarding.length ? (
            <table className="table compact">
              <thead><tr><th>Name</th><th>Vertical</th><th>Join Date</th><th>Onboarding Tasks</th><th>Status</th></tr></thead>
              <tbody>{data.onboarding.map((o) => (
                <tr key={o.id}>
                  <td><Person name={o.name} sub={o.designation} id={o.id} hasPhoto={o.has_photo} size={28} /></td>
                  <td><span className="row gap-6 small"><span className="dot" style={{ background: o.vertical_color }} />{o.vertical}</span></td>
                  <td className="small nowrap">{fmtDate(o.join_date)}</td>
                  <td style={{ minWidth: 120 }}><div className="row gap-6"><div className="grow"><Progress value={(o.done / o.total) * 100} color="var(--blue)" height={6} /></div><span className="xs muted">{o.done}/{o.total}</span></div></td>
                  <td><Badge tone={o.status === 'Completed' ? 'green' : o.status === 'In Progress' ? 'amber' : 'red'}>{o.status}</Badge></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <Empty text="No new hires being onboarded" />}
        </Card>
      </div>

      {modal?.type === 'job' && <JobForm job={modal.job} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.type === 'stage' && <CandidateList title={modal.stage} query={`stage=${encodeURIComponent(modal.stage)}`} onPick={(id) => { setModal(null); select(id); }} onClose={() => setModal(null)} />}
      {modal?.type === 'all' && <CandidateList title={modal.job ? data.jobs.find((j) => j.id === modal.job)?.title : 'All candidates'} query={modal.job ? `job=${modal.job}` : ''} onPick={(id) => { setModal(null); select(id); }} onClose={() => setModal(null)} />}
      {modal?.type === 'jobs' && <Modal title="All jobs" size="wide" onClose={() => setModal(null)}>{data.jobs.map((j) => <div key={j.id} className="list-item"><div className="grow"><b>{j.title}</b><div className="small muted">{j.vertical} · {j.department} · {j.location} · {j.openings} opening(s)</div></div><span className="small">{j.applicants} applicants</span><Badge>{j.status}</Badge></div>)}</Modal>}
    </div>
  );
}

function CandidateList({ title, query, onPick, onClose }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const { data } = useApi(`/candidates?${query}${dq ? `&search=${encodeURIComponent(dq)}` : ''}`);
  return (
    <Modal title={title} size="wide" onClose={onClose}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, skill, company, city" className="mb-12" />
      {!data ? <Loading /> : data.items.length ? (
        <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
          <table className="table compact"><thead><tr><th>Candidate</th><th>Job</th><th>Stage</th><th>Match</th><th>Source</th><th>Applied</th></tr></thead>
            <tbody>{data.items.map((c) => (
              <tr key={c.id} className="click" onClick={() => onPick(c.id)}>
                <td><Person name={c.name} sub={`${c.current_title || ''}${c.location ? ` · ${c.location}` : ''}`} link={false} size={30} /></td>
                <td className="small">{c.job_title}</td><td><Badge>{c.stage}</Badge></td><td className="b6">{c.ai_score != null ? `${c.ai_score}%` : '—'}</td><td className="small muted">{c.source}</td><td className="small muted nowrap">{fmtDate(c.applied_on)}</td>
              </tr>
            ))}</tbody></table>
        </div>
      ) : <Empty text="No candidates" />}
    </Modal>
  );
}

// ---------------------------------------------------------------- candidate panel
export function CandidatePanel({ id, onChanged }) {
  const { toast, isHR } = useApp();
  const nav = useNavigate();
  const { data, error, reload } = useApi(`/candidates/${id}`);
  const [tab, setTab] = useState('Overview');
  const [modal, setModal] = useState(null);
  const [run, busy] = useAction(toast);
  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const c = data.candidate;
  const refresh = () => { reload(); onChanged?.(); };
  const stageIdx = STAGES.indexOf(c.stage);
  const nextStage = stageIdx >= 0 && stageIdx < 5 ? STAGES[stageIdx + 1] : null;
  const move = async (stage, reason) => { if (await run(() => api.post(`/candidates/${c.id}/move`, { stage, reason }), `Moved to ${stage}`)) refresh(); };
  return (
    <div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Avatar name={c.name} size={56} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap gap-6"><b style={{ fontSize: 17 }}>{c.name}</b><Badge>{c.stage}</Badge></div>
          <div className="small muted">{c.job_title || c.current_title}</div>
          <div className="xs muted">Applied on {fmtDate(c.applied_on)} · {c.source}</div>
        </div>
      </div>
      <div className="col small mt-12" style={{ gap: 5, color: 'var(--text-2)' }}>
        {c.email && <span className="row gap-6"><Mail size={14} />{c.email}</span>}
        {c.phone && <span className="row gap-6"><Phone size={14} />{c.phone}</span>}
        {c.location && <span className="row gap-6"><MapPin size={14} />{c.location}</span>}
        {c.linkedin && <span className="row gap-6"><Link2 size={14} />{c.linkedin}</span>}
      </div>
      <div className="mt-12"><Tabs variant="pills" value={tab} onChange={setTab} tabs={['Overview', 'Interviews', 'Scorecard', 'Offer', 'Activity']} /></div>
      {tab === 'Overview' && (
        <div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[['Experience', c.experience != null ? `${c.experience} years` : '—'], ['Current Company', c.current_company || '—'], ['Expected CTC', c.expected_ctc ? lpa(c.expected_ctc) : '—'], ['Notice Period', c.notice_days != null ? `${c.notice_days} days` : '—']].map(([l, v]) => (
              <div key={l}><div className="xs muted">{l}</div><div className="small b6">{v}</div></div>
            ))}
          </div>
          {c.ai_score != null && (
            <div className="card tight" style={{ boxShadow: 'none' }}>
              <div className="row between small b6 mb-8"><span className="row gap-6"><Sparkles size={14} className="blue" />Skills Match</span><span>{c.ai_score}%</span></div>
              <Progress value={c.ai_score} color={c.ai_score >= 75 ? 'var(--green)' : c.ai_score >= 55 ? 'var(--amber)' : 'var(--red)'} />
              <div className="row wrap mt-12" style={{ gap: 6 }}>
                {(c.ai?.skills || []).map((s) => <span key={s.skill} className={`chip ${s.score > 0 ? 'green' : 'gray'}`}>{s.score > 0 ? '✓ ' : ''}{s.skill}</span>)}
              </div>
              {c.ai?.summary && <p className="small mt-12" style={{ color: 'var(--text-2)', lineHeight: 1.5 }}>{c.ai.summary}</p>}
            </div>
          )}
          {c.education && <div className="small mt-12"><span className="muted">Education:</span> {c.education}</div>}
          {c.reject_reason && c.stage === 'Rejected' && <div className="alert error mt-12">Rejected: {c.reject_reason}</div>}
          {c.has_resume && <Button size="sm" variant="ghost" icon={Download} className="mt-8" onClick={() => download(`/candidates/${c.id}/resume`)}>Resume</Button>}
        </div>
      )}
      {tab === 'Interviews' && <Interviews data={data} onChanged={refresh} onSchedule={() => setModal('schedule')} />}
      {tab === 'Scorecard' && (
        <div>
          <div className="row" style={{ gap: 10 }}><Star size={22} fill="#F2A600" color="#F2A600" /><b style={{ fontSize: 22 }}>{data.scorecard.average ?? '—'}</b><span className="muted small">/ 5 from {plural(data.scorecard.count, 'interview')}</span></div>
          {data.interviews.filter((i) => i.rating != null).map((i) => (
            <div key={i.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <div className="grow"><div className="b6 small">{i.round} · {i.interviewer || '—'}</div><div className="xs muted">{i.feedback}</div></div>
              <div className="right"><div className="b7 small">{i.rating}/5</div><Badge tone={i.recommendation === 'No Hire' ? 'red' : 'green'}>{i.recommendation}</Badge></div>
            </div>
          ))}
        </div>
      )}
      {tab === 'Offer' && <Offer c={c} canManage={isHR} onChanged={refresh} onHire={() => setModal('hire')} />}
      {tab === 'Activity' && (
        <div className="timeline">
          {data.activity.map((a) => <div key={a.id} className="tl-item done"><div className="c" style={{ width: 10, height: 10, marginTop: 5, marginLeft: 7 }} /><div><div className="small">{a.text}</div><div className="xs muted">{a.by_name} · {fmtDate(a.created_at)}</div></div></div>)}
        </div>
      )}
      {data.canManage && !['Rejected', 'Hired'].includes(c.stage) && (
        <div className="col mt-16" style={{ gap: 8 }}>
          <Button variant="primary" icon={CalendarPlus} onClick={() => setModal('schedule')}>Schedule Interview</Button>
          <div className="row" style={{ gap: 8 }}>
            {nextStage && <Button className="grow" icon={ArrowRight} loading={busy} onClick={() => (nextStage === 'Offer' ? setTab('Offer') : move(nextStage))}>Move to {nextStage}</Button>}
            <Button variant="danger" icon={X} onClick={() => setModal('reject')}>Reject</Button>
          </div>
        </div>
      )}
      {c.employee_id && <Button className="mt-12" icon={UserCheck} onClick={() => nav(`/employees/${c.employee_id}`)}>Open employee record</Button>}
      {modal === 'schedule' && <ScheduleModal c={c} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'reject' && <RejectModal onClose={() => setModal(null)} onReject={async (reason) => { await move('Rejected', reason); setModal(null); }} />}
      {modal === 'hire' && <HireModal c={c} onClose={() => setModal(null)} onDone={refresh} />}
    </div>
  );
}

function Interviews({ data, onChanged, onSchedule }) {
  const { user, isHR } = useApp();
  const [fb, setFb] = useState(null);
  return (
    <div>
      {data.interviews.length ? data.interviews.map((i) => (
        <div key={i.id} className="list-item" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="b6 small">{i.round} <Badge>{i.status}</Badge></div>
            <div className="xs muted">{fmtDate(i.scheduled_at.slice(0, 10))} {fmtTime(i.scheduled_at.slice(11))} · {i.mode} · {i.interviewer || 'No interviewer'}</div>
            {i.rating != null && <div className="xs mt-8"><b>{i.rating}/5</b> · {i.recommendation} · {i.feedback}</div>}
          </div>
          {i.status === 'Scheduled' && (isHR || i.interviewer_id === user.employeeId) && <Button size="xs" onClick={() => setFb(i)}>Add feedback</Button>}
        </div>
      )) : <Empty text="No interviews yet" />}
      {data.canManage && <Button size="sm" icon={Plus} className="mt-8" onClick={onSchedule}>Schedule</Button>}
      {fb && <FeedbackModal interview={fb} onClose={() => setFb(null)} onDone={onChanged} />}
    </div>
  );
}

function ScheduleModal({ c, onClose, onDone }) {
  const { toast, meta } = useApp();
  const next = ['Interview 1', 'Interview 2'].includes(c.stage) ? (c.stage === 'Interview 1' ? 'Interview 2' : 'HR Round') : 'Interview 1';
  const [f, setF] = useState({ round: next, date: meta.today, time: '11:00', mode: 'Virtual', interviewer_id: '' });
  const [run, busy] = useAction(toast);
  return (
    <Modal title={`Schedule interview · ${c.name}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/interviews', { candidate_id: c.id, round: f.round, scheduled_at: `${f.date}T${f.time}`, mode: f.mode, interviewer_id: f.interviewer_id || null }), 'Interview scheduled. Interviewer notified.')) { onDone(); onClose(); } }}>Schedule</Button></>}>
      <div className="form-grid">
        <Field label="Round"><Select value={f.round} onChange={(e) => setF({ ...f, round: e.target.value })} options={['Interview 1', 'Interview 2', 'HR Round']} /></Field>
        <Field label="Mode"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} options={['Virtual', 'In-person', 'Phone']} /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Time"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        <Field label="Interviewer" className="full"><EmployeeSelect value={f.interviewer_id} onChange={(e) => setF({ ...f, interviewer_id: Number(e.target.value) || '' })} placeholder="Select interviewer" /></Field>
      </div>
    </Modal>
  );
}

function FeedbackModal({ interview, onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState({ rating: 4, recommendation: 'Hire', feedback: '' });
  const [run, busy] = useAction(toast);
  const save = async (status) => {
    if (await run(() => api.put(`/interviews/${interview.id}`, status === 'Completed' ? { status, ...f } : { status }), status === 'Completed' ? 'Feedback saved' : `Marked ${status}`)) { onDone(); onClose(); }
  };
  return (
    <Modal title={`${interview.round} feedback`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={() => save('No-show')}>No-show</Button><Button variant="ghost" onClick={() => save('Cancelled')}>Cancel interview</Button><Button variant="primary" loading={busy} onClick={() => save('Completed')}>Submit feedback</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Rating">
          <div className="row" style={{ gap: 4 }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setF({ ...f, rating: n })} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 2 }} aria-label={`${n} stars`}><Star size={28} fill={n <= f.rating ? '#F2A600' : 'none'} color="#F2A600" /></button>)}</div>
        </Field>
        <Field label="Recommendation"><Select value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })} options={['Strong Hire', 'Hire', 'No Hire']} /></Field>
        <Field label="Feedback"><Textarea value={f.feedback} onChange={(e) => setF({ ...f, feedback: e.target.value })} placeholder="Strengths, gaps, culture fit" /></Field>
      </div>
    </Modal>
  );
}

function RejectModal({ onClose, onReject }) {
  const [reason, setReason] = useState('Skills mismatch');
  return (
    <Modal title="Reject candidate" size="narrow" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="solid-red" onClick={() => onReject(reason)}>Reject</Button></>}>
      <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)} options={['Skills mismatch', 'Salary expectations too high', 'Notice period too long', 'Did not clear interview', 'Candidate withdrew', 'Position filled']} /></Field>
    </Modal>
  );
}

function Offer({ c, canManage, onChanged, onHire }) {
  const { toast, meta } = useApp();
  const [f, setF] = useState({ offer_ctc: c.offer_ctc || c.expected_ctc || '', joining_date: c.joining_date || '' });
  const [run, busy] = useAction(toast);
  return (
    <div>
      {c.offer_status && (
        <div className="card tight mb-12" style={{ boxShadow: 'none' }}>
          <div className="row between"><b>{lpa(c.offer_ctc)}</b><Badge>{c.offer_status}</Badge></div>
          <div className="small muted">Offered {fmtDate(c.offer_date)}{c.joining_date ? ` · joining ${fmtDate(c.joining_date)}` : ''}</div>
          {canManage && c.offer_status === 'Sent' && <div className="row mt-12" style={{ gap: 8 }}>
            <Button size="sm" variant="success" loading={busy} onClick={async () => { if (await run(() => api.post(`/candidates/${c.id}/offer-status`, { status: 'Accepted' }), 'Offer accepted')) onChanged(); }}>Accepted</Button>
            <Button size="sm" variant="reject" loading={busy} onClick={async () => { if (await run(() => api.post(`/candidates/${c.id}/offer-status`, { status: 'Declined' }), 'Offer declined')) onChanged(); }}>Declined</Button>
          </div>}
          {canManage && (c.offer_status === 'Accepted' || c.stage === 'Hired') && !c.employee_id && <Button size="sm" variant="primary" icon={UserCheck} className="mt-12" onClick={onHire}>Convert to employee</Button>}
          {c.employee_id && <div className="row gap-6 small green mt-8"><CircleCheck size={16} />Employee record created</div>}
        </div>
      )}
      {canManage && !c.employee_id && c.offer_status !== 'Accepted' && (
        <div className="col" style={{ gap: 10 }}>
          <Field label="Offer CTC (LPA)"><Input type="number" step="0.1" value={f.offer_ctc} onChange={(e) => setF({ ...f, offer_ctc: e.target.value })} /></Field>
          <Field label="Joining date"><Input type="date" min={meta.today} value={f.joining_date} onChange={(e) => setF({ ...f, joining_date: e.target.value })} /></Field>
          <Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post(`/candidates/${c.id}/offer`, f), 'Offer recorded as sent')) onChanged(); }}>{c.offer_status ? 'Revise offer' : 'Send offer'}</Button>
        </div>
      )}
      {!canManage && !c.offer_status && <Empty text="No offer yet" />}
    </div>
  );
}

function HireModal({ c, onClose, onDone }) {
  const { toast, refreshMeta } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ join_date: c.joining_date || '', email: '', create_login: true });
  const [run, busy] = useAction(toast);
  const [temp, setTemp] = useState(null);
  if (temp) return <TempPasswordModal email={temp.email} password={temp.tempPassword} onClose={() => { onClose(); nav(`/employees/${temp.employeeId}`); }} note="Onboarding tasks were created on the employee record." />;
  return (
    <Modal title={`Convert ${c.name} to employee`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => {
        const out = await run(() => api.post(`/candidates/${c.id}/hire`, f), 'Employee record created');
        if (out) { onDone(); refreshMeta(); if (out.tempPassword) setTemp(out); else { onClose(); nav(`/employees/${out.employeeId}`); } }
      }}>Create employee</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="small muted">Creates the employee with the job's vertical, department, location and hiring manager, salary {lpa(c.offer_ctc || c.expected_ctc)}, and an onboarding checklist. Complete the rest of the profile afterwards.</div>
        <Field label="Joining date"><Input type="date" value={f.join_date} onChange={(e) => setF({ ...f, join_date: e.target.value })} /></Field>
        <Field label="Work email" hint="Leave blank to use firstname.lastname@brainadz.com"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={f.create_login} onChange={(e) => setF({ ...f, create_login: e.target.checked })} />Create HRMS login</label>
      </div>
    </Modal>
  );
}

export function JobForm({ job, onClose, onSaved }) {
  const { meta, toast } = useApp();
  const [f, setF] = useState(() => ({
    title: job?.title || '', vertical_id: job?.vertical_id || '', department_id: job?.department_id || '', location_id: job?.location_id || '',
    employment_type: job?.employment_type || 'Full-time', work_mode: job?.work_mode || 'Onsite', openings: job?.openings || 1,
    must_have: (job?.must_have || []).join(', '), nice_to_have: (job?.nice_to_have || []).join(', '), exp_min: job?.exp_min ?? '', exp_max: job?.exp_max ?? '',
    education: job?.education || '', salary_min: job?.salary_min ?? '', salary_max: job?.salary_max ?? '', knockout: (job?.knockout || []).join('\n'),
    hiring_manager_id: job?.hiring_manager_id || '', description: job?.description || '',
  }));
  const [run, busy] = useAction(toast);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { ...f, knockout: f.knockout.split('\n').map((s) => s.trim()).filter(Boolean) };
    if (await run(() => (job ? api.put(`/jobs/${job.id}`, body) : api.post('/jobs', body)), job ? 'Job updated' : 'Job created')) { onSaved?.(); onClose(); }
  };
  const opts = (l) => l.map((x) => ({ value: x.id, label: x.name }));
  return (
    <Modal title={job ? `Edit ${job.title}` : 'Create job requisition'} size="wide" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={job ? Pencil : Plus} loading={busy} onClick={save}>{job ? 'Save' : 'Create job'}</Button></>}>
      <div className="form-grid three">
        <Field label="Role title *" className="full"><Input value={f.title} onChange={set('title')} placeholder="e.g. Senior Frontend Developer" /></Field>
        <Field label="Vertical"><Select value={f.vertical_id} onChange={set('vertical_id')} placeholder="Select" options={opts(meta.verticals)} /></Field>
        <Field label="Department"><Select value={f.department_id} onChange={set('department_id')} placeholder="Select" options={opts(meta.departments)} /></Field>
        <Field label="Location"><Select value={f.location_id} onChange={set('location_id')} placeholder="Select" options={opts(meta.locations)} /></Field>
        <Field label="Employment type"><Select value={f.employment_type} onChange={set('employment_type')} options={['Full-time', 'Part-time', 'Contract', 'Intern']} /></Field>
        <Field label="Work mode"><Select value={f.work_mode} onChange={set('work_mode')} options={['Onsite', 'Hybrid', 'Remote']} /></Field>
        <Field label="Openings"><Input type="number" min="1" value={f.openings} onChange={set('openings')} /></Field>
        <Field label="Must-have skills" hint="Comma separated · used by the Resume Screener" className="full"><Input value={f.must_have} onChange={set('must_have')} placeholder="React, JavaScript, TypeScript" /></Field>
        <Field label="Preferred skills" className="full"><Input value={f.nice_to_have} onChange={set('nice_to_have')} /></Field>
        <Field label="Experience min (yrs)"><Input type="number" min="0" value={f.exp_min} onChange={set('exp_min')} /></Field>
        <Field label="Experience max (yrs)"><Input type="number" min="0" value={f.exp_max} onChange={set('exp_max')} /></Field>
        <Field label="Hiring manager"><EmployeeSelect value={f.hiring_manager_id} onChange={set('hiring_manager_id')} placeholder="Select" /></Field>
        <Field label="Salary min (LPA)"><Input type="number" step="0.5" value={f.salary_min} onChange={set('salary_min')} /></Field>
        <Field label="Salary max (LPA)"><Input type="number" step="0.5" value={f.salary_max} onChange={set('salary_max')} /></Field>
        <Field label="Preferred education"><Input value={f.education} onChange={set('education')} placeholder="B.Tech / B.E. in CS" /></Field>
        <Field label="Knockout questions" hint="One per line" className="full"><Textarea value={f.knockout} onChange={set('knockout')} /></Field>
        <Field label="Description" className="full"><Textarea value={f.description} onChange={set('description')} /></Field>
      </div>
    </Modal>
  );
}

