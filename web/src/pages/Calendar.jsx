import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Diamond, Flag, CircleCheck, Circle, Plus } from 'lucide-react';
import { useApp, useLoad, usePref } from '../store.jsx';
import { api } from '../api.js';
import { useRouter } from '../router.jsx';
import { Loading, ErrorNote, Seg, alpha } from '../ui.jsx';
import { addDays, MONTHS, DOW, fmtDate, fmtDow } from '../format.js';
import { NoAccess } from './Dashboard.jsx';
import { ProjectForm } from './ProjectForm.jsx';

function monthGrid(ym) {
  const first = `${ym}-01`;
  const dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday first
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const ICON = { key: Diamond, due: Flag, milestone: Flag, task: Circle };

export default function CalendarPage() {
  const { vertical, verticals, today, manageableVerticals, refresh } = useApp();
  const { navigate } = useRouter();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [tasks, setTasks] = usePref('bpm.cal.tasks', 'mine');
  const days = useMemo(() => monthGrid(ym), [ym]);
  const { data, loading, error, reload } = useLoad(() => api.get('/calendar', { from: days[0], to: days[41], vertical, tasks }), [ym, vertical, tasks]);
  const byDay = useMemo(() => {
    const m = {};
    for (const it of data?.items || []) (m[it.date] ||= []).push(it);
    return m;
  }, [data]);
  const [sel, setSel] = useState(null);
  // Managers can add a project straight onto the calendar: the chosen day becomes its event,
  // show or launch date, and it starts in Planning.
  const [adding, setAdding] = useState(null); // { key_date } while the form is open
  const canAdd = manageableVerticals.length > 0;
  const added = (p) => {
    setAdding(null);
    refresh();
    if (p.key_date) {
      setYm(p.key_date.slice(0, 7));
      setSel(p.key_date);
    }
  };

  if (!verticals.length) return <NoAccess />;
  const shift = (n) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(d.toISOString().slice(0, 7));
    setSel(null);
  };
  const open = (it) => navigate(it.type === 'task' ? `/projects/${it.project_id}/tasks/${it.task_id}` : `/projects/${it.project_id}`);
  const [y, m] = ym.split('-').map(Number);
  const agenda = (data?.items || []).filter((it) => it.date.slice(0, 7) === ym && (!sel || it.date === sel));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <div className="sub">Event days, show openings, launches, milestones and task deadlines.{canAdd ? ' Pick a day to add a future project on it.' : ''}</div>
        </div>
        <div className="head-actions">
          <Seg value={tasks} onChange={setTasks} label="Tasks to show" options={[{ value: 'mine', label: 'My tasks' }, { value: 'all', label: 'All tasks' }, { value: 'none', label: 'No tasks' }]} />
          {canAdd && (
            <button type="button" className="btn primary" onClick={() => setAdding({ key_date: sel && sel >= today ? sel : '' })}>
              <Plus size={18} /><span className="hide-sm">Add future project</span><span className="only-sm">Add</span>
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={error} retry={reload} />
      <div className="cal-layout">
        <section className="card flush">
          <div className="row between" style={{ padding: '14px 16px' }}>
            <div className="row">
              <button type="button" className="btn sm" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
              <button type="button" className="btn sm" onClick={() => shift(1)} aria-label="Next month"><ChevronRight size={16} /></button>
              <h3 style={{ fontSize: 18, marginLeft: 6 }}>{MONTHS[m - 1]} {y}</h3>
            </div>
            <button type="button" className="btn sm" onClick={() => { setYm(today.slice(0, 7)); setSel(today); }}>Today</button>
          </div>
          <div className="mcal">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <div key={d} className="mcal-dow">{DOW[d]}</div>)}
            {days.map((d) => {
              const items = byDay[d] || [];
              const out = d.slice(0, 7) !== ym;
              return (
                <button key={d} type="button" className={`mcal-day ${out ? 'out' : ''} ${d === today ? 'today' : ''} ${sel === d ? 'sel' : ''}`} onClick={() => setSel(sel === d ? null : d)} aria-label={`${fmtDate(d, { year: true })}, ${items.length} items`}>
                  <span className="n">{Number(d.slice(8))}</span>
                  <span className="mcal-items">
                    {items.slice(0, 3).map((it, i) => {
                      const Ic = ICON[it.type];
                      // Planned projects (not started yet) are outlined instead of filled.
                      const planned = it.type === 'key' && it.status === 'planning';
                      const style = planned ? { background: '#fff', color: it.color, boxShadow: `inset 0 0 0 1px ${it.color}` }
                        : { background: it.type === 'key' ? it.color : alpha(it.color, 0.14), color: it.type === 'key' ? '#fff' : 'var(--text)' };
                      return (
                        <span key={i} className={`mcal-it ${it.type} ${it.done ? 'done' : ''} ${planned ? 'planned' : ''}`} style={style}>
                          <Ic size={10} fill={it.type === 'key' && !planned ? '#fff' : 'none'} />{it.title}
                        </span>
                      );
                    })}
                    {items.length > 3 && <span className="xs muted">+{items.length - 3} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {loading && <div className="xs muted" style={{ padding: '0 16px 12px' }}>Updating…</div>}
        </section>
        <section className="card">
          <div className="card-head">
            <h3>{sel ? `${fmtDow(sel)}, ${fmtDate(sel, { year: true })}` : `${MONTHS[m - 1]} at a glance`}</h3>
            {sel && <button type="button" className="link" onClick={() => setSel(null)}>Whole month</button>}
          </div>
          {canAdd && sel && sel >= today && (
            <button type="button" className="btn soft cal-add" onClick={() => setAdding({ key_date: sel })}>
              <Plus size={16} />Add a project on {fmtDate(sel, { today })}
            </button>
          )}
          {agenda.length === 0 ? <div className="small muted">Nothing scheduled.</div> : (
            <div className="agenda">
              {agenda.map((it, i) => {
                const Ic = it.type === 'task' && it.done ? CircleCheck : ICON[it.type];
                return (
                  <button key={i} type="button" className="agenda-it" onClick={() => open(it)}>
                    <span className="agenda-date">{!sel && <><b>{Number(it.date.slice(8))}</b><span>{fmtDow(it.date)}</span></>}</span>
                    <span className="file-ic sm" style={{ background: alpha(it.color, 0.14), color: it.color }}><Ic size={14} fill={it.type === 'key' ? it.color : 'none'} /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className={`small b6 ellipsis ${it.done ? 'muted' : ''}`} style={{ display: 'block', textDecoration: it.done ? 'line-through' : 'none' }}>{it.type === 'key' || it.type === 'due' ? `${it.label}: ${it.title}` : it.title}</span>
                      <span className={`xs ellipsis ${it.overdue ? 'red' : 'muted'}`} style={{ display: 'block' }}>{it.code}{it.project_name ? ` · ${it.project_name}` : ''}{it.assignee_name ? ` · ${it.assignee_name}` : ''}{it.status === 'planning' && it.type !== 'task' ? ' · Planning' : ''}{it.overdue ? ' · overdue' : ''}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="divider" />
          <div className="cal-legend" style={{ padding: 0 }}>
            <span><Diamond size={12} fill="var(--text-2)" />Event, show or launch</span>
            <span><span className="cal-planned-sw" />Planned, not started yet</span>
            <span><Flag size={12} />Milestone or project due</span>
            <span><Circle size={12} />Task</span>
          </div>
          <div className="row wrap mt-8" style={{ gap: 10 }}>
            {verticals.map((v) => <span key={v.id} className="row gap-6 xs"><span className="dot" style={{ background: v.color }} />{v.short}</span>)}
          </div>
        </section>
      </div>
      {adding && <ProjectForm preset={adding} onClose={() => setAdding(null)} onSaved={added} />}
    </>
  );
}
