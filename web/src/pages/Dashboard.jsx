import { useState } from 'react';
import { FolderKanban, CalendarClock, TriangleAlert, Trophy, Plus, ArrowUpRight, Diamond, Flag, CalendarCheck, Lock } from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { Link, useRouter } from '../router.jsx';
import {
  Loading, ErrorNote, Empty, VChip, HealthBadge, Progress, Avatar, DateBox, PriorityFlag, alpha, HEALTH,
} from '../ui.jsx';
import { ActivityList } from '../activity.jsx';
import { dueText, relDay, inrShort, fmtDate } from '../format.js';
import { ProjectForm } from './ProjectForm.jsx';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Kpi({ icon: Icon, tone, label, value, sub, onClick }) {
  return (
    <button type="button" className="card kpi kpi-btn" onClick={onClick}>
      <div className={`ic tone-${tone}`}><Icon size={30} strokeWidth={2} /></div>
      <div style={{ minWidth: 0, textAlign: 'left' }}>
        <div className="lbl">{label}</div>
        <div className="val">{value}{sub && <small>{sub}</small>}</div>
      </div>
    </button>
  );
}

export function NoAccess() {
  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
      <Empty icon={Lock} title="You have not been added to a vertical yet">
        Projects are shared by vertical. Ask an admin to give you access to BrainADZ Live, Marketing or Exhibits, then refresh this page.
      </Empty>
    </div>
  );
}

function attentionReason(p, today) {
  if (p.health === 'off_track') return { text: 'Off track', cls: 'b-red' };
  if (p.late) return { text: `${-Math.round((new Date(p.due_date) - new Date(today)) / 86400000)}d past due`, cls: 'b-red' };
  if (p.task_overdue) return { text: `${p.task_overdue} late task${p.task_overdue > 1 ? 's' : ''}`, cls: 'b-amber' };
  return { text: HEALTH[p.health].label, cls: HEALTH[p.health].cls };
}

export default function Dashboard() {
  const { me, vertical, verticals, verticalById, today, manageableVerticals, toast, refresh } = useApp();
  const { navigate } = useRouter();
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/dashboard', { vertical }), [vertical]);
  if (!verticals.length) return <NoAccess />;

  const scope = vertical ? verticalById(vertical)?.name : verticals.length === 1 ? verticals[0].name : verticals.map((v) => v.short).join(', ');
  const complete = async (t) => {
    setData((d) => ({ ...d, my_tasks: d.my_tasks.filter((x) => x.id !== t.id) }));
    try {
      await api.patch(`/tasks/${t.id}`, { status: 'done' });
      toast(`Marked “${t.title}” as done`, 'success');
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}, {me.name.split(' ')[0]}</h1>
          <div className="sub">Here is where your projects stand in {scope}.</div>
        </div>
        <div className="head-actions">
          <Link to="/projects" className="btn">All projects</Link>
          {manageableVerticals.length > 0 && (
            <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={18} />New project</button>
          )}
        </div>
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="kpis">
            <Kpi icon={FolderKanban} tone="blue" label="Active projects" value={data.kpis.active} sub={data.kpis.planning ? `+${data.kpis.planning} planning or on hold` : null} onClick={() => navigate('/projects')} />
            <Kpi icon={CalendarClock} tone="purple" label="Tasks due this week" value={data.kpis.due_week} onClick={() => navigate('/my')} />
            <Kpi icon={TriangleAlert} tone="red" label="Overdue tasks" value={data.kpis.overdue} sub={data.kpis.at_risk ? `${data.kpis.at_risk} projects need attention` : null} onClick={() => navigate('/projects')} />
            <Kpi icon={Trophy} tone="green" label={`Delivered in ${today.slice(0, 4)}`} value={data.kpis.delivered} onClick={() => navigate('/archive')} />
          </div>

          <div className="grid">
            <section className="card span-8">
              <div className="card-head">
                <h3>Needs attention <span className="sub">{data.attention.length ? `${data.attention.length} projects` : ''}</span></h3>
                <Link to="/projects" className="link">View projects <ArrowUpRight size={14} /></Link>
              </div>
              {data.attention.length === 0 ? (
                <Empty icon={CalendarCheck} title="Everything is on track">No project is late, at risk or carrying overdue tasks.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Project</th><th className="hide-sm">Owner</th><th>Issue</th><th className="hide-sm">Date</th><th style={{ width: 130 }}>Progress</th></tr></thead>
                    <tbody>
                      {data.attention.map((p) => {
                        const r = attentionReason(p, today);
                        const date = p.key_date || p.due_date;
                        return (
                          <tr key={p.id} className="click" onClick={() => navigate(`/projects/${p.id}`)}>
                            <td>
                              <div className="row gap-6"><span className="dot" style={{ background: p.vertical_color }} /><span className="b6 ellipsis" style={{ maxWidth: 280 }}>{p.client ? `${p.client} · ` : ''}{p.name}</span></div>
                              <div className="xs muted" style={{ marginLeft: 14 }}>{p.code} · {p.stage}</div>
                            </td>
                            <td className="hide-sm"><div className="row gap-6"><Avatar name={p.owner_name} color={p.owner_color} size={26} /><span className="small">{p.owner_name?.split(' ')[0]}</span></div></td>
                            <td><span className={`badge ${r.cls}`}>{r.text}</span></td>
                            <td className="hide-sm small nowrap">{date ? <>{fmtDate(date, { today })}<div className="xs muted">{relDay(today, date)}</div></> : '—'}</td>
                            <td><div className="row gap-6"><div className="grow"><Progress value={p.progress} color={p.vertical_color} /></div><span className="xs muted" style={{ width: 30 }}>{p.progress}%</span></div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card span-4">
              <div className="card-head">
                <h3>My tasks</h3>
                <Link to="/my" className="link">My work <ArrowUpRight size={14} /></Link>
              </div>
              {data.my_tasks.length === 0 ? (
                <Empty title="Nothing assigned to you">Tasks assigned to you across your projects show up here.</Empty>
              ) : (
                <div>
                  {data.my_tasks.map((t) => (
                    <div key={t.id} className="list-item">
                      <button type="button" className="check-btn" aria-label={`Mark ${t.title} as done`} onClick={() => complete(t)} />
                      <Link to={`/projects/${t.project_id}/tasks/${t.id}`} className="grow" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                        <div className="b6 small ellipsis">{t.title}</div>
                        <div className="xs muted ellipsis"><span className="dot" style={{ background: t.vertical_color, marginRight: 5 }} />{t.code} · {t.project_name}</div>
                      </Link>
                      <PriorityFlag priority={t.priority} />
                      <span className={`xs nowrap ${t.overdue ? 'red b6' : 'muted'}`}>{dueText(today, t.due_date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card span-7">
              <div className="card-head"><h3>Coming up <span className="sub">next 60 days</span></h3><Link to="/calendar" className="link">Calendar <ArrowUpRight size={14} /></Link></div>
              {data.upcoming.length === 0 ? <Empty title="No key dates in the next 60 days" /> : (
                <div>
                  {data.upcoming.map((u, i) => (
                    <Link key={i} to={`/projects/${u.project.id}`} className="list-item plain">
                      <DateBox date={u.date} color={u.project.vertical_color} />
                      <div className="grow">
                        <div className="b6 small ellipsis">
                          {u.type === 'key' ? <Diamond size={12} fill={u.project.vertical_color} color={u.project.vertical_color} style={{ marginRight: 5, verticalAlign: '-1px' }} /> : u.type === 'milestone' ? <Flag size={12} style={{ marginRight: 5, verticalAlign: '-1px' }} color="var(--purple)" /> : null}
                          {u.label}
                        </div>
                        <div className="xs muted ellipsis">{u.project.client ? `${u.project.client} · ` : ''}{u.project.name}{u.project.city ? ` · ${u.project.city}` : ''}</div>
                      </div>
                      <VChip name={u.project.vertical} color={u.project.vertical_color} small />
                      <span className="xs muted nowrap" style={{ width: 72, textAlign: 'right' }}>{relDay(today, u.date)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="card span-5">
              <div className="card-head"><h3>By vertical</h3></div>
              <div className="col" style={{ gap: 16 }}>
                {data.by_vertical.map((v) => {
                  const max = Math.max(1, ...data.by_vertical.map((x) => x.open));
                  return (
                    <div key={v.id} className="vbar">
                      <div className="row between">
                        <span className="row gap-6"><span className="dot" style={{ background: v.color }} /><b>{v.short}</b></span>
                        <span className="small muted">{v.open} open · {v.delivered} delivered</span>
                      </div>
                      <div className="vbar-track" title={`${v.active} active, ${v.open - v.active} planning or on hold`}>
                        <i style={{ width: `${(v.active / max) * 100}%`, background: v.color }} />
                        <i style={{ width: `${((v.open - v.active) / max) * 100}%`, background: alpha(v.color, 0.35) }} />
                      </div>
                      <div className="row between xs muted">
                        <span>{v.at_risk ? <span className="amber b6">{v.at_risk} need attention</span> : 'All on track'}</span>
                        <span>{v.open_budget ? `${inrShort(v.open_budget)} in open work` : ''}</span>
                      </div>
                    </div>
                  );
                })}
                <div className="row gap-16 xs muted">
                  <span className="row gap-6"><span className="sw" style={{ background: 'var(--text-2)' }} />Active</span>
                  <span className="row gap-6"><span className="sw" style={{ background: alpha('#3b4866', 0.35) }} />Planning or on hold</span>
                </div>
              </div>
            </section>

            <section className="card span-12">
              <div className="card-head"><h3>Recent activity</h3></div>
              <ActivityList items={data.activity} showProject />
            </section>
          </div>
        </>
      )}
      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); refresh(); navigate(`/projects/${p.id}`); }} />}
    </>
  );
}
