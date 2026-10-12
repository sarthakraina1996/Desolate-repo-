import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserMinus, CircleCheck, Clock, CalendarClock, Printer, Check, CircleDot, Circle, UserCheck, FileText, Undo2, Send } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { fmtDate, fmtDateTime, inr } from '../lib/format.js';
import { Card, Kpi, Badge, Button, Empty, Loading, ErrorBox, Person, Avatar, Modal, Field, Input, Select, Textarea, Toggle, useConfirm } from '../components/ui.jsx';
import { Donut, Legend, Bars, LineChart, Steps, CAT } from '../components/charts.jsx';
import { BrandBanner } from '../components/Layout.jsx';

export default function Resignation() {
  const { isHR, isManager } = useApp();
  return isHR || isManager ? <Manage /> : <Mine />;
}

function Manage() {
  const { isHR } = useApp();
  const [sp, setSp] = useSearchParams();
  const { data, error, reload } = useApi('/resignations');
  const [filter, setFilter] = useState('');
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const k = data.kpis;
  const items = data.items.filter((r) => !filter || r.status === filter);
  const selected = Number(sp.get('id')) || (data.items.find((r) => ['Pending', 'Approved', 'In Progress'].includes(r.status)) || data.items[0])?.id;
  return (
    <div>
      <div className="page-head">
        <div><h1>Resignation Management</h1><div className="sub">Handle resignations and ensure a smooth offboarding experience.</div></div>
        <BrandBanner />
      </div>
      <div className="kpis">
        <Kpi icon={UserMinus} tone="red" label="Total Resignation Requests" value={k.total} delta={k.totalChange} invert />
        <Kpi icon={CircleCheck} tone="green" label="Approved Resignations" value={k.approved} />
        <Kpi icon={Clock} tone="amber" label="Pending Approvals" value={k.pending} onClick={() => setFilter(filter === 'Pending' ? '' : 'Pending')} />
        <Kpi icon={CalendarClock} tone="blue" label="Avg. Notice Period" value={k.avgNotice} unit="Days" />
      </div>
      <div className="grid" style={{ alignItems: 'start' }}>
        <Card className="span-6" title="Recent Resignation Requests" action={<select className="select sm" style={{ width: 150 }} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All statuses</option>{['Pending', 'Approved', 'In Progress', 'Completed', 'Rejected', 'Withdrawn'].map((s) => <option key={s}>{s}</option>)}</select>}>
          {items.length ? (
            <div className="table-wrap" style={{ maxHeight: 440, overflowY: 'auto' }}>
              <table className="table compact">
                <thead><tr><th>Employee</th><th className="hide-sm">Submitted</th><th>Notice</th><th>Last Working Day</th><th>Status</th></tr></thead>
                <tbody>{items.map((r) => (
                  <tr key={r.id} className={`click ${r.id === selected ? 'sel' : ''}`} onClick={() => setSp({ id: r.id })}>
                    <td><Person name={r.name} sub={r.department} id={r.employee_id} hasPhoto={r.has_photo} size={30} link={false} /></td>
                    <td className="hide-sm small nowrap">{fmtDate(r.submitted_on)}</td>
                    <td className="small">{r.notice_days} days</td>
                    <td className="small nowrap">{fmtDate(r.last_working_day)}</td>
                    <td><Badge>{r.status}</Badge></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty text="No resignations" />}
        </Card>
        <div className="span-6">{selected ? <Detail key={selected} id={selected} onChanged={reload} labels={data} isHR={isHR} /> : <Card><Empty text="Select a resignation" /></Card>}</div>
      </div>
      <div className="grid">
        <Card className="span-4" title="Reasons for Resignation" sub=" (This Year)">
          {data.reasons.length ? (
            <div className="row donut-row" style={{ gap: 18 }}>
              <Donut size={150} thickness={22} data={data.reasons.slice(0, 5).map((r, i) => ({ ...r, color: CAT[i] }))} center={{ value: k.total, label: 'Resignations' }} />
              <Legend items={data.reasons.slice(0, 5).map((r, i) => ({ ...r, color: CAT[i] }))} />
            </div>
          ) : <Empty text="No resignations this year" />}
        </Card>
        <Card className="span-4" title="Resignations per Month">
          <Bars height={170} categories={data.trend.map((t) => t.label)} series={[{ name: 'Resignations', color: '#1A6DF0', values: data.trend.map((t) => t.resignations) }]} />
        </Card>
        <Card className="span-4" title="Monthly Attrition Rate">
          <LineChart height={170} categories={data.trend.map((t) => t.label)} series={[{ name: 'Attrition rate', color: '#E5243B', values: data.trend.map((t) => t.rate) }]} format={(v) => `${Math.round(v * 10) / 10}%`} />
          <div className="xs muted mt-8">Exits in the month ÷ average headcount.</div>
        </Card>
      </div>
    </div>
  );
}

const ICON = { Completed: <Check size={13} strokeWidth={3} />, 'In Progress': <CircleDot size={13} />, Pending: <Circle size={13} /> };

function Detail({ id, onChanged, labels, isHR }) {
  const { toast } = useApp();
  const { data, error, reload } = useApi(`/resignations/${id}`);
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const [modal, setModal] = useState(null);
  if (error && !data) return <Card><ErrorBox error={error} /></Card>;
  if (!data) return <Card><Loading /></Card>;
  const r = data;
  const act = async (fn, msg) => { if (await run(fn, msg)) { reload(); onChanged(); } };
  const steps = r.steps;
  const offboardingDone = ['knowledge_transfer', 'handover', 'asset_return', 'access_revocation'].every((k) => r.checklist[k]?.status === 'Completed');
  const flow = [
    { label: 'Resignation Submitted', at: steps.submitted, done: true },
    { label: 'Manager Approval', at: steps.manager, done: Boolean(steps.manager) && r.status !== 'Rejected' },
    { label: 'HR Review', at: steps.hr, done: Boolean(steps.hr) && r.status !== 'Rejected' },
    { label: 'Offboarding Checklist', at: steps.checklist, done: offboardingDone, hint: 'Complete all clearance items' },
    { label: 'Exit Interview', at: steps.exit_interview, done: Boolean(r.exit_interview), hint: 'Schedule and complete interview' },
    { label: 'Final Settlement', at: steps.settlement, done: r.checklist.fnf?.status === 'Completed', hint: 'Process full & final settlement' },
  ];
  const firstOpen = flow.findIndex((f) => !f.done);
  const terminal = ['Rejected', 'Withdrawn'].includes(r.status);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Card title={<span className="row gap-6"><Avatar name={r.name} id={r.employee_id} hasPhoto={r.has_photo} size={30} />{r.name}<Badge>{r.status}</Badge></span>}
        action={<span className="small muted">{r.designation} · {r.department}</span>}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 0 }}>
          <div>
            <b className="small">Resignation & Offboarding Workflow</b>
            <div className="timeline mt-12">
              {flow.map((f, i) => (
                <div key={f.label} className={`tl-item ${f.done ? 'done' : !terminal && i === firstOpen ? 'current' : ''}`}>
                  <div className="c">{f.done ? <Check size={13} strokeWidth={3} /> : null}</div>
                  <div className="grow"><div className="small b6">{f.label}</div><div className="xs muted">{f.done && f.at ? fmtDateTime(f.at) : f.hint || (terminal && i === 1 ? r.status : 'Pending')}</div></div>
                  <Badge tone={f.done ? 'green' : !terminal && i === firstOpen ? 'blue' : 'gray'}>{f.done ? (i === 1 ? 'Approved' : 'Completed') : !terminal && i === firstOpen ? 'In Progress' : 'Pending'}</Badge>
                </div>
              ))}
            </div>
            <div className="small mt-8"><span className="muted">Reason:</span> <b>{r.reason_category}</b>{r.reason ? ` · ${r.reason}` : ''}</div>
            {r.decision_note && <div className="small muted mt-8">Note: {r.decision_note}</div>}
          </div>
          <div>
            <b className="small">Offboarding Checklist</b>
            <div className="mt-8">
              {labels.checklistLabels.map(([key, label]) => {
                const item = r.checklist[key] || { status: 'Pending' };
                const editable = r.status === 'In Progress' && (isHR || (data.canManagerAct && ['knowledge_transfer', 'handover'].includes(key))) && !['manager_approval', 'hr_review'].includes(key);
                return (
                  <div key={key} className="list-item" style={{ padding: '6px 0' }}>
                    <span className={item.status === 'Completed' ? 'green' : item.status === 'In Progress' ? 'blue' : 'faint'}>{ICON[item.status]}</span>
                    <span className="grow small">{label}</span>
                    {editable ? (
                      <select className="select sm" style={{ width: 122, height: 28, fontSize: 12 }} value={item.status} onChange={(e) => act(() => api.put(`/resignations/${r.id}/checklist`, { key, status: e.target.value }))} aria-label={label}>
                        <option>Pending</option><option>In Progress</option><option>Completed</option>
                      </select>
                    ) : <Badge tone={item.status === 'Completed' ? 'green' : item.status === 'In Progress' ? 'blue' : 'red'}>{item.status}</Badge>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="row wrap mt-16" style={{ gap: 8 }}>
          {r.status === 'Pending' && data.canManagerAct && <><Button variant="success" loading={busy} onClick={() => act(() => api.post(`/resignations/${r.id}/manager-decision`, { action: 'approve' }), 'Approved as manager')}>Approve (Manager)</Button><Button variant="reject" onClick={() => setModal('mreject')}>Not accepted</Button></>}
          {isHR && ['Pending', 'Approved'].includes(r.status) && <Button variant="primary" icon={UserCheck} onClick={() => setModal('hr')}>HR Review & Accept</Button>}
          {isHR && r.status === 'In Progress' && <Button icon={FileText} onClick={() => setModal('exit')}>{r.exit_interview ? 'Edit exit interview' : 'Exit interview'}</Button>}
          {isHR && r.status === 'In Progress' && <Button icon={FileText} onClick={() => setModal('fnf')}>{r.settlement ? 'Edit settlement' : 'Full & final'}</Button>}
          {isHR && r.status === 'In Progress' && <Button variant="primary" icon={CircleCheck} loading={busy} onClick={async () => { if (await confirm({ title: 'Complete offboarding?', text: `${r.name} will be marked as exited and their login deactivated.`, confirmLabel: 'Complete' })) act(() => api.post(`/resignations/${r.id}/complete`), 'Offboarding completed'); }}>Complete exit</Button>}
          {isHR && ['Pending', 'Approved', 'In Progress'].includes(r.status) && <Button variant="ghost" icon={Undo2} onClick={async () => { if (await confirm({ title: 'Withdraw resignation?', text: 'The employee stays on and returns to Active.', confirmLabel: 'Withdraw' })) act(() => api.post(`/resignations/${r.id}/withdraw`), 'Resignation withdrawn'); }}>Withdraw</Button>}
        </div>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 0 }}>
        <Card title="Clearance Matrix">
          <table className="table compact">
            <thead><tr><th>Department</th><th>Status</th><th>Approved By</th></tr></thead>
            <tbody>{labels.clearanceLabels.map(([key, label]) => {
              const c = r.clearance[key] || { status: 'Pending' };
              return (
                <tr key={key}>
                  <td className="small">{label}</td>
                  <td>{c.status === 'Approved' ? <CircleCheck size={18} className="green" /> : isHR && r.status === 'In Progress' ? <Button size="xs" onClick={() => act(() => api.put(`/resignations/${r.id}/clearance`, { key, status: 'Approved' }), `${label} cleared`)}>Approve</Button> : <Clock size={18} className="amber" />}</td>
                  <td className="small">{c.by || 'Pending'}<div className="xs muted">{c.at ? fmtDate(c.at) : ''}</div></td>
                </tr>
              );
            })}</tbody>
          </table>
        </Card>
        <Card title="Rehire & Documentation">
          <div className="list-item"><UserCheck size={18} className="blue" /><span className="grow small">Rehire Eligibility</span>
            {isHR ? <Toggle on={Boolean(r.rehire_eligible)} label="Rehire eligible" onChange={(v) => act(() => api.put(`/resignations/${r.id}/rehire`, { rehire_eligible: v }))} /> : <Badge>{r.rehire_eligible ? 'Eligible' : 'Pending'}</Badge>}
          </div>
          {[['experience', 'Experience Letter'], ['relieving', 'Relieving Letter']].map(([k, l]) => (
            <div key={k} className="list-item"><FileText size={18} className="blue" /><span className="grow small">{l}</span>
              {r.letters[k] ? <Badge tone="green">Issued</Badge> : <Badge tone="amber">Pending</Badge>}
              <a className="btn xs" href={`/print/${k}/${r.id}`} target="_blank" rel="noreferrer" onClick={() => isHR && !r.letters[k] && api.put(`/resignations/${r.id}/rehire`, { [k]: true }).then(reload)}><Printer size={13} />{r.letters[k] ? 'View' : 'Issue'}</a>
            </div>
          ))}
          {r.settlement && <div className="small mt-12"><span className="muted">F&F settlement:</span> <b>{inr(r.settlement.amount)}</b> {r.settlement.paidOn ? `paid ${fmtDate(r.settlement.paidOn)}` : '(not paid yet)'}</div>}
          {r.exit_interview && <div className="small mt-8"><span className="muted">Exit interview:</span> {r.exit_interview.rating}/5 · {r.exit_interview.joinAgain ? 'would rejoin' : 'would not rejoin'}{r.exit_interview.feedback ? ` · “${r.exit_interview.feedback}”` : ''}</div>}
        </Card>
      </div>

      <Card title="Employee Offboarding Progress" action={<Badge tone={r.status === 'Completed' ? 'green' : 'blue'} lg>{r.status}</Badge>}>
        <div className="row between small mb-12"><span>Notice Period: <b>{r.notice_days} days</b> &nbsp;|&nbsp; Last Working Day: <b>{fmtDate(r.last_working_day)}</b></span><span className="muted">{r.progress.done} of {r.progress.total} completed</span></div>
        <Steps steps={labels.checklistLabels.map(([key, label]) => ({ label, state: r.checklist[key]?.status === 'Completed' ? 'done' : r.checklist[key]?.status === 'In Progress' ? 'current' : 'todo' }))} />
      </Card>

      {modal === 'hr' && <HrModal r={r} onClose={() => setModal(null)} onDone={() => { reload(); onChanged(); }} />}
      {modal === 'mreject' && <NoteModal title="Not accepting this resignation" onClose={() => setModal(null)} onSubmit={(note) => act(() => api.post(`/resignations/${r.id}/manager-decision`, { action: 'reject', note }), 'Recorded')} />}
      {modal === 'exit' && <ExitInterview r={r} onClose={() => setModal(null)} onDone={() => { reload(); onChanged(); }} />}
      {modal === 'fnf' && <Settlement r={r} onClose={() => setModal(null)} onDone={() => { reload(); onChanged(); }} />}
      {confirmEl}
    </div>
  );
}

function HrModal({ r, onClose, onDone }) {
  const { toast } = useApp();
  const [lwd, setLwd] = useState(r.last_working_day);
  const [note, setNote] = useState('');
  const [run, busy] = useAction(toast);
  const go = async (action) => { if (await run(() => api.post(`/resignations/${r.id}/hr-review`, { action, last_working_day: lwd, note }), action === 'approve' ? 'Resignation accepted. Offboarding started.' : 'Resignation not accepted')) { onDone(); onClose(); } };
  return (
    <Modal title={`HR review · ${r.name}`} onClose={onClose} footer={<><Button variant="reject" loading={busy} onClick={() => go('reject')}>Not accepted</Button><Button variant="primary" loading={busy} onClick={() => go('approve')}>Accept & start offboarding</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="small muted">Submitted {fmtDate(r.submitted_on)} · notice period {r.notice_days} days · reason: {r.reason_category}</div>
        <Field label="Confirmed last working day" hint="The employee moves to 'Serving notice' until this date."><Input type="date" value={lwd} onChange={(e) => setLwd(e.target.value)} /></Field>
        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function NoteModal({ title, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  return (
    <Modal title={title} size="narrow" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="solid-red" onClick={async () => { await onSubmit(note); onClose(); }}>Save</Button></>}>
      <Field label="Note to the employee"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Discussed role change and revised compensation" /></Field>
    </Modal>
  );
}

function ExitInterview({ r, onClose, onDone }) {
  const { toast } = useApp();
  const x = r.exit_interview || {};
  const [f, setF] = useState({ rating: x.rating || 4, joinAgain: x.joinAgain ?? true, liked: x.liked || '', improve: x.improve || '', feedback: x.feedback || '' });
  const [run, busy] = useAction(toast);
  return (
    <Modal title={`Exit interview · ${r.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post(`/resignations/${r.id}/exit-interview`, f), 'Exit interview saved')) { onDone(); onClose(); } }}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Overall experience (1-5)"><Select value={f.rating} onChange={(e) => setF({ ...f, rating: Number(e.target.value) })} options={[5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${n}` }))} /></Field>
        <Field label="Would join again?"><Select value={f.joinAgain ? 'yes' : 'no'} onChange={(e) => setF({ ...f, joinAgain: e.target.value === 'yes' })} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} /></Field>
        <Field label="What did they like?" className="full"><Textarea value={f.liked} onChange={(e) => setF({ ...f, liked: e.target.value })} /></Field>
        <Field label="What should we improve?" className="full"><Textarea value={f.improve} onChange={(e) => setF({ ...f, improve: e.target.value })} /></Field>
        <Field label="Other feedback" className="full"><Textarea value={f.feedback} onChange={(e) => setF({ ...f, feedback: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Settlement({ r, onClose, onDone }) {
  const { toast } = useApp();
  const s = r.settlement || {};
  const [f, setF] = useState({ amount: s.amount ?? '', paid_on: s.paidOn || '', notes: s.notes || '' });
  const [run, busy] = useAction(toast);
  return (
    <Modal title={`Full & final settlement · ${r.name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post(`/resignations/${r.id}/settlement`, f), 'Settlement saved')) { onDone(); onClose(); } }}>Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Net settlement amount (₹)" hint="Pro-rata salary + leave encashment + gratuity (if 5+ years) − recoveries"><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Paid on" hint="Leave blank until paid; setting it completes the F&F checklist item"><Input type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- employee view
function Mine() {
  const { toast, meta } = useApp();
  const { data, reload } = useApi('/resignations');
  const [f, setF] = useState({ reason_category: 'Better Opportunities', reason: '', last_working_day: '' });
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  if (!data) return <Loading />;
  const mine = data.mine;
  return (
    <div>
      <div className="page-head"><div><h1>Resignation</h1><div className="sub">Submit your resignation and track your offboarding.</div></div></div>
      {mine ? (
        <div className="grid">
          <Card className="span-7" title="Your resignation" action={<Badge lg>{mine.status}</Badge>}>
            <dl className="kv">
              <dt>Submitted</dt><dd>{fmtDate(mine.submitted_on)}</dd>
              <dt>Reason</dt><dd>{mine.reason_category}{mine.reason ? ` · ${mine.reason}` : ''}</dd>
              <dt>Notice period</dt><dd>{mine.notice_days} days</dd>
              <dt>Last working day</dt><dd>{fmtDate(mine.last_working_day)}</dd>
            </dl>
            <div className="mt-16"><Steps steps={data.checklistLabels.map(([key, label]) => ({ label, state: mine.checklist[key]?.status === 'Completed' ? 'done' : mine.checklist[key]?.status === 'In Progress' ? 'current' : 'todo' }))} /></div>
            {['Pending', 'Approved'].includes(mine.status) && <Button className="mt-16" icon={Undo2} loading={busy} onClick={async () => { if (await confirm({ title: 'Withdraw your resignation?', text: 'Your manager and HR will be notified.', confirmLabel: 'Withdraw' })) { if (await run(() => api.post(`/resignations/${mine.id}/withdraw`), 'Resignation withdrawn')) reload(); } }}>Withdraw resignation</Button>}
          </Card>
          <Card className="span-5" title="What happens next">
            <ol className="small" style={{ lineHeight: 1.8, paddingLeft: 18, color: 'var(--text-2)' }}>
              <li>Your manager reviews the resignation.</li>
              <li>HR confirms your last working day.</li>
              <li>You complete knowledge transfer and handover.</li>
              <li>Return your laptop, ID card and other assets.</li>
              <li>HR conducts a short exit interview.</li>
              <li>Full & final settlement is paid, with your experience and relieving letters.</li>
            </ol>
          </Card>
        </div>
      ) : (
        <Card title="Submit resignation" style={{ maxWidth: 640 }}>
          <div className="alert info mb-16">Talk to your manager first if you can. Your notice period is {meta.settings.noticePeriodDays} days ({meta.settings.noticePeriodSeniorDays} for managers and above).</div>
          <div className="col" style={{ gap: 14 }}>
            <Field label="Primary reason"><Select value={f.reason_category} onChange={(e) => setF({ ...f, reason_category: e.target.value })} options={data.reasonOptions} /></Field>
            <Field label="Details (optional)"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <Field label="Requested last working day (optional)" hint="Leave blank to serve the full notice period"><Input type="date" min={meta.today} value={f.last_working_day} onChange={(e) => setF({ ...f, last_working_day: e.target.value })} /></Field>
            <Button variant="solid-red" icon={Send} loading={busy} onClick={async () => { if (await confirm({ title: 'Submit resignation?', text: 'Your manager and HR will be notified.', danger: true, confirmLabel: 'Submit' })) { if (await run(() => api.post('/resignations', f), 'Resignation submitted')) reload(); } }}>Submit resignation</Button>
          </div>
        </Card>
      )}
      {confirmEl}
    </div>
  );
}

