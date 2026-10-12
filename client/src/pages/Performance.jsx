import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, Star, ClipboardCheck, Users, Plus, Trash2, Trophy, Download } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { Card, Kpi, Badge, Button, Empty, Loading, ErrorBox, Person, Modal, Field, Input, Select, Textarea, Progress, useConfirm, Pagination, Seg } from '../components/ui.jsx';
import { Donut, Legend, Bars, HBars, STATUS } from '../components/charts.jsx';
import { VerticalFilterNote } from './Dashboard.jsx';

const STATUS_COLORS = { 'Not Started': STATUS.neutral, 'Self Review': STATUS.warn, 'Manager Review': STATUS.info, Completed: STATUS.good };

export default function Performance() {
  const { isHR, vertical, isEmployeeOnly } = useApp();
  const [sp, setSp] = useSearchParams();
  const [cycle, setCycle] = useState('');
  const [dept, setDept] = useState('');
  const [newCycle, setNewCycle] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { meta, toast } = useApp();
  const { data, error, reload } = useApi(`/performance?${new URLSearchParams({ ...(cycle ? { cycle } : {}), ...(vertical ? { vertical } : {}), ...(dept ? { department: dept } : {}) })}`);
  const [run] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const open = Number(sp.get('review')) || null;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const s = data.summary;
  const c = data.cycle;
  return (
    <div>
      <div className="page-head">
        <div><h1>Performance</h1><div className="sub">Goals, self reviews and manager reviews for every cycle. <VerticalFilterNote /></div></div>
        <div className="filters">
          <select className="select" value={c?.id || ''} onChange={(e) => setCycle(e.target.value)} aria-label="Review cycle">{data.cycles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.status !== 'Active' ? ` (${x.status})` : ''}</option>)}</select>
          {!isEmployeeOnly && <Select value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All Departments" options={meta.departments.map((d) => ({ value: d.id, label: d.name }))} />}
          {isHR && <Button icon={Download} onClick={() => download('/reports/performance.csv')}>Export</Button>}
          {isHR && <Button variant="primary" icon={Plus} onClick={() => setNewCycle(true)}>New cycle</Button>}
          {isHR && c?.status === 'Active' && <Button onClick={async () => { if (await confirm({ title: `Close ${c.name}?`, text: 'Goals and reviews become read-only.', confirmLabel: 'Close cycle' })) { await run(() => api.put(`/performance/cycles/${c.id}`, { status: 'Closed' }), 'Cycle closed'); reload(); } }}>Close cycle</Button>}
        </div>
      </div>
      {!c ? <Card><Empty text="No review cycles yet" /></Card> : (
        <>
          {data.mine && (
            <div className="card mb-16 row wrap" style={{ gap: 20, background: 'linear-gradient(135deg, #fff, #eef4ff)' }}>
              <div className="grow" style={{ minWidth: 220 }}>
                <div className="small muted">My review · {c.name} ({fmtDate(c.start_date)} – {fmtDate(c.end_date)})</div>
                <div className="row gap-6 mt-8"><Badge lg>{data.mine.status}</Badge>{data.mine.final_rating && <span className="b7"><Star size={16} fill="#F2A600" color="#F2A600" style={{ verticalAlign: -2 }} /> {data.mine.final_rating} · {data.ratingLabels[Math.round(data.mine.final_rating)]}</span>}</div>
              </div>
              <div style={{ width: 240 }}><div className="small muted mb-8">Goal progress ({data.mine.goal_count} goals)</div><Progress value={data.mine.goal_progress || 0} color="var(--green)" /><div className="small b6 mt-8">{data.mine.goal_progress || 0}%</div></div>
              <Button variant="primary" onClick={() => setSp({ review: data.mine.id })}>{['Not Started', 'Self Review'].includes(data.mine.status) && c.status === 'Active' ? 'Update goals & self review' : 'View my review'}</Button>
            </div>
          )}
          {s.total > 0 && (
            <>
              <div className="kpis">
                <Kpi icon={ClipboardCheck} tone="green" label="Reviews Completed" value={`${s.completionPct}%`} extra={<span className="delta"><small>{s.completed} of {s.total}</small></span>} />
                <Kpi icon={Star} tone="amber" label="Average Rating" value={s.avgRating ?? '—'} unit="/ 5" />
                <Kpi icon={Target} tone="blue" label="Average Goal Progress" value={`${s.avgGoalProgress}%`} />
                <Kpi icon={Users} tone="purple" label="Awaiting Manager Review" value={s.statusCounts.find((x) => x.label === 'Manager Review').value} />
              </div>
              <div className="grid">
                <Card className="span-4" title="Review Status">
                  <div className="row donut-row" style={{ gap: 18 }}>
                    <Donut size={150} thickness={22} data={s.statusCounts.map((x) => ({ ...x, color: STATUS_COLORS[x.label] }))} center={{ value: s.total, label: 'Reviews' }} />
                    <Legend items={s.statusCounts.map((x) => ({ ...x, color: STATUS_COLORS[x.label] }))} />
                  </div>
                </Card>
                <Card className="span-4" title="Rating Distribution">
                  <Bars height={190} categories={['1', '2', '3', '4', '5']} series={[{ name: 'Employees', color: '#1A6DF0', values: s.distribution.map((d) => d.value) }]} />
                  <div className="xs muted center">1 Unsatisfactory · 3 Meets · 5 Outstanding</div>
                </Card>
                <Card className="span-4" title="Top Performers">
                  {s.top.length ? s.top.map((t, i) => (
                    <div key={t.id} className="list-item" style={{ padding: '7px 0' }}>
                      {i === 0 ? <Trophy size={18} className="amber" /> : <span className="small muted b6" style={{ width: 18, textAlign: 'center' }}>{i + 1}</span>}
                      <Person name={t.name} sub={t.department} id={t.employee_id} hasPhoto={t.has_photo} size={30} />
                      <span className="grow" /><b className="small">{t.final_rating}</b>
                    </div>
                  )) : <Empty text="No completed reviews yet" />}
                </Card>
              </div>
              {s.byDepartment.length > 0 && <Card title="Average rating by department" className="mb-16"><HBars items={s.byDepartment} max={5} format={(v) => v.toFixed(1)} labelWidth={150} /></Card>}
            </>
          )}
          {data.reviews.filter((r) => !r.mine).length > 0 && (() => {
            const team = data.reviews.filter((r) => !r.mine && (!status || r.status === status) && (!q || `${r.name} ${r.department}`.toLowerCase().includes(q.toLowerCase())));
            const shown = team.slice((page - 1) * 15, page * 15);
            return (
              <Card flush title={isHR ? 'All reviews' : 'My team'} action={<div className="row wrap" style={{ gap: 8, marginRight: 18 }}>
                <Seg value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: '', label: 'All' }, { value: 'Not Started', label: 'Not started' }, { value: 'Self Review', label: 'Self review' }, { value: 'Manager Review', label: 'Manager review' }, { value: 'Completed', label: 'Completed' }]} />
                <Input className="sm" style={{ width: 180 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search employee" />
              </div>}>
                <div className="table-wrap" style={{ marginTop: 8 }}>
                  <table className="table">
                    <thead><tr><th style={{ paddingLeft: 18 }}>Employee</th><th className="hide-sm">Department</th><th>Goals</th><th>Self</th><th>Manager</th><th>Status</th><th /></tr></thead>
                    <tbody>{shown.map((r) => (
                      <tr key={r.id} className="click" onClick={() => setSp({ review: r.id })}>
                        <td style={{ paddingLeft: 18 }}><Person name={r.name} sub={r.designation} id={r.employee_id} hasPhoto={r.has_photo} size={30} link={false} /></td>
                        <td className="hide-sm small">{r.department}</td>
                        <td style={{ minWidth: 130 }}><div className="row gap-6"><div className="grow"><Progress value={r.goal_progress || 0} height={6} color="var(--green)" /></div><span className="xs muted">{r.goal_progress || 0}%</span></div></td>
                        <td>{r.self_rating ?? '—'}</td>
                        <td className="b6">{r.manager_rating ?? '—'}</td>
                        <td><Badge>{r.status}</Badge></td>
                        <td className="right" style={{ paddingRight: 18 }}><Button size="xs">{r.status === 'Manager Review' && c.status === 'Active' ? 'Review' : 'Open'}</Button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                  {!team.length && <Empty text="No reviews match" />}
                </div>
                <div style={{ padding: '0 18px 14px' }}><Pagination page={page} pageSize={15} total={team.length} onPage={setPage} /></div>
              </Card>
            );
          })()}
        </>
      )}
      {open && <ReviewModal id={open} onClose={() => setSp({})} onChanged={reload} />}
      {newCycle && <NewCycle onClose={() => setNewCycle(false)} onDone={reload} />}
      {confirmEl}
    </div>
  );
}

function ReviewModal({ id, onClose, onChanged }) {
  const { toast } = useApp();
  const { data, error, reload } = useApi(`/performance/reviews/${id}`);
  const [run, busy] = useAction(toast);
  const [goal, setGoal] = useState({ title: '', weight: 25 });
  const [self, setSelf] = useState(null);
  const [mgr, setMgr] = useState({ rating: 3, comments: '' });
  const refresh = () => { reload(); onChanged(); };
  if (error) return <Modal title="Review" onClose={onClose}><ErrorBox error={error} /></Modal>;
  if (!data) return <Modal title="Review" onClose={onClose}><Loading /></Modal>;
  const r = data.review;
  const s = self || { rating: r.self_rating || 4, comments: r.self_comments || '' };
  const totalWeight = data.goals.reduce((t, g) => t + g.weight, 0);
  const ratingOpts = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].map((n) => ({ value: n, label: `${n}${data.ratingLabels[n] ? ` · ${data.ratingLabels[n]}` : ''}` }));
  return (
    <Modal title={`${r.name} · ${data.cycle.name}`} size="wide" onClose={onClose}>
      <div className="row wrap mb-16" style={{ gap: 10 }}><Badge lg>{r.status}</Badge>{r.final_rating && <Badge lg tone="green">Final rating {r.final_rating}</Badge>}<span className="small muted">{r.designation} · {r.department}</span></div>
      <div className="row between mb-8"><b>Goals</b><span className={`small ${totalWeight === 100 ? 'muted' : 'amber'}`}>Total weight {totalWeight}%{totalWeight !== 100 ? ' (should be 100%)' : ''}</span></div>
      {data.goals.length ? data.goals.map((g) => (
        <div key={g.id} className="list-item">
          <div className="grow" style={{ minWidth: 0 }}><div className="b6 small">{g.title}</div><div className="xs muted">Weight {g.weight}%{g.due_date ? ` · due ${fmtDate(g.due_date)}` : ''}</div></div>
          {data.canEditGoals ? (
            <>
              <input type="range" min="0" max="100" step="5" defaultValue={g.progress} style={{ width: 140 }} aria-label={`Progress for ${g.title}`}
                onMouseUp={(e) => run(() => api.put(`/performance/goals/${g.id}`, { progress: Number(e.target.value) })).then(refresh)}
                onKeyUp={(e) => run(() => api.put(`/performance/goals/${g.id}`, { progress: Number(e.target.value) })).then(refresh)}
                onTouchEnd={(e) => run(() => api.put(`/performance/goals/${g.id}`, { progress: Number(e.target.value) })).then(refresh)} />
              <b className="small" style={{ width: 40 }}>{g.progress}%</b>
              <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete goal" onClick={async () => { await run(() => api.del(`/performance/goals/${g.id}`)); refresh(); }} />
            </>
          ) : <><div style={{ width: 140 }}><Progress value={g.progress} color="var(--green)" /></div><b className="small" style={{ width: 40 }}>{g.progress}%</b></>}
        </div>
      )) : <Empty text="No goals yet" />}
      {data.canEditGoals && (
        <div className="row mt-8" style={{ gap: 8 }}>
          <Input className="sm" value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} placeholder="New goal, e.g. Launch 4 campaigns" />
          <Input className="sm" type="number" min="5" max="100" value={goal.weight} onChange={(e) => setGoal({ ...goal, weight: e.target.value })} style={{ width: 80 }} aria-label="Weight" />
          <Button size="sm" icon={Plus} loading={busy} onClick={async () => { if (await run(() => api.post('/performance/goals', { cycle_id: data.cycle.id, employee_id: r.employee_id, ...goal }), 'Goal added')) { setGoal({ title: '', weight: 25 }); refresh(); } }}>Add</Button>
        </div>
      )}
      <div className="divider" />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 0 }}>
        <div>
          <b>Self review</b>
          {data.canSelf ? (
            <div className="col mt-8" style={{ gap: 10 }}>
              <Field label="Self rating"><Select value={s.rating} onChange={(e) => setSelf({ ...s, rating: Number(e.target.value) })} options={ratingOpts} /></Field>
              <Field label="Highlights & reflections"><Textarea value={s.comments} onChange={(e) => setSelf({ ...s, comments: e.target.value })} placeholder="What went well, what you learned, support you need" /></Field>
              <div className="row" style={{ gap: 8 }}>
                <Button loading={busy} onClick={async () => { if (await run(() => api.post(`/performance/reviews/${r.id}/self`, { ...s, submit: false }), 'Draft saved')) refresh(); }}>Save draft</Button>
                <Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post(`/performance/reviews/${r.id}/self`, s), 'Self review submitted to your manager')) refresh(); }}>Submit</Button>
              </div>
            </div>
          ) : <div className="small mt-8">{r.self_rating ? <><b>{r.self_rating}</b> · {r.self_comments}</> : <span className="muted">Not submitted yet</span>}</div>}
        </div>
        <div>
          <b>Manager review</b>
          {data.canManager ? (
            <div className="col mt-8" style={{ gap: 10 }}>
              {r.status !== 'Manager Review' && <div className="alert warn" style={{ fontSize: 12 }}>The self review is not submitted yet. You can still complete the review.</div>}
              <Field label="Final rating"><Select value={mgr.rating} onChange={(e) => setMgr({ ...mgr, rating: Number(e.target.value) })} options={ratingOpts} /></Field>
              <Field label="Feedback"><Textarea value={mgr.comments} onChange={(e) => setMgr({ ...mgr, comments: e.target.value })} placeholder="Strengths, areas to grow, next-cycle focus" /></Field>
              <Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post(`/performance/reviews/${r.id}/manager`, mgr), 'Review completed')) refresh(); }}>Complete review</Button>
            </div>
          ) : <div className="small mt-8">{r.manager_rating ? <><b>{r.manager_rating}</b> · {r.manager_comments}</> : <span className="muted">Pending</span>}</div>}
        </div>
      </div>
    </Modal>
  );
}

function NewCycle({ onClose, onDone }) {
  const { toast, meta } = useApp();
  const y = Number(meta.today.slice(0, 4));
  const [f, setF] = useState({ name: `Annual Review FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`, start_date: `${y}-04-01`, end_date: `${y + 1}-03-31` });
  const [run, busy] = useAction(toast);
  return (
    <Modal title="New review cycle" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post('/performance/cycles', f), 'Cycle started. Everyone was notified.')) { onDone(); onClose(); } }}>Start cycle</Button></>}>
      <div className="form-grid">
        <Field label="Name" className="full"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Start"><Input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="End"><Input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        <div className="full small muted">A review is created for every current employee. They can then add goals and submit self reviews.</div>
      </div>
    </Modal>
  );
}
