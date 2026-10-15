import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Sparkles, Pencil, Briefcase, Settings2, ChartColumn, GraduationCap, MapPin, IndianRupee, FileText, CloudUpload, Search, Users, GitCompare, Ellipsis,
  Star, Send, Clock, CircleX, Mail, Phone, Link2, X, CircleCheck, CircleAlert, Building2, Wallet, CalendarClock, Bot, LoaderCircle, RefreshCw, Download, UserPlus,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { lpa, fmtDate } from '../lib/format.js';
import { Card, Badge, Button, Empty, Loading, ErrorBox, Avatar, Modal, Tabs, Menu, Input } from '../components/ui.jsx';
import { BrandBanner } from '../components/Layout.jsx';
import { JobForm } from './Hiring.jsx';

const scoreColor = (s) => (s >= 75 ? '#1FA855' : s >= 55 ? '#F2A600' : '#E5243B');

function MatchRing({ score, size = 64 }) {
  if (score == null) return <div className="center small muted" style={{ width: size }}>—</div>;
  const r = (size - 7) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(score)} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} /></svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }}>
        <b style={{ fontSize: size > 60 ? 16 : 13 }}>{score}%</b><span style={{ fontSize: 9, color: 'var(--muted)' }}>Match</span>
      </div>
    </div>
  );
}

export default function Screener() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const jobParam = sp.get('job');
  const { data, error, reload } = useApi(`/screener${jobParam ? `?job=${jobParam}` : ''}`);
  const [sel, setSel] = useState(null);
  const [checked, setChecked] = useState([]);
  const [f, setF] = useState({ q: '', stage: '', exp: '', loc: '', sort: 'match' });
  const [modal, setModal] = useState(null);
  const [run, busy] = useAction(toast);
  const fileRef = useRef(null);
  const processing = data?.totals?.processing || 0;
  useEffect(() => {
    if (!processing) return undefined;
    const t = setInterval(reload, 2500);
    return () => clearInterval(t);
  }, [processing, reload]);
  const list = useMemo(() => {
    let items = data?.candidates || [];
    if (f.q) items = items.filter((c) => `${c.name} ${c.location} ${c.current_company} ${c.skills.join(' ')}`.toLowerCase().includes(f.q.toLowerCase()));
    if (f.stage) items = items.filter((c) => c.stage === f.stage);
    if (f.loc) items = items.filter((c) => (c.location || '').includes(f.loc));
    if (f.exp) {
      const [a, b] = f.exp.split('-').map(Number);
      items = items.filter((c) => c.experience != null && c.experience >= a && c.experience < b);
    }
    const sorters = { match: (a, b) => (b.ai_score ?? -1) - (a.ai_score ?? -1), recent: (a, b) => b.applied_on.localeCompare(a.applied_on), exp: (a, b) => (b.experience ?? 0) - (a.experience ?? 0) };
    return [...items].sort(sorters[f.sort]);
  }, [data, f]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const job = data.job;
  const current = list.find((c) => c.id === sel) || list[0];
  const dupIds = new Set(data.duplicates.flatMap((g) => g.candidates.map((c) => c.id)));
  const upload = async (files) => {
    if (!job) return;
    const form = new FormData();
    files.forEach((fl) => form.append('files', fl));
    const out = await run(() => api.upload(`/screener/jobs/${job.id}/upload`, form), (o) => `${o.created.length} resume(s) uploaded. Screening with ${o.ai ? 'Claude' : 'rule-based scoring'}…`);
    if (out) reload();
  };
  const action = async (c, a) => { if (await run(() => api.post(`/screener/candidates/${c.id}/action`, { action: a }), { shortlist: 'Shortlisted', hold: 'Put on hold', reject: 'Rejected', interview: 'Moved to interview stage' }[a])) reload(); };
  const toggle = (id) => setChecked((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 3 ? [...x.slice(1), id] : [...x, id]));
  const locs = [...new Set((data.candidates || []).map((c) => (c.location || '').split(',')[0]).filter(Boolean))];
  return (
    <div>
      <div className="page-head">
        <div><h1>Resume Screener AI <Sparkles size={26} className="blue" /></h1><div className="sub">AI-powered resume reading, matching and shortlisting to find the right talent faster.</div></div>
        <BrandBanner />
      </div>

      <div className="grid">
        <Card className="span-9" title={<span className="row gap-6">Job Requirement for Screening {job && <button type="button" className="link" onClick={() => setModal({ type: 'job' })}><Pencil size={14} />Edit</button>}</span>}
          action={<select className="select sm" style={{ width: 260 }} value={job?.id || ''} onChange={(e) => { setSel(null); setChecked([]); setSp({ job: e.target.value }); }} aria-label="Job">{data.jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.vertical_short}{j.status !== 'Active' ? ` (${j.status})` : ''}</option>)}</select>}>
          {job ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 0 }}>
              <Req icon={Briefcase} color="var(--blue)" label="Role Title" value={job.title} />
              <Req icon={Settings2} color="var(--blue)" label="Must-Have Skills" value={job.must_have.join(', ') || '—'} />
              <Req icon={ChartColumn} color="var(--green)" label="Experience" value={job.exp_min != null ? `${job.exp_min} - ${job.exp_max ?? '+'} Years` : '—'} />
              <Req icon={GraduationCap} color="var(--amber)" label="Preferred Education" value={job.education || '—'} />
              <Req icon={MapPin} color="var(--red)" label="Location" value={`${job.location || '—'} (${job.work_mode})`} />
              <Req icon={IndianRupee} color="var(--green)" label="Salary Band" value={job.salary_max ? `₹ ${job.salary_min} - ${job.salary_max} LPA` : '—'} />
              <div style={{ gridColumn: 'span 2' }}><Req icon={FileText} color="var(--blue)" label="Knockout Questions" value={job.knockout.length ? job.knockout.map((q, i) => `${i + 1}. ${q}`).join('\n') : 'None'} /></div>
            </div>
          ) : <Empty text="Create a job in Hiring first" />}
        </Card>
        <Card className="span-3">
          <div className="row" style={{ gap: 14 }}>
            <div className="tone-green" style={{ width: 52, height: 52, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Users size={26} /></div>
            <div><div className="small" style={{ color: 'var(--text-2)' }}>Total Resumes</div><div style={{ fontSize: 26, fontWeight: 700 }}>{data.totals.uploaded}</div><div className="xs muted">{data.totals.forJob} for this job</div></div>
          </div>
          <input ref={fileRef} type="file" hidden multiple accept=".pdf,.docx,.txt" onChange={(e) => { if (e.target.files.length) upload([...e.target.files]); e.target.value = ''; }} />
          <Button variant="primary" className="block mt-16" size="lg" icon={CloudUpload} loading={busy} disabled={!job} onClick={() => fileRef.current?.click()}>Upload Resumes</Button>
          <div className="xs muted center mt-8">PDF, DOCX, TXT (max 10 MB each, up to 25 at a time)</div>
          <div className={`alert ${data.ai ? 'success' : 'info'} mt-12`} style={{ fontSize: 12 }}>
            {data.ai ? <><Bot size={16} />Scoring with Claude{data.model && data.model !== 'Claude' ? ` (${data.model})` : ''}.</> : <><Bot size={16} /><span>{window.hrmsDemo ? 'Rule-based scoring is active. Open this demo on claude.ai and allow Claude to screen with AI.' : <>Rule-based scoring is active. Add an <code>ANTHROPIC_API_KEY</code> on the server to screen with Claude.</>}</span></>}
          </div>
        </Card>
      </div>

      <div className="grid" style={{ alignItems: 'start' }}>
        <div className="span-9">
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row wrap" style={{ gap: 10 }}>
              <div className="search" style={{ width: 280 }}><Search size={18} /><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search candidates by name, skills, location…" /></div>
              <select className="select" style={{ width: 140 }} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">All Status</option>{['Applied', 'AI Screened', 'Shortlisted', 'Interview 1', 'Interview 2', 'Offer', 'On Hold', 'Rejected'].map((s) => <option key={s}>{s}</option>)}</select>
              <select className="select" style={{ width: 160 }} value={f.exp} onChange={(e) => setF({ ...f, exp: e.target.value })}><option value="">Experience (Years)</option><option value="0-2">0-2 years</option><option value="2-5">2-5 years</option><option value="5-8">5-8 years</option><option value="8-99">8+ years</option></select>
              <select className="select" style={{ width: 140 }} value={f.loc} onChange={(e) => setF({ ...f, loc: e.target.value })}><option value="">Location</option>{locs.map((l) => <option key={l}>{l}</option>)}</select>
              <select className="select" style={{ width: 170 }} value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}><option value="match">Higher Match First</option><option value="recent">Most Recent</option><option value="exp">Most Experienced</option></select>
              <span className="grow" />
              <Button icon={Users} onClick={() => setModal({ type: 'dups' })}>Detect Duplicates</Button>
              <Button variant="primary" icon={GitCompare} disabled={checked.length < 2} onClick={() => setModal({ type: 'compare' })}>Compare ({checked.length})</Button>
              <Menu icon={Ellipsis} items={[{ label: 'Screen all unscreened resumes', icon: RefreshCw, onClick: async () => { await run(() => api.post(`/screener/jobs/${job.id}/screen-all`), (o) => `${o.queued} resume(s) queued`); reload(); } }]} />
            </div>
            <div className="row mt-12 small" style={{ gap: 10 }}>
              <b>{list.length} candidates found</b>
              {data.duplicates.length > 0 && <button type="button" className="badge b-green" style={{ border: 0, cursor: 'pointer' }} onClick={() => setModal({ type: 'dups' })}><Users size={12} />{data.duplicates.length} duplicate group(s) found</button>}
              {processing > 0 && <span className="badge b-blue"><LoaderCircle size={12} className="spin" />Screening {processing} resume(s)…</span>}
            </div>
          </div>
          {list.length ? list.map((c, i) => (
            <CandidateRow key={c.id} c={c} rank={i + 1} job={job} selected={current?.id === c.id} checked={checked.includes(c.id)} dup={dupIds.has(c.id)}
              onSelect={() => setSel(c.id)} onCheck={() => toggle(c.id)} onAction={(a) => action(c, a)} onRescreen={async () => { await run(() => api.post(`/screener/candidates/${c.id}/screen`), 'Re-screening'); reload(); }} />
          )) : <Card><Empty text={data.candidates.length ? 'No candidates match these filters' : 'Upload resumes to start screening'} /></Card>}
        </div>
        <div className="span-3" style={{ position: 'sticky', top: 92 }}>
          {current ? <Detail key={current.id} c={current} all={data.candidates} onClose={() => setSel(null)} onAction={(a) => action(current, a)} onPick={setSel} /> : <Card><Empty text="Select a candidate" /></Card>}
        </div>
      </div>

      {modal?.type === 'job' && <JobForm job={job} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.type === 'compare' && <Compare items={(data.candidates || []).filter((c) => checked.includes(c.id))} job={job} onClose={() => setModal(null)} />}
      {modal?.type === 'dups' && <Duplicates groups={data.duplicates} onClose={() => setModal(null)} onReject={async (c) => { await run(() => api.post(`/screener/candidates/${c.id}/action`, { action: 'reject', reason: 'Duplicate application' }), 'Duplicate rejected'); reload(); }} />}
    </div>
  );
}

function Req({ icon: Icon, color, label, value }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
      <Icon size={22} style={{ color, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}><div className="b6 small">{label}</div><div className="small" style={{ color: 'var(--text-2)', whiteSpace: 'pre-line' }}>{value}</div></div>
    </div>
  );
}

function CandidateRow({ c, rank, job, selected, checked, dup, onSelect, onCheck, onAction, onRescreen }) {
  const skills = c.ai?.skills?.length ? c.ai.skills : (job?.must_have || []).map((s) => ({ skill: s, score: null }));
  const s = c.ai_score;
  const primary = s == null ? [] : s >= 75 ? ['shortlist', 'interview'] : s >= 55 ? ['shortlist', 'hold'] : ['interview', 'reject'];
  const decided = ['Shortlisted', 'Interview 1', 'Interview 2', 'Offer', 'Hired', 'Rejected', 'On Hold'].includes(c.stage);
  const btn = {
    shortlist: <Button key="s" size="sm" variant="success" icon={Star} onClick={(e) => { e.stopPropagation(); onAction('shortlist'); }}>Shortlist</Button>,
    interview: <Button key="i" size="sm" variant="soft" icon={Send} onClick={(e) => { e.stopPropagation(); onAction('interview'); }}>Move to Interview</Button>,
    hold: <Button key="h" size="sm" variant="warn" icon={Clock} onClick={(e) => { e.stopPropagation(); onAction('hold'); }}>Hold</Button>,
    reject: <Button key="r" size="sm" variant="reject" icon={CircleX} onClick={(e) => { e.stopPropagation(); onAction('reject'); }}>Reject</Button>,
  };
  return (
    <div className="card" onClick={onSelect} style={{ marginBottom: 10, cursor: 'pointer', borderColor: selected ? 'var(--blue)' : undefined, boxShadow: selected ? '0 0 0 2px var(--blue-soft)' : undefined, padding: 14 }}>
      <div className="row wrap" style={{ gap: 14, alignItems: 'center' }}>
        <label className="check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Compare ${c.name}`} /></label>
        <span className="muted b6" style={{ width: 16 }}>{rank}</span>
        <Avatar name={c.name} size={50} />
        <div style={{ width: 190, minWidth: 0 }}>
          <div className="b7 ellipsis" style={{ fontSize: 15 }}>{c.name} {dup && <Badge tone="amber">Duplicate?</Badge>}</div>
          <div className="small muted ellipsis">{c.current_title || 'Candidate'}</div>
          <div className="xs muted row gap-6 mt-8" style={{ marginTop: 4 }}><MapPin size={12} />{c.location || '—'}</div>
          <div className="xs muted row gap-6"><span>{c.experience != null ? `${c.experience} Years` : '—'}</span><span>·</span><span>{c.expected_ctc ? `₹ ${c.expected_ctc} LPA` : '—'}</span></div>
        </div>
        {c.screen_status === 'queued' || c.screen_status === 'processing' ? <div className="row gap-6 small blue" style={{ width: 64 }}><LoaderCircle size={18} className="spin" /></div> : <MatchRing score={s} />}
        <div className="grow" style={{ minWidth: 200 }}>
          <div className="xs b6 mb-8" style={{ marginBottom: 4 }}>Key Skills Match</div>
          {skills.slice(0, 4).map((k) => (
            <div key={k.skill} className="row xs" style={{ gap: 8, marginBottom: 3 }}>
              <span className="ellipsis" style={{ width: 82 }}>{k.skill}</span>
              <div className="grow"><div className="progress" style={{ height: 6 }}><i style={{ width: `${k.score ?? 0}%`, background: k.score == null ? '#ddd' : scoreColor(k.score) }} /></div></div>
              <span style={{ width: 30, textAlign: 'right' }}>{k.score == null ? '—' : `${k.score}%`}</span>
            </div>
          ))}
          {c.screen_status === 'error' && <div className="xs red">{c.screen_error}</div>}
        </div>
        <div style={{ width: 170, minWidth: 0 }} className="hide-sm">
          <div className="row gap-6 xs" style={{ alignItems: 'flex-start' }}><GraduationCap size={14} className="blue" /><span><div className="muted">Education</div><div className="b6 ellipsis" style={{ maxWidth: 140 }}>{c.education || '—'}</div></span></div>
          <div className="row gap-6 xs mt-8" style={{ alignItems: 'flex-start' }}><Building2 size={14} className="blue" /><span><div className="muted">Current Company</div><div className="b6">{c.current_company || '—'}</div></span></div>
        </div>
        <div className="row" style={{ gap: 4, width: 196, alignItems: 'center' }}>
          <div className="col grow" style={{ gap: 6 }}>{decided ? <Badge lg>{c.stage}</Badge> : primary.map((a) => btn[a])}</div>
          <span onClick={(e) => e.stopPropagation()}><Menu items={[
          { label: 'Shortlist', icon: Star, onClick: () => onAction('shortlist') },
          { label: 'Move to interview', icon: Send, onClick: () => onAction('interview') },
          { label: 'Hold', icon: Clock, onClick: () => onAction('hold') },
          { label: 'Reject', icon: CircleX, danger: true, onClick: () => onAction('reject') },
          { label: 'Re-screen', icon: RefreshCw, onClick: onRescreen },
          c.has_resume && { label: 'Download resume', icon: Download, onClick: () => download(`/candidates/${c.id}/resume`) },
        ]} /></span>
        </div>
      </div>
    </div>
  );
}

function Detail({ c, all, onClose, onAction, onPick }) {
  const { toast } = useApp();
  const [tab, setTab] = useState('Overview');
  const { data } = useApi(tab === 'Parsed Resume' ? `/candidates/${c.id}` : null);
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState([]);
  const [run, busy] = useAction(toast);
  const ai = c.ai;
  const similar = useMemo(() => {
    const mine = new Set(c.skills);
    return all.filter((x) => x.id !== c.id && x.skills.some((s) => mine.has(s))).map((x) => ({ ...x, overlap: x.skills.filter((s) => mine.has(s)).length })).sort((a, b) => b.overlap - a.overlap || (b.ai_score ?? 0) - (a.ai_score ?? 0)).slice(0, 5);
  }, [all, c]);
  const ask = async () => {
    if (!q.trim()) return;
    const out = await run(() => api.post(`/screener/candidates/${c.id}/ask`, { question: q }));
    if (out) { setAnswers((a) => [{ q, a: out.answer, engine: out.engine }, ...a]); setQ(''); }
  };
  return (
    <div className="card">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <Avatar name={c.name} size={56} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row wrap gap-6"><b style={{ fontSize: 17 }}>{c.name}</b>{c.ai_score != null && <Badge tone={c.ai_score >= 75 ? 'green' : c.ai_score >= 55 ? 'amber' : 'red'}>{c.ai_score}% Match</Badge>}</div>
          <div className="small muted">{c.current_title}</div>
          <div className="xs muted row gap-4"><MapPin size={12} />{c.location || '—'}</div>
        </div>
        <button type="button" className="icon-btn" style={{ width: 30, height: 30 }} onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="col xs mt-12" style={{ gap: 4, color: 'var(--text-2)' }}>
        {c.email && <span className="row gap-6"><Mail size={13} />{c.email}</span>}
        {c.phone && <span className="row gap-6"><Phone size={13} />{c.phone}</span>}
        {c.linkedin && <span className="row gap-6"><Link2 size={13} />{c.linkedin}</span>}
      </div>
      <div className="mt-12"><Tabs variant="pills" value={tab} onChange={setTab} tabs={['Overview', 'Parsed Resume', 'AI Analysis', 'Similar Profiles']} /></div>
      {tab === 'Overview' && (
        <div>
          {ai ? (
            <>
              <div className={`alert ${ai.score >= 75 ? 'success' : ai.score >= 55 ? 'warn' : 'error'}`}>{ai.score >= 55 ? <CircleCheck size={18} /> : <CircleAlert size={18} />}<div><b>{ai.verdict}</b><div>{ai.headline}</div></div></div>
              <h4 className="mt-12 mb-8" style={{ fontSize: 14 }}>Key Highlights</h4>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                {[[Briefcase, `${c.experience ?? '—'} Years`, 'Total Experience'], [GraduationCap, c.education || '—', 'Education'], [Building2, c.current_company || '—', 'Current Company'], [Wallet, c.expected_ctc ? lpa(c.expected_ctc) : '—', 'Expected Salary'], [MapPin, c.location || '—', 'Current Location'], [CalendarClock, c.notice_days != null ? `${c.notice_days} Days` : '—', 'Notice Period']].map(([I, v, l]) => (
                  <div key={l} className="row gap-6" style={{ alignItems: 'flex-start' }}><I size={15} className="blue" style={{ marginTop: 2, flexShrink: 0 }} /><div style={{ minWidth: 0 }}><div className="xs b6 ellipsis">{v}</div><div className="xs muted">{l}</div></div></div>
                ))}
              </div>
              <h4 className="mt-12 mb-8 row gap-6" style={{ fontSize: 14 }}><Sparkles size={14} className="blue" />AI Match Analysis</h4>
              <div className="alert success" style={{ display: 'block' }}><b className="small">Matched Criteria ({ai.matched.length})</b><div className="row wrap mt-8" style={{ gap: 5 }}>{ai.matched.map((m) => <span key={m} className="chip green" style={{ fontSize: 11.5, padding: '3px 9px' }}>{m}</span>)}</div></div>
              {ai.missing.length > 0 && <div className="alert error mt-8" style={{ display: 'block' }}><b className="small">Missing / Partial Criteria ({ai.missing.length})</b><div className="row wrap mt-8" style={{ gap: 5 }}>{ai.missing.map((m) => <span key={m} className="chip red" style={{ fontSize: 11.5, padding: '3px 9px' }}>{m}</span>)}</div></div>}
              <h4 className="mt-12 mb-8" style={{ fontSize: 14 }}>AI Summary</h4>
              <p className="small" style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>{ai.summary}</p>
              <div className="xs muted mt-8">Scored by {c.ai_engine === 'rules' ? 'rule-based matching' : c.ai_engine}{c.screen_error ? ` · ${c.screen_error}` : ''}</div>
            </>
          ) : <Empty text={c.screen_status ? 'Screening in progress…' : 'Not screened yet'} />}
          <div className="divider" />
          <div className="row gap-6"><Bot size={16} className="blue" /><b className="small">Ask AI about this candidate</b></div>
          <div className="row mt-8" style={{ gap: 6 }}>
            <Input className="sm" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} placeholder="e.g. Has she led a team?" />
            <Button size="sm" variant="primary" loading={busy} onClick={ask}>Ask</Button>
          </div>
          {answers.map((a, i) => <div key={i} className="card tight mt-8" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}><div className="xs b6">{a.q}</div><div className="small mt-8" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>{a.a}</div><div className="xs muted mt-8">{a.engine}</div></div>)}
          {!['Shortlisted', 'Interview 1', 'Interview 2', 'Offer', 'Hired'].includes(c.stage) && (
            <div className="row mt-16" style={{ gap: 8 }}>
              <Button size="sm" variant="success" icon={Star} className="grow" onClick={() => onAction('shortlist')}>Shortlist</Button>
              <Button size="sm" variant="soft" icon={UserPlus} className="grow" onClick={() => onAction('interview')}>Interview</Button>
            </div>
          )}
        </div>
      )}
      {tab === 'Parsed Resume' && (data ? <div className="code">{data.candidate.resume_text || 'No text could be read from this resume.'}</div> : <Loading />)}
      {tab === 'AI Analysis' && (ai ? (
        <div>
          <table className="table compact"><thead><tr><th>Skill</th><th className="num">Score</th></tr></thead>
            <tbody>{ai.skills.map((s) => <tr key={s.skill}><td><div className="b6 small">{s.skill}</div><div className="xs muted">{s.evidence}</div></td><td className="num b6" style={{ color: scoreColor(s.score) }}>{s.score}%</td></tr>)}</tbody></table>
          {ai.knockout?.length > 0 && <><h4 className="mt-12 mb-8" style={{ fontSize: 14 }}>Knockout questions</h4>{ai.knockout.map((k) => <div key={k.question} className="list-item" style={{ alignItems: 'flex-start' }}><div className="grow"><div className="small">{k.question}</div><div className="xs muted">{k.evidence}</div></div><Badge tone={k.answer === 'Yes' ? 'green' : k.answer === 'No' ? 'red' : 'amber'}>{k.answer}</Badge></div>)}</>}
        </div>
      ) : <Empty text="Not screened yet" />)}
      {tab === 'Similar Profiles' && (similar.length ? similar.map((x) => (
        <div key={x.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => onPick(x.id)}>
          <Avatar name={x.name} size={32} /><div className="grow" style={{ minWidth: 0 }}><div className="small b6 ellipsis">{x.name}</div><div className="xs muted">{x.overlap} shared skill(s) · {x.stage}</div></div><b className="small">{x.ai_score ?? '—'}%</b>
        </div>
      )) : <Empty text="No similar profiles" />)}
    </div>
  );
}

function Compare({ items, job, onClose }) {
  const rows = [
    ['Match', (c) => <b style={{ color: scoreColor(c.ai_score ?? 0) }}>{c.ai_score ?? '—'}%</b>],
    ['Verdict', (c) => c.ai?.verdict || '—'],
    ['Experience', (c) => (c.experience != null ? `${c.experience} yrs` : '—')],
    ['Expected CTC', (c) => (c.expected_ctc ? lpa(c.expected_ctc) : '—')],
    ['Notice period', (c) => (c.notice_days != null ? `${c.notice_days} days` : '—')],
    ['Location', (c) => c.location || '—'],
    ['Education', (c) => c.education || '—'],
    ['Current company', (c) => c.current_company || '—'],
    ...(job?.must_have || []).map((s) => [s, (c) => { const k = c.ai?.skills?.find((x) => x.skill === s); return k ? <span style={{ color: scoreColor(k.score) }}>{k.score}%</span> : '—'; }]),
    ['Stage', (c) => <Badge>{c.stage}</Badge>],
    ['Applied', (c) => fmtDate(c.applied_on)],
  ];
  return (
    <Modal title="Compare candidates" size="xwide" onClose={onClose}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th />{items.map((c) => <th key={c.id}><div className="row gap-6"><Avatar name={c.name} size={30} />{c.name}</div></th>)}</tr></thead>
          <tbody>{rows.map(([l, fn]) => <tr key={l}><td className="b6 small muted">{l}</td>{items.map((c) => <td key={c.id}>{fn(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function Duplicates({ groups, onClose, onReject }) {
  return (
    <Modal title="Possible duplicate applications" size="wide" onClose={onClose}>
      {groups.length ? groups.map((g, i) => (
        <div key={i} className="card tight mb-12" style={{ boxShadow: 'none' }}>
          <Badge tone="amber">{g.reason}</Badge>
          {g.candidates.map((c) => (
            <div key={c.id} className="list-item"><Avatar name={c.name} size={30} /><div className="grow"><div className="b6 small">{c.name}</div><div className="xs muted">{c.email || c.phone} · {c.title || 'No job'}</div></div><Badge>{c.stage}</Badge>
              {c.stage !== 'Rejected' && <Button size="xs" variant="reject" onClick={() => onReject(c)}>Reject as duplicate</Button>}</div>
          ))}
        </div>
      )) : <Empty text="No duplicates found for this job" />}
    </Modal>
  );
}
