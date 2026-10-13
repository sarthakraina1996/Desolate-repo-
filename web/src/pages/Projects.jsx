import { useMemo, useState } from 'react';
import { Plus, LayoutList, Columns3, ChartGantt, Search, Download, Diamond, FolderKanban, X } from 'lucide-react';
import { useApp, useLoad, usePref } from '../store.jsx';
import { api } from '../api.js';
import { useRouter } from '../router.jsx';
import {
  Loading, ErrorNote, Empty, VChip, StatusBadge, HealthBadge, Progress, Avatar, Seg, PriorityFlag, PROJECT_STATUS, HEALTH, alpha,
} from '../ui.jsx';
import { fmtDate, relDay, daysFrom, addDays, MONTHS, inrShort } from '../format.js';
import { ProjectForm } from './ProjectForm.jsx';
import { NoAccess } from './Dashboard.jsx';

export function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

export function projectsCsv(items) {
  return toCsv([
    ['Code', 'Vertical', 'Project', 'Client', 'Status', 'Health', 'Stage', 'Owner', 'Start', 'Key date', 'Due', 'Venue', 'City', 'Budget (INR)', 'Tasks done', 'Tasks total', 'Files', 'Tags'],
    ...items.map((p) => [p.code, p.vertical, p.name, p.client, PROJECT_STATUS[p.status]?.label, HEALTH[p.health]?.label, p.stage, p.owner_name, p.start_date, p.key_date, p.due_date, p.venue, p.city, p.budget, p.task_done, p.task_total, p.file_count, p.tags.join('; ')]),
  ]);
}

function ProjectTable({ items, showVertical, onOpen, today }) {
  return (
    <div className="card flush">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              {showVertical && <th>Vertical</th>}
              <th className="hide-sm">Stage</th>
              <th className="hide-sm">Owner</th>
              <th>Key date</th>
              <th style={{ width: 150 }} className="hide-sm">Progress</th>
              <th>Health</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const date = p.key_date || p.due_date;
              const n = date ? daysFrom(today, date) : null;
              return (
                <tr key={p.id} className="click" onClick={() => onOpen(p)}>
                  <td style={{ maxWidth: 360 }}>
                    <div className="row gap-6">
                      <span className="b6 ellipsis">{p.name}</span>
                      <PriorityFlag priority={p.priority} />
                    </div>
                    <div className="xs muted ellipsis">{p.code}{p.client ? ` · ${p.client}` : ''}{p.city ? ` · ${p.city}` : ''}</div>
                  </td>
                  {showVertical && <td><VChip name={p.vertical} color={p.vertical_color} /></td>}
                  <td className="hide-sm small">{p.stage}</td>
                  <td className="hide-sm"><div className="row gap-6"><Avatar name={p.owner_name} color={p.owner_color} size={26} /><span className="small nowrap">{p.owner_name}</span></div></td>
                  <td className="nowrap small">
                    {date ? fmtDate(date, { today }) : '—'}
                    {date && p.open && <div className={`xs ${n < 0 ? 'red b6' : n <= 7 ? 'amber b6' : 'muted'}`}>{n < 0 ? `${-n} days ago` : relDay(today, date)}</div>}
                  </td>
                  <td className="hide-sm">
                    <div className="row gap-6"><div className="grow"><Progress value={p.progress} color={p.vertical_color} /></div><span className="xs muted" style={{ width: 54 }}>{p.task_done}/{p.task_total}</span></div>
                    {p.task_overdue > 0 && <div className="xs red mt-4">{p.task_overdue} overdue</div>}
                  </td>
                  <td><HealthBadge health={p.health} /></td>
                  <td><StatusBadge status={p.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const BOARD = ['planning', 'active', 'on_hold', 'completed'];

function ProjectBoard({ items, onOpen, onMove, canEdit, today }) {
  const [over, setOver] = useState(null);
  const cols = BOARD.map((s) => ({ s, items: items.filter((p) => p.status === s) }));
  return (
    <div className="pboard">
      {cols.map(({ s, items: list }) => (
        <div key={s} className={`pcol ${over === s ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(s); }}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => { e.preventDefault(); setOver(null); const id = Number(e.dataTransfer.getData('text/plain')); if (id) onMove(id, s); }}>
          <h4><span>{PROJECT_STATUS[s].label}</span><span className="pill-num">{list.length}</span></h4>
          {s === 'completed' && list.length === 0 && <div className="xs muted center" style={{ padding: '10px 4px' }}>Drop a project here to close it. Closed projects move to Past Projects.</div>}
          {list.map((p) => (
            <div key={p.id} className="pcard" draggable={canEdit(p)} onDragStart={(e) => e.dataTransfer.setData('text/plain', String(p.id))} onClick={() => onOpen(p)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p)}
              style={{ borderTopColor: p.vertical_color }}>
              <div className="row between xs muted"><span>{p.code}</span><HealthBadge health={p.health} compact /></div>
              <div className="b6 mt-4" style={{ lineHeight: 1.3 }}>{p.name}</div>
              {p.client && <div className="small muted">{p.client}</div>}
              <div className="mt-8"><Progress value={p.progress} color={p.vertical_color} height={6} /></div>
              <div className="row between mt-8">
                <Avatar name={p.owner_name} color={p.owner_color} size={24} />
                <span className="xs muted">{p.stage}</span>
                <span className={`xs nowrap ${p.late ? 'red b6' : 'muted'}`}>{p.key_date || p.due_date ? fmtDate(p.key_date || p.due_date, { today }) : ''}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Timeline({ items, onOpen, today }) {
  const dated = items.filter((p) => p.start_date || p.due_date || p.key_date);
  if (!dated.length) return <div className="card"><Empty title="No dates to plot">Add start and due dates to projects to see them on the timeline.</Empty></div>;
  const starts = dated.map((p) => p.start_date || p.key_date || p.due_date);
  const ends = dated.map((p) => p.due_date || p.key_date || p.start_date);
  let from = starts.reduce((a, b) => (a < b ? a : b));
  let to = ends.reduce((a, b) => (a > b ? a : b));
  from = from < addDays(today, -60) ? addDays(today, -60) : from;
  to = to > addDays(today, 240) ? addDays(today, 240) : to < addDays(today, 30) ? addDays(today, 30) : to;
  from = from.slice(0, 8) + '01';
  const days = daysFrom(from, to) + 1;
  const PX = 7;
  const width = days * PX;
  const x = (d) => Math.max(0, Math.min(width, daysFrom(from, d) * PX));
  const months = [];
  for (let d = from; d <= to; d = addDays(d.slice(0, 8) + '01', 32).slice(0, 8) + '01') months.push(d);
  return (
    <div className="card flush">
      <div className="tl-scroll">
        <div className="tl" style={{ width: width + 240 }}>
          <div className="tl-head">
            <div className="tl-name">Project</div>
            <div className="tl-grid" style={{ width }}>
              {months.map((m) => (
                <div key={m} className="tl-month" style={{ left: x(m) }}>{MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(2, 4)}</div>
              ))}
            </div>
          </div>
          {dated.map((p) => {
            const s = p.start_date || p.key_date || p.due_date;
            const e = p.due_date || p.key_date || p.start_date;
            const left = x(s);
            const w = Math.max(PX * 2, x(e) - left + PX);
            return (
              <div key={p.id} className="tl-row" onClick={() => onOpen(p)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen(p)}>
                <div className="tl-name">
                  <span className="dot" style={{ background: p.vertical_color }} />
                  <span className="ellipsis"><b>{p.client || p.code}</b> <span className="muted">{p.name}</span></span>
                </div>
                <div className="tl-grid" style={{ width }}>
                  {months.map((m) => <span key={m} className="tl-line" style={{ left: x(m) }} />)}
                  <span className="tl-today" style={{ left: x(today) }} />
                  <div className="tl-bar" style={{ left, width: w, background: alpha(p.vertical_color, 0.22), borderColor: alpha(p.vertical_color, 0.6) }} title={`${p.code}: ${fmtDate(s, { year: true })} to ${fmtDate(e, { year: true })}`}>
                    <i style={{ width: `${p.progress}%`, background: alpha(p.vertical_color, 0.55) }} />
                  </div>
                  {p.key_date && <Diamond className="tl-key" size={14} fill={p.vertical_color} color="#fff" style={{ left: x(p.key_date) - 7 + PX / 2 }} aria-label={`${p.key_date_label} ${p.key_date}`} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="row gap-16 xs muted" style={{ padding: '10px 16px' }}>
        <span className="row gap-6"><Diamond size={12} fill="var(--text-2)" color="#fff" />Event, show or launch date</span>
        <span className="row gap-6"><span className="tl-legend-today" />Today</span>
        <span>Darker fill shows tasks completed.</span>
      </div>
    </div>
  );
}

export default function Projects() {
  const { vertical, verticals, users, today, me, manageableVerticals, canManage, toast, refresh } = useApp();
  const { navigate } = useRouter();
  const [view, setView] = usePref('bpm.projects.view', 'list');
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [health, setHealth] = useState('');
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);
  const scope = view === 'board' ? 'all' : 'open';
  const { data, loading, error, reload, setData } = useLoad(
    () => api.get('/projects', { vertical, scope, status, owner, health, member: mine ? 'me' : '' }),
    [vertical, scope, status, owner, health, mine],
  );

  const items = useMemo(() => {
    let list = data?.items || [];
    if (view === 'board') {
      // Board shows open work plus projects closed in the last 45 days.
      list = list.filter((p) => p.status !== 'cancelled' && (p.status !== 'completed' || (p.completed_at && p.completed_at.slice(0, 10) >= addDays(today, -45))));
    }
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((p) => [p.name, p.code, p.client, p.city, p.venue, ...p.tags].join(' ').toLowerCase().includes(term));
    return list;
  }, [data, q, view, today]);

  if (!verticals.length) return <NoAccess />;
  const owners = users.filter((u) => (data?.items || []).some((p) => p.owner_id === u.id) || u.id === Number(owner));
  const canEdit = (p) => canManage(p.vertical_id) || p.owner_id === me.id;
  const move = async (id, s) => {
    const p = data.items.find((x) => x.id === id);
    if (!p || p.status === s) return;
    if (!canEdit(p)) return toast('Only the project owner or a vertical manager can change the status', 'error');
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === id ? { ...x, status: s } : x)) }));
    try {
      await api.patch(`/projects/${id}`, { status: s });
      toast(`${p.code} moved to ${PROJECT_STATUS[s].label}`, 'success');
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };
  const totalBudget = items.reduce((a, p) => a + (p.budget || 0), 0);
  const filtersOn = status || owner || health || mine || q;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <div className="sub">
            {data ? `${items.length} ${view === 'board' ? 'projects' : 'open projects'}` : 'Loading'}
            {totalBudget > 0 && ` · ${inrShort(totalBudget)} total budget`}
          </div>
        </div>
        <div className="head-actions">
          <Seg value={view} onChange={setView} label="View" options={[
            { value: 'list', label: 'List', icon: LayoutList },
            { value: 'board', label: 'Board', icon: Columns3 },
            { value: 'timeline', label: 'Timeline', icon: ChartGantt },
          ]} />
          <button type="button" className="btn" onClick={() => api.saveText(`projects-${today}.csv`, projectsCsv(items)).catch((e) => toast(e.message, 'error'))} disabled={!items.length}>
            <Download size={17} /><span className="hide-sm">Export</span>
          </button>
          {manageableVerticals.length > 0 && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={18} />New project</button>}
        </div>
      </div>

      <div className="filters mb-16">
        <div className="input-icon">
          <Search size={16} />
          <input id="projects-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, client, city, tag" aria-label="Filter projects" />
        </div>
        {view !== 'board' && (
          <select id="projects-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All open statuses</option>
            {['planning', 'active', 'on_hold'].map((s) => <option key={s} value={s}>{PROJECT_STATUS[s].label}</option>)}
          </select>
        )}
        <select id="projects-health" className="select" value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Health">
          <option value="">Any health</option>
          {Object.entries(HEALTH).map(([k, h]) => <option key={k} value={k}>{h.label}</option>)}
        </select>
        <select id="projects-owner" className="select" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">Any owner</option>
          <option value="me">Owned by me</option>
          {owners.filter((u) => u.id !== me.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label className="check"><input id="projects-mine" type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Projects I am on</label>
        {filtersOn && <button type="button" className="btn ghost sm" onClick={() => { setStatus(''); setOwner(''); setHealth(''); setMine(false); setQ(''); }}><X size={15} />Clear</button>}
      </div>

      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : items.length === 0 ? (
        <div className="card">
          <Empty icon={FolderKanban} title={filtersOn ? 'No projects match these filters' : 'No open projects yet'}
            action={!filtersOn && manageableVerticals.length > 0 && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={17} />Create the first one</button>}>
            {filtersOn ? 'Try clearing a filter.' : manageableVerticals.length ? 'Start from a template for your vertical, or copy a past project.' : 'When a manager adds you to a project it will show up here.'}
          </Empty>
        </div>
      ) : view === 'list' ? (
        <ProjectTable items={items} showVertical={!vertical && verticals.length > 1} onOpen={(p) => navigate(`/projects/${p.id}`)} today={today} />
      ) : view === 'board' ? (
        <ProjectBoard items={items} onOpen={(p) => navigate(`/projects/${p.id}`)} onMove={move} canEdit={canEdit} today={today} />
      ) : (
        <Timeline items={items} onOpen={(p) => navigate(`/projects/${p.id}`)} today={today} />
      )}
      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); refresh(); navigate(`/projects/${p.id}`); }} />}
    </>
  );
}
