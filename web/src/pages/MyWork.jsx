import { useEffect, useMemo, useState } from 'react';
import { Check, ListChecks } from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { useRouter } from '../router.jsx';
import { Loading, ErrorNote, Empty, PriorityFlag, TaskStatusBadge, Seg, Avatar, CountPill, NewTag } from '../ui.jsx';
import { daysFrom, fmtDate, fmtDow, dueText } from '../format.js';
import { NoAccess } from './Dashboard.jsx';

function bucket(today, t) {
  if (!t.due_date) return 'none';
  const n = daysFrom(today, t.due_date);
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  const dow = new Date(today + 'T00:00:00Z').getUTCDay(); // 0 Sunday
  const toSunday = (7 - dow) % 7;
  if (n <= toSunday) return 'week';
  if (n <= toSunday + 7) return 'next';
  return 'later';
}
const BUCKETS = [
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['week', 'Later this week'],
  ['next', 'Next week'],
  ['later', 'Later'],
  ['none', 'No due date'],
];

export default function MyWork() {
  const { vertical, verticals, today, toast, markSeen } = useApp();
  const { navigate } = useRouter();
  const [mode, setMode] = useState('mine');
  const query = mode === 'mine' ? { assignee: 'me', scope: 'open' } : mode === 'created' ? { created: 'me', scope: 'open' } : mode === 'unassigned' ? { assignee: 'none', scope: 'open' } : { assignee: 'me', scope: 'done' };
  const { data, loading, error, reload, setData } = useLoad(() => api.get('/tasks', { ...query, vertical }), [mode, vertical]);
  // Opening My Work marks new assignments as seen; they keep their "New" tag for this visit.
  useEffect(() => {
    if (mode === 'mine' && data?.items.some((t) => t.is_new)) markSeen('mywork');
  }, [data, mode, markSeen]);
  const grouped = useMemo(() => {
    const g = Object.fromEntries(BUCKETS.map(([k]) => [k, []]));
    for (const t of data?.items || []) g[bucket(today, t)].push(t);
    return g;
  }, [data, today]);

  if (!verticals.length) return <NoAccess />;

  const toggle = async (t) => {
    const status = t.status === 'done' ? 'todo' : 'done';
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === t.id ? { ...x, status } : x)) }));
    try {
      await api.patch(`/tasks/${t.id}`, { status });
      toast(status === 'done' ? `Done: ${t.title}` : 'Task reopened', 'success');
      setTimeout(() => reload({ quiet: true }), 600);
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };
  const items = data?.items || [];
  const overdue = grouped.overdue.length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My Work</h1>
          <div className="sub">
            {mode === 'mine' ? `${items.length} open tasks assigned to you${overdue ? `, ${overdue} overdue` : ''}.` : mode === 'created' ? 'Open tasks you added, assigned to anyone.' : mode === 'unassigned' ? 'Open tasks nobody owns yet. Pick one up or assign it.' : 'Tasks you have completed recently.'}
          </div>
        </div>
        <Seg value={mode} onChange={setMode} label="Show" options={[
          { value: 'mine', label: 'Assigned to me' },
          { value: 'created', label: 'Added by me' },
          { value: 'unassigned', label: 'Unassigned' },
          { value: 'done', label: 'Completed' },
        ]} />
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : items.length === 0 ? (
        <div className="card"><Empty icon={ListChecks} title={mode === 'mine' ? 'Nothing on your plate' : 'No tasks here'}>{mode === 'mine' ? 'When someone assigns you a task in one of your projects, it shows up here with its due date.' : ''}</Empty></div>
      ) : mode === 'done' ? (
        <div className="card flush">
          {items.slice(0, 150).map((t) => <WorkRow key={t.id} t={t} today={today} onToggle={toggle} onOpen={() => navigate(`/projects/${t.project_id}/tasks/${t.id}`)} showWho={false} />)}
        </div>
      ) : (
        <div className="col" style={{ gap: 16 }}>
          {BUCKETS.map(([k, label]) => grouped[k].length > 0 && (
            <section key={k} className="card flush">
              <div className="stage-head">
                <b className={k === 'overdue' ? 'red' : ''}>{label}</b>
                <CountPill n={grouped[k].length} fresh={grouped[k].filter((t) => t.is_new).length} />
                {k === 'today' && <span className="xs muted">{fmtDow(today)}, {fmtDate(today, { year: true })}</span>}
              </div>
              {grouped[k].map((t) => <WorkRow key={t.id} t={t} today={today} onToggle={toggle} onOpen={() => navigate(`/projects/${t.project_id}/tasks/${t.id}`)} showWho={mode !== 'mine'} />)}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function WorkRow({ t, today, onToggle, onOpen, showWho }) {
  return (
    <div className={`trow ${t.status === 'done' ? 'done' : ''}`}>
      <button type="button" className={`check-btn ${t.status === 'done' ? 'on' : ''}`} onClick={() => onToggle(t)} aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Mark ${t.title} done`}>
        {t.status === 'done' && <Check size={13} strokeWidth={3} />}
      </button>
      <button type="button" className="trow-main" onClick={onOpen}>
        <span className="ttitle">{t.is_new && <NewTag />}{t.title}</span>
        <span className="tmeta">
          <span className="xs muted ellipsis"><span className="dot" style={{ background: t.vertical_color, marginRight: 5 }} />{t.code} · {t.client ? `${t.client} · ` : ''}{t.project_name}</span>
          {t.status !== 'todo' && t.status !== 'done' && <TaskStatusBadge status={t.status} />}
          <PriorityFlag priority={t.priority} />
        </span>
      </button>
      {showWho && <span className="tassignee">{t.assignee_name ? <><Avatar name={t.assignee_name} color={t.assignee_color} size={24} /><span className="small hide-sm">{t.assignee_name.split(' ')[0]}</span></> : <span className="xs faint">Unassigned</span>}</span>}
      <span className={`tdue xs ${t.overdue ? 'red b6' : 'muted'}`}>{t.status === 'done' && t.completed_at ? `Done ${fmtDate(t.completed_at.slice(0, 10), { today })}` : dueText(today, t.due_date)}</span>
    </div>
  );
}
