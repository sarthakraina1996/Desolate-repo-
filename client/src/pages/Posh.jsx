import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, GraduationCap, Scale, Lock, HandHeart, Bell, Pencil, CircleCheck, FileText, Users } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { fmtDate, fmtDateTime } from '../lib/format.js';
import { Card, Kpi, Badge, Button, Empty, Loading, ErrorBox, Person, Modal, Field, Input, Select, Textarea, EmployeeSelect } from '../components/ui.jsx';
import { Ring, STATUS } from '../components/charts.jsx';
import { PolicyModal } from './MySpace.jsx';

const TRAINING = [
  ['What is sexual harassment?', 'Any unwelcome act or behaviour, directly or by implication: physical contact or advances, a demand or request for sexual favours, sexually coloured remarks, showing pornography, or any other unwelcome physical, verbal or non-verbal conduct of a sexual nature.'],
  ['Where does the policy apply?', 'Everywhere you work for BrainADZ: offices, client sites, event venues, exhibition halls, travel, company parties, and online on email, chat and social media.'],
  ['How do I raise a concern?', 'Use “Raise a concern” on this page or write to any ICC member. You can stay anonymous. Complaints should be made within 3 months of the incident (extendable by 3 months).'],
  ['What happens next?', 'The ICC acknowledges the complaint, hears both sides and completes the inquiry within 90 days. Interim relief such as a change of reporting line is possible. Everything is kept confidential.'],
  ['What about retaliation?', 'Retaliating against anyone who raises a concern or helps an inquiry is misconduct and is acted on.'],
];

export default function Posh({ embedded }) {
  const { isHR, toast, user } = useApp();
  const [sp, setSp] = useSearchParams();
  const { data, error, reload } = useApi('/posh');
  const [modal, setModal] = useState(sp.get('raise') ? 'raise' : null);
  const [run, busy] = useAction(toast);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const s = data.stats;
  const close = () => { setModal(null); if (sp.get('raise')) setSp({}); };
  return (
    <div>
      {!embedded && <div className="page-head"><div><h1>POSH</h1><div className="sub">Prevention of Sexual Harassment: a safe, respectful workplace for everyone.</div></div>
        <Button variant="solid-red" icon={HandHeart} onClick={() => setModal('raise')}>Raise a concern</Button></div>}
      <div className="kpis">
        <Kpi icon={ShieldCheck} tone="green" label="POSH Policy Acknowledged" value={`${s.ackPct}%`} extra={<span className="delta"><small>{s.acked} / {s.headcount}</small></span>} />
        <Kpi icon={GraduationCap} tone="amber" label="Training Completed" value={`${s.trainedPct}%`} extra={<span className="delta"><small>{s.trained} / {s.headcount}</small></span>} />
        <Kpi icon={Users} tone="blue" label="ICC Members" value={data.icc.members.length + (data.icc.externalMember ? 1 : 0)} />
        {data.canSeeCases ? <Kpi icon={Scale} tone="red" label="Open Cases" value={data.caseStats.open} extra={<span className="delta"><small>{data.caseStats.thisYear} this year</small></span>} />
          : <Kpi icon={Lock} tone="purple" label="My Concerns" value={data.mine.length} />}
      </div>
      <div className="grid">
        <Card className="span-4" title="Internal Committee (ICC)" action={isHR && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setModal('icc')}>Edit</Button>}>
          {data.icc.members.map((m) => <div key={m.id} className="list-item"><Person name={m.name} sub={m.designation} id={m.id} hasPhoto={m.has_photo} size={34} /><span className="grow" /><Badge tone={m.role === 'Presiding Officer' ? 'purple' : 'blue'}>{m.role}</Badge></div>)}
          {data.icc.externalMember && <div className="list-item"><Users size={20} className="muted" /><span className="grow small">{data.icc.externalMember}</span><Badge tone="gray">External</Badge></div>}
          <div className="xs muted mt-8">At least half the members are women; the external member is from an NGO or has legal expertise.</div>
        </Card>
        <Card className="span-4" title="Compliance">
          <div className="row" style={{ justifyContent: 'space-around' }}>
            <Ring value={s.ackPct} color={STATUS.good} label="Policy Acknowledged" sub={`${s.acked} / ${s.headcount}`} />
            <Ring value={s.trainedPct} color={s.trainedPct >= 90 ? STATUS.good : STATUS.warn} label="Training Completed" sub={`${s.trained} / ${s.headcount}`} />
          </div>
          {isHR && <div className="row mt-16" style={{ gap: 8, justifyContent: 'center' }}>
            <Button size="sm" icon={Bell} loading={busy} onClick={() => run(() => api.post('/posh/remind-training'), (r) => `Reminder sent to ${r.sent} people`)}>Remind untrained</Button>
            {data.untrained.length > 0 && <Button size="sm" onClick={() => setModal('untrained')}>View {data.untrained.length} pending</Button>}
          </div>}
        </Card>
        <div className="span-4 card" style={{ background: 'linear-gradient(160deg, #fff 0%, #fde9ef 100%)' }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <HandHeart size={40} className="red" style={{ flexShrink: 0 }} />
            <div><h3 className="red" style={{ fontSize: 16 }}>Confidential support</h3><p className="small mt-8" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>If you have faced or witnessed harassment, tell the ICC. You can stay anonymous. Only ICC members can read complaints.</p></div>
          </div>
          <Button variant="solid-red" className="block mt-16" onClick={() => setModal('raise')}>Report / Seek Support</Button>
          {data.mine.length > 0 && <div className="mt-12">{data.mine.map((m) => <div key={m.id} className="row between small mb-8"><span>{m.ref_no} · {fmtDate(m.created_at)}</span><Badge>{m.status}</Badge></div>)}</div>}
        </div>
      </div>
      <div className="grid">
        <Card className="span-6" title="POSH awareness training" action={data.policyId && <Button size="sm" variant="ghost" icon={FileText} onClick={() => setModal('policy')}>Read policy</Button>}>
          {TRAINING.map(([q, a], i) => <div key={q} className="mb-12"><div className="b6 small">{i + 1}. {q}</div><div className="small" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>{a}</div></div>)}
          {user.employeeId && (data.myTraining
            ? <div className="row gap-6 green b6"><CircleCheck size={18} />Completed on {fmtDate(data.myTraining)}</div>
            : <Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/posh/training', {}), 'Training recorded. Thank you!')) reload(); }}>I have completed this training</Button>)}
        </Card>
        {data.canSeeCases ? (
          <Card className="span-6" title="Cases (ICC only)" action={<Badge tone="purple"><Lock size={12} />Confidential</Badge>}>
            {data.complaints.length ? data.complaints.map((c) => (
              <div key={c.id} className="list-item" style={{ alignItems: 'flex-start', cursor: 'pointer' }} onClick={() => setModal({ case: c })}>
                <Scale size={18} className="muted" style={{ marginTop: 2 }} />
                <div className="grow"><div className="b6 small">{c.ref_no} · {c.complainant}</div><div className="xs muted">Respondent: {c.respondent || '—'} · received {fmtDate(c.created_at)} · inquiry due {fmtDate(c.due_date)}</div></div>
                <Badge>{c.status}</Badge>
              </div>
            )) : <Empty text="No complaints" />}
          </Card>
        ) : (
          <Card className="span-6" title="Your rights">
            <ul className="small" style={{ lineHeight: 1.8, color: 'var(--text-2)', paddingLeft: 18 }}>
              <li>Your complaint is confidential and only seen by the ICC.</li>
              <li>You can complain anonymously, or a colleague can complain on your behalf.</li>
              <li>The inquiry finishes within 90 days and you will be told the outcome.</li>
              <li>You are protected from retaliation.</li>
            </ul>
          </Card>
        )}
      </div>
      {modal === 'raise' && <RaiseModal onClose={close} onDone={reload} />}
      {modal === 'icc' && <IccModal icc={data.icc} onClose={close} onDone={reload} />}
      {modal === 'policy' && <PolicyModal id={data.policyId} onClose={close} onDone={reload} />}
      {modal === 'untrained' && <Modal title="Training not completed" onClose={close}>{data.untrained.map((e) => <div key={e.id} className="list-item"><Person name={e.name} sub={`${e.code} · ${e.department || ''}`} id={e.id} size={30} /><span className="grow" /><Button size="xs" onClick={async () => { await run(() => api.post('/posh/training', { employee_id: e.id }), `Marked ${e.name} as trained`); reload(); }}>Mark trained</Button></div>)}</Modal>}
      {modal?.case && <CaseModal c={modal.case} onClose={close} onDone={reload} />}
    </div>
  );
}

function RaiseModal({ onClose, onDone }) {
  const { toast } = useApp();
  const [f, setF] = useState({ anonymous: false, respondent: '', incident_date: '', place: '', description: '' });
  const [run, busy] = useAction(toast);
  const [ref, setRef] = useState(null);
  if (ref) return <Modal title="Concern received" size="narrow" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Close</Button>}><div className="col" style={{ gap: 10 }}><CircleCheck size={36} className="green" /><p>Your reference number is <b>{ref}</b>. The ICC has been notified and will act within the timelines in the POSH policy.</p>{f.anonymous && <p className="small muted">You chose to stay anonymous, so updates are not sent to you. Keep the reference number.</p>}</div></Modal>;
  return (
    <Modal title="Raise a POSH concern" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="solid-red" loading={busy} onClick={async () => { const out = await run(() => api.post('/posh/complaints', f)); if (out) { setRef(out.ref); onDone(); } }}>Submit confidentially</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="alert info"><Lock size={16} />Only ICC members can see this. Nothing is shared with your manager.</div>
        <label className="check"><input type="checkbox" checked={f.anonymous} onChange={(e) => setF({ ...f, anonymous: e.target.checked })} />Submit anonymously</label>
        <div className="form-grid">
          <Field label="Person(s) involved (optional)"><Input value={f.respondent} onChange={(e) => setF({ ...f, respondent: e.target.value })} /></Field>
          <Field label="Date of incident"><Input type="date" value={f.incident_date} onChange={(e) => setF({ ...f, incident_date: e.target.value })} /></Field>
          <Field label="Where did it happen?" className="full"><Input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="Office, client site, event, online…" /></Field>
          <Field label="What happened? *" className="full"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} style={{ minHeight: 130 }} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function CaseModal({ c, onClose, onDone }) {
  const { toast } = useApp();
  const [status, setStatus] = useState(c.status);
  const [note, setNote] = useState('');
  const [run, busy] = useAction(toast);
  return (
    <Modal title={`${c.ref_no} · ${c.complainant}`} size="wide" onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.put(`/posh/complaints/${c.id}`, { status, note }), 'Case updated')) { onDone(); onClose(); } }}>Save update</Button></>}>
      <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr', gap: 18, marginBottom: 0 }}>
        <div>
          <dl className="kv"><dt>Respondent</dt><dd>{c.respondent || '—'}</dd><dt>Incident</dt><dd>{fmtDate(c.incident_date)} · {c.place || '—'}</dd><dt>Inquiry due</dt><dd>{fmtDate(c.due_date)}</dd></dl>
          <p className="mt-12" style={{ lineHeight: 1.6 }}>{c.description}</p>
          <div className="form-grid mt-16">
            <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={['Received', 'Under Inquiry', 'Resolved', 'Closed']} /></Field>
            <Field label="Add to case log" className="full"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hearing held, interim relief, findings…" /></Field>
          </div>
        </div>
        <div>
          <b className="small">Case log</b>
          <div className="timeline mt-12">{c.updates.map((u, i) => <div key={i} className="tl-item done"><div className="c" style={{ width: 10, height: 10, marginTop: 5, marginLeft: 7 }} /><div><div className="small">{u.text}</div><div className="xs muted">{fmtDateTime(u.at)}</div></div></div>)}</div>
        </div>
      </div>
    </Modal>
  );
}

function IccModal({ icc, onClose, onDone }) {
  const { toast } = useApp();
  const presiding = icc.members.find((m) => m.role === 'Presiding Officer');
  const [f, setF] = useState({ presidingOfficerId: presiding?.id || '', memberIds: icc.members.filter((m) => m.role === 'Member').map((m) => m.id), externalMember: icc.externalMember });
  const [add, setAdd] = useState('');
  const [run, busy] = useAction(toast);
  const { employeeName } = useApp();
  return (
    <Modal title="Internal Committee members" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.put('/posh/icc', f), 'ICC updated')) { onDone(); onClose(); } }}>Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="Presiding officer (a senior woman employee)"><EmployeeSelect value={f.presidingOfficerId} onChange={(e) => setF({ ...f, presidingOfficerId: Number(e.target.value) || '' })} /></Field>
        <Field label="Members">
          {f.memberIds.map((m) => <div key={m} className="row between small mb-8"><span>{employeeName(m)}</span><button type="button" className="link" onClick={() => setF({ ...f, memberIds: f.memberIds.filter((x) => x !== m) })}>Remove</button></div>)}
          <div className="row" style={{ gap: 8 }}><EmployeeSelect value={add} onChange={(e) => setAdd(Number(e.target.value) || '')} placeholder="Add member" exclude={[...f.memberIds, f.presidingOfficerId]} /><Button size="sm" disabled={!add} onClick={() => { setF({ ...f, memberIds: [...f.memberIds, add] }); setAdd(''); }}>Add</Button></div>
        </Field>
        <Field label="External member"><Input value={f.externalMember} onChange={(e) => setF({ ...f, externalMember: e.target.value })} placeholder="Name and organisation" /></Field>
      </div>
    </Modal>
  );
}
