import { useMemo, useState } from 'react';
import { Plus, LayoutList, Columns3, ChartGantt, Search, Download, Diamond, FolderKanban, X } from 'lucide-react';
import { useApp, useLoad, usePref } from '../store.jsx';
import { api } from '../api.js';
import { useRouter } from '../router.jsx';
import {
  Loading, ErrorNote, Empty, VChip, StatusBadge, HealthBadge, Progress, Avatar, Seg, PriorityFlag, PROJECT_STATUS, HEALTH, alpha,
} from '../ui.jsx';
import { fmtDate, relDay, daysFrom, addDays, MONTHS, inrShort } from '../format.js';
import { Board, Cover, Labels, Badges, DueBadge, labelColor } from '../board.jsx';
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
    ['Code', 'Vertical', 'Project', 'Client', 'Status', 'Health', 'Stage', 'Owner', 'Start', 'Key date', 'Due', 'Venue', 'City', 'Budget (INR)', 'Received (INR)', 'To collect (INR)', 'Tasks done', 'Tasks total', 'Files', 'Tags'],
    ...items.map((p) => [p.code, p.vertical, p.name, p.client, PROJECT_STATUS[p.status]?.label, HEALTH[p.health]?.label, p.stage, p.owner_name, p.start_date, p.key_date, p.due_date, p.venue, p.city, p.budget, p.received, p.to_collect, p.task_done, p.task_total, p.file_count, p.tags.join('; ')]),
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
              <th className="hide-sm">Budget</th>
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
                      {p.new_items > 0 && <NewCount p={p} />}
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
                  <td className="hide-sm nowrap small">
                    {p.budget ? inrShort(p.budget) : '—'}
                    {p.to_collect != null && <div className={`xs ${p.to_collect > 0 ? 'amber b6' : 'green'}`}>{p.to_collect > 0 ? `${inrShort(p.to_collect)} to collect` : 'Fully paid'}</div>}
                  </td>
                  <td><HealthBadge health={p.health} /></td>
                  <td><StatusBadge status={p.status} readyLabel={p.ready_label} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Board columns. "ready" only exists for verticals with a final board column
// (Exhibits: Ready for Event / Exhibition); the others end at Delivered.
function boardColumns(verticalsInView) {
  const readyV = verticalsInView.filter((v) => v.ready_label);
  const others = verticalsInView.filter((v) => !v.ready_label);
  const cols = [
    { key: 'planning', title: 'Planning', color: '#7c5cfc', canAdd: true },
    { key: 'active', title: 'Active', color: '#1a6df0', canAdd: true },
    { key: 'on_hold', title: 'On hold', color: '#f2a600', canAdd: true },
  ];
  if (readyV.length) {
    cols.push({
      key: 'ready', title: readyV[0].ready_label, color: readyV[0].color,
      accepts: (p) => !!p.ready_label,
      blockedText: `Only ${readyV.map((v) => v.short).join(', ')} projects end here`,
      note: others.length ? `${readyV.map((v) => v.short).join(', ')} projects only` : null,
      empty: 'Drag a project here when the stall is built and handed over',
    });
  }
  if (others.length) {
    cols.push({
      key: 'completed', title: 'Delivered', color: '#1fa855',
      accepts: (p) => !p.ready_label,
      blockedText: `${readyV.map((v) => v.short).join(', ')} projects end at ${readyV[0]?.ready_label}`,
      note: readyV.length ? `${others.map((v) => v.short).join(', ')} projects` : null,
      empty: 'Drop a project here when it is delivered. It moves to Past Projects.',
    });
  }
  return cols;
}

// "2 new tasks, 1 new file" for tooltips.
export function newSummary(p) {
  const u = p.unseen || {};
  return [
    u.tasks && `${u.tasks} new task${u.tasks > 1 ? 's' : ''}`,
    u.files && `${u.files} new file${u.files > 1 ? 's' : ''}`,
    u.discussion && `${u.discussion} new comment${u.discussion > 1 ? 's' : ''}`,
  ].filter(Boolean).join(', ');
}

function NewCount({ p }) {
  return <span className="new-tag" title={newSummary(p)}>{p.new_items} new</span>;
}

const healthLabel = { at_risk: { text: 'At risk', color: '#f2a600' }, off_track: { text: 'Off track', color: '#e31b3b' } };

function ProjectCard({ p, today, showVertical }) {
  const date = p.key_date || p.due_date;
  return (
    <>
      <Cover file={p.cover} color={p.vertical_color} />
      <div className="kb-body">
        <Labels items={[
          p.new_items > 0 && { text: `${p.new_items} new`, color: '#e31b3b', solid: true, title: newSummary(p) },
          showVertical && { text: p.vertical, color: p.vertical_color, solid: true },
          healthLabel[p.health] && { ...healthLabel[p.health], solid: true },
          p.priority === 'urgent' && { text: 'Urgent', color: '#e31b3b' },
          ...p.tags.slice(0, 3).map((t) => ({ text: t, color: labelColor(t) })),
        ]} />
        <div className="kb-title">{p.name}</div>
        <div className="kb-sub">{p.client ? `${p.client} · ` : ''}{p.code}</div>
        <div className="kb-meta">
          <Badges files={p.file_count} checklist={{ done: p.task_done, total: p.task_total }}>
            <DueBadge date={date} today={today} done={!p.open} icon={Diamond} label={p.key_date ? p.key_date_label : 'Due'} />
          </Badges>
          <span className="kb-people"><Avatar name={p.owner_name} color={p.owner_color} size={26} /></span>
        </div>
        {p.task_total > 0 && <div className="kb-progress"><i style={{ width: `${p.progress}%`, background: p.vertical_color }} /></div>}
      </div>
    </>
  );
}

function ProjectBoard({ items, onOpen, onMove, onAdd, onSort, canEdit, today, verticalsInView, manageable }) {
  const [addV, setAddV] = useState(manageable[0]?.id || '');
  const columns = boardColumns(verticalsInView).map((c) => ({
    ...c,
    canAdd: c.canAdd && manageable.length > 0,
    addPlaceholder: 'Project name, e.g. Pharma Expo stall',
    cards: items
      .filter((p) => p.status === c.key)
      .sort((a, b) => (a.board_sort ?? 1e9) - (b.board_sort ?? 1e9) || (a.key_date || a.due_date || '9').localeCompare(b.key_date || b.due_date || '9'))
      .map((p, i) => ({ ...p, sort: p.board_sort ?? i + 1 })),
  })).map((c) => ({ ...c, fresh: c.cards.filter((p) => p.new_items > 0).length }));
  return (
    <Board id="projects" columns={columns} today={today}
      renderCard={(p) => <ProjectCard p={p} today={today} showVertical={verticalsInView.length > 1} />}
      onOpen={onOpen} onMove={onMove} canDrag={canEdit}
      onAdd={(col, name) => onAdd(col, name, Number(addV))}
      onSort={onSort}
      sortOptions={[{ value: 'date', label: 'key date' }, { value: 'name', label: 'name' }, { value: 'client', label: 'client' }]}
      composerExtra={manageable.length > 1 && (
        <select className="select sm" value={addV} onChange={(e) => setAddV(e.target.value)} aria-label="Vertical">
          {manageable.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )} />
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
      list = list.filter((p) => p.status !== 'cancelled' && (p.status !== 'completed' || (!p.ready_label && p.completed_at && p.completed_at.slice(0, 10) >= addDays(today, -45))));
    }
    const term = q.trim().toLowerCase();
    if (term) list = list.filter((p) => [p.name, p.code, p.client, p.city, p.venue, ...p.tags].join(' ').toLowerCase().includes(term));
    return list;
  }, [data, q, view, today]);

  if (!verticals.length) return <NoAccess />;
  const owners = users.filter((u) => (data?.items || []).some((p) => p.owner_id === u.id) || u.id === Number(owner));
  const canEdit = (p) => canManage(p.vertical_id) || p.owner_id === me.id;
  const statusName = (p, st) => (st === 'ready' ? p.ready_label : st === 'completed' ? 'Delivered' : PROJECT_STATUS[st].label);
  const move = async (card, st, sort) => {
    const p = data.items.find((x) => x.id === card.id);
    if (!p) return;
    if (!canEdit(p)) return toast('Only the project owner or a vertical manager can move this project', 'error');
    const body = st === p.status ? { board_sort: sort } : { status: st, board_sort: sort };
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === p.id ? { ...x, ...body, completed_at: st === 'completed' ? new Date().toISOString() : x.completed_at } : x)) }));
    try {
      await api.patch(`/projects/${p.id}`, body);
      if (body.status) toast(`${p.code} moved to ${statusName(p, st)}`, 'success');
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };
  const addCard = async (col, name, verticalId) => {
    const vId = verticalId || vertical || manageableVerticals[0]?.id;
    try {
      const p = await api.post('/projects', { vertical_id: vId, name, status: col.key, owner_id: me.id });
      toast(`${p.code} added. Open it to add dates, team and tasks.`, 'success');
      reload({ quiet: true });
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  const sortColumn = async (col, by) => {
    const cmp = {
      date: (a, b) => (a.key_date || a.due_date || '9').localeCompare(b.key_date || b.due_date || '9'),
      name: (a, b) => a.name.localeCompare(b.name),
      client: (a, b) => (a.client || '~').localeCompare(b.client || '~'),
    }[by];
    const sorted = [...col.cards].sort(cmp).filter(canEdit);
    setData((d) => ({ ...d, items: d.items.map((x) => { const i = sorted.findIndex((c) => c.id === x.id); return i === -1 ? x : { ...x, board_sort: i + 1 }; }) }));
    try {
      for (const [i, c] of sorted.entries()) await api.patch(`/projects/${c.id}`, { board_sort: i + 1 });
    } catch (e) {
      toast(e.message, 'error');
    }
    reload({ quiet: true });
  };
  const totalBudget = items.reduce((a, p) => a + (p.budget || 0), 0);
  const totalToCollect = items.reduce((a, p) => a + (p.to_collect || 0), 0);
  const filtersOn = status || owner || health || mine || q;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <div className="sub">
            {data ? `${items.length} ${view === 'board' ? 'projects' : 'open projects'}` : 'Loading'}
            {totalBudget > 0 && ` · ${inrShort(totalBudget)} total budget`}
            {totalToCollect > 0 && ` · ${inrShort(totalToCollect)} to collect`}
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
            {verticals.filter((v) => v.ready_label && (!vertical || v.id === vertical)).slice(0, 1).map((v) => <option key="ready" value="ready">{v.ready_label}</option>)}
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
      {loading && !data ? <Loading /> : items.length === 0 && view !== 'board' ? (
        <div className="card">
          <Empty icon={FolderKanban} title={filtersOn ? 'No projects match these filters' : 'No open projects yet'}
            action={!filtersOn && manageableVerticals.length > 0 && <button type="button" className="btn primary" onClick={() => setCreating(true)}><Plus size={17} />Create the first one</button>}>
            {filtersOn ? 'Try clearing a filter.' : manageableVerticals.length ? 'Start from a template for your vertical, or copy a past project.' : 'When a manager adds you to a project it will show up here.'}
          </Empty>
        </div>
      ) : view === 'list' ? (
        <ProjectTable items={items} showVertical={!vertical && verticals.length > 1} onOpen={(p) => navigate(`/projects/${p.id}`)} today={today} />
      ) : view === 'board' ? (
        <ProjectBoard items={items} onOpen={(p) => navigate(`/projects/${p.id}`)} onMove={move} onAdd={addCard} onSort={sortColumn} canEdit={canEdit} today={today}
          verticalsInView={vertical ? verticals.filter((v) => v.id === vertical) : verticals}
          manageable={vertical ? manageableVerticals.filter((v) => v.id === vertical) : manageableVerticals} />
      ) : (
        <Timeline items={items} onOpen={(p) => navigate(`/projects/${p.id}`)} today={today} />
      )}
      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); refresh(); navigate(`/projects/${p.id}`); }} />}
    </>
  );
}
