import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Pencil, Copy, Trash2, CheckCircle2, PauseCircle, RotateCcw, Ban, LayoutTemplate, Download, Plus, Diamond, MapPin,
  IndianRupee, CalendarRange, Users, Flag, X, LayoutList, Columns3, MessageSquare, Paperclip, Lock, Grid2x2, List, Check,
  MessagesSquare, Wallet, Play,
} from 'lucide-react';
import { useApp, useLoad, usePref } from '../store.jsx';
import { api } from '../api.js';
import { Link, useRouter } from '../router.jsx';
import {
  Loading, ErrorNote, Empty, VChip, StatusBadge, HealthBadge, Avatar, Ring, Menu, Seg, PriorityFlag, TaskStatusBadge, Modal, Field,
  UserSelect, Progress, TASK_STATUS, HEALTH, PRIORITY, CountPill, NewTag, GROUP_GOES,
} from '../ui.jsx';
import { ActivityList, Composer, CommentItem, stampReceived } from '../activity.jsx';
import { Board, Cover, Labels, Badges, DueBadge, labelColor } from '../board.jsx';
import { UploadZone, LinkForm, FileCard, FileRow, FilePreview, AddLinkButton } from '../files.jsx';
import { fmtDate, relDay, daysFrom, dueText, inr } from '../format.js';
import { ProjectForm } from './ProjectForm.jsx';
import { TaskModal } from './TaskModal.jsx';
import { toCsv } from './Projects.jsx';

// ---------------------------------------------------------------- header pieces

function StageStepper({ stages, current, onPick, stats, disabled }) {
  const idx = stages.indexOf(current);
  const statFor = (s) => stats?.find((x) => x.stage === s);
  return (
    <div className="stepper stage-stepper">
      {stages.map((s, i) => {
        const st = statFor(s);
        const cls = i < idx ? 'done' : i === idx ? 'current' : '';
        return (
          <button key={s} type="button" className={`step ${cls}`} onClick={() => !disabled && onPick(s)} disabled={disabled} aria-current={i === idx ? 'step' : undefined} title={disabled ? s : `Move project to ${s}`}>
            <span className="c">{i < idx ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
            <span className="l">{s}</span>
            {st && <span className="s">{st.done}/{st.total} tasks</span>}
          </button>
        );
      })}
    </div>
  );
}

function Fact({ icon: Icon, label, children, tone }) {
  return (
    <div className="fact">
      <span className={`fact-ic ${tone || ''}`}><Icon size={18} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="xs muted">{label}</div>
        <div className="b6 small">{children}</div>
      </div>
    </div>
  );
}

// Calls onSeen once, after the tab's data has loaded (so "New" markers still show this visit).
function useSeenOnLoad(data, onSeen) {
  const done = useRef(false);
  useEffect(() => {
    if (data && !done.current) {
      done.current = true;
      onSeen?.();
    }
  }, [data, onSeen]);
}

// ---------------------------------------------------------------- overview

function Milestones({ p, reload }) {
  const { toast, today } = useApp();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const can = p.permissions.contribute;
  const toggle = async (m) => {
    try {
      await api.patch(`/milestones/${m.id}`, { done: !m.done });
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/projects/${p.id}/milestones`, { title, due_date: due || null });
      setTitle('');
      setDue('');
      setAdding(false);
      reload({ quiet: true });
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };
  const remove = async (m) => {
    try {
      await api.del(`/milestones/${m.id}`);
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h3><Flag size={17} color="var(--purple)" />Milestones</h3>
        {can && !adding && <button type="button" className="link" onClick={() => setAdding(true)}><Plus size={14} />Add</button>}
      </div>
      {p.milestones.length === 0 && !adding && <div className="small muted">No milestones yet. Add the dates the client cares about, like design sign-off or handover.</div>}
      <div className="milestones">
        {p.milestones.map((m) => {
          const late = !m.done && m.due_date && m.due_date < today;
          return (
            <div key={m.id} className={`ms ${m.done ? 'done' : ''}`}>
              <button type="button" className={`check-btn ${m.done ? 'on' : ''}`} disabled={!can} aria-label={m.done ? `Reopen ${m.title}` : `Mark ${m.title} reached`} onClick={() => toggle(m)}>{m.done && <Check size={13} strokeWidth={3} />}</button>
              <div className="grow">
                <div className="small b6">{m.title}</div>
                <div className={`xs ${late ? 'red b6' : 'muted'}`}>{m.due_date ? `${fmtDate(m.due_date, { today })} · ${m.done ? 'reached' : late ? `${-daysFrom(today, m.due_date)} days late` : relDay(today, m.due_date)}` : 'No date'}</div>
              </div>
              {can && <button type="button" className="icon-btn sm-x" aria-label={`Remove ${m.title}`} onClick={() => remove(m)}><X size={14} /></button>}
            </div>
          );
        })}
      </div>
      {adding && (
        <form className="col mt-12" style={{ gap: 8 }} onSubmit={add}>
          <input id="ms-title" className="input sm" placeholder="e.g. Client design sign-off" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <div className="row">
            <input id="ms-date" type="date" className="input sm" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Milestone date" />
            <button type="submit" className="btn sm primary">Add</button>
            <button type="button" className="btn sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- client payments

export const PAY_METHODS = { bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', cash: 'Cash', card: 'Card', other: 'Other' };
const toAmount = (v) => Number(String(v).replace(/[,₹\s]/g, ''));

// What is left to collect, in a few words: "₹5,00,000 to collect", "Fully paid".
export function collectText(p) {
  if (p.to_collect == null) return null;
  if (p.to_collect > 0) return `${inr(p.to_collect)} to collect`;
  return p.received > p.budget ? `Paid ${inr(p.received - p.budget)} over budget` : 'Fully paid';
}

function PaymentForm({ p, onClose, onSaved }) {
  const { today } = useApp();
  const [f, setF] = useState({ amount: '', received_on: today, method: 'bank', reference: '', note: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const n = toAmount(f.amount);
  const left = p.to_collect;
  let hint = left ? `${inr(left)} still to collect` : 'As it reached the bank';
  if (n > 0) {
    hint = inr(n);
    if (left != null) hint += n < left ? ` · ${inr(left - n)} left to collect after this` : n === left ? ' · clears the balance' : ` · ${inr(n - left)} more than is left`;
  }
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      await api.post(`/projects/${p.id}/payments`, f);
      onSaved(n);
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  };
  return (
    <Modal title="Record a client payment" sub={[p.client, p.name].filter(Boolean).join(' · ')} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="pay-form" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Record payment'}</button>
      </>}>
      <form id="pay-form" className="modal-body" onSubmit={submit}>
        {err && <div className="alert error mb-12">{err}</div>}
        <div className="form-grid">
          <Field label="Amount received (₹)" htmlFor="pay-amount" hint={hint}>
            <input id="pay-amount" className="input" inputMode="decimal" autoComplete="off" value={f.amount} onChange={set('amount')} placeholder={left ? String(Math.round(left)) : 'e.g. 500000'} required />
          </Field>
          <Field label="Date received" htmlFor="pay-date">
            <input id="pay-date" type="date" className="input" value={f.received_on} max={today} onChange={set('received_on')} required />
          </Field>
          <Field label="Paid by" htmlFor="pay-method">
            <select id="pay-method" className="select" value={f.method} onChange={set('method')}>
              {Object.entries(PAY_METHODS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
          <Field label="Reference" htmlFor="pay-ref" hint="UTR, cheque or transaction number">
            <input id="pay-ref" className="input" value={f.reference} onChange={set('reference')} maxLength={120} autoComplete="off" />
          </Field>
          <Field label="Note" htmlFor="pay-note" className="full" hint="For example: Advance, 40%">
            <input id="pay-note" className="input" value={f.note} onChange={set('note')} maxLength={300} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// The budget, what the client has paid so far and what is still to come.
function Payments({ p, reload }) {
  const { toast, confirm, today } = useApp();
  const [adding, setAdding] = useState(false);
  const [all, setAll] = useState(false);
  const can = p.permissions.edit && p.status !== 'cancelled';
  const budget = p.budget || 0;
  const received = p.received || 0;
  const pct = budget ? Math.min(100, Math.round((received / budget) * 100)) : 0;
  const shown = all ? p.payments : p.payments.slice(0, 4);
  const remove = async (pay) => {
    const ok = await confirm({
      title: `Remove the ${inr(pay.amount)} payment?`,
      message: `Received ${fmtDate(pay.received_on, { year: true })}${pay.note ? ` (${pay.note})` : ''}. The amount goes back to what is still to collect.`,
      confirmLabel: 'Remove payment', danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/payments/${pay.id}`);
      toast('Payment removed', 'success');
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h3><Wallet size={17} color="var(--green)" />Budget & payments</h3>
        {can && <button type="button" className="link" onClick={() => setAdding(true)}><Plus size={14} />Record payment</button>}
      </div>
      <div className="money">
        <div><span className="xs muted">Budget</span><b>{budget ? inr(budget) : '—'}</b></div>
        <div><span className="xs muted">Received</span><b className="green">{inr(received)}</b></div>
        <div>
          <span className="xs muted">To collect</span>
          <b className={p.to_collect > 0 ? (p.status === 'completed' ? 'red' : 'amber') : ''}>{p.to_collect == null ? '—' : inr(p.to_collect)}</b>
        </div>
      </div>
      {budget > 0 && (
        <div className="money-bar" title={`${pct}% of the budget received`}>
          <Progress value={pct} color="var(--green)" />
          <span className="xs muted">{pct}% received{received > budget ? ` · ${inr(received - budget)} over budget` : ''}</span>
        </div>
      )}
      {!budget && <div className="small muted mt-8">No budget set{p.permissions.edit ? '. Add it with Edit to see what is left to collect.' : '.'}</div>}
      {p.status === 'completed' && p.to_collect > 0 && <div className="alert warn mt-12">Delivered, and {inr(p.to_collect)} has still to come from the client.</div>}
      {p.payments.length > 0 && (
        <div className="pay-list">
          {shown.map((pay) => (
            <div key={pay.id} className="pay">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row between gap-6">
                  <b className="small">{inr(pay.amount)}</b>
                  <span className="xs muted nowrap">{fmtDate(pay.received_on, { today })}</span>
                </div>
                <div className="xs muted ellipsis" title={[pay.note, PAY_METHODS[pay.method], pay.reference].filter(Boolean).join(' · ')}>
                  {[pay.note, PAY_METHODS[pay.method], pay.reference].filter(Boolean).join(' · ')}
                </div>
              </div>
              {can && <button type="button" className="icon-btn sm-x" aria-label={`Remove the ${inr(pay.amount)} payment`} onClick={() => remove(pay)}><X size={14} /></button>}
            </div>
          ))}
          {p.payments.length > 4 && <button type="button" className="link mt-8" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${p.payments.length} payments`}</button>}
        </div>
      )}
      {p.payments.length === 0 && budget > 0 && <div className="small muted mt-8">No payments recorded yet.</div>}
      {adding && (
        <PaymentForm p={p} onClose={() => setAdding(false)} onSaved={(n) => { setAdding(false); toast(`${inr(n)} recorded`, 'success'); reload({ quiet: true }); }} />
      )}
    </section>
  );
}

function ProjectTeam({ p, reload }) {
  const { users, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(() => p.members.map((m) => m.id));
  const pool = users.filter((u) => u.role === 'admin' || u.access?.[p.vertical_id]);
  const save = async () => {
    try {
      await api.put(`/projects/${p.id}/members`, { user_ids: [...new Set([...sel, p.owner_id])] });
      setOpen(false);
      reload({ quiet: true });
      toast('Team updated', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h3><Users size={17} color="var(--blue)" />Team <span className="sub">{p.members.length}</span></h3>
        {p.permissions.edit && <button type="button" className="link" onClick={() => { setSel(p.members.map((m) => m.id)); setOpen(true); }}>Manage</button>}
      </div>
      <div className="col" style={{ gap: 10 }}>
        {p.members.map((m) => (
          <div key={m.id} className="person">
            <Avatar name={m.name} color={m.color} size={32} />
            <div style={{ minWidth: 0 }}>
              <div className="pn small ellipsis">{m.name}{m.id === p.owner_id && <span className="badge b-blue" style={{ marginLeft: 6, padding: '1px 7px', fontSize: 11 }}>Owner</span>}</div>
              <div className="ps ellipsis">{m.title}</div>
            </div>
          </div>
        ))}
      </div>
      {p.status === 'planning' && !p.group_started_at && <div className="xs muted mt-12">The team gets a group chat when the project starts.</div>}
      {open && (
        <Modal title="Project team" sub={`People with access to ${p.vertical_name}`} onClose={() => setOpen(false)}
          footer={<><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="btn primary" onClick={save}>Save team</button></>}>
          <div className="modal-body pick-chips">
            {pool.map((u) => (
              <button key={u.id} type="button" className={`pick-chip person-chip ${sel.includes(u.id) || u.id === p.owner_id ? 'on' : ''}`} disabled={u.id === p.owner_id}
                onClick={() => setSel((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))}>
                <Avatar name={u.name} color={u.color} size={20} />{u.name}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

function Overview({ p, reload }) {
  const { today } = useApp();
  return (
    <div className="grid">
      <div className="span-8 col" style={{ gap: 16 }}>
        <section className="card">
          <div className="card-head"><h3>Brief</h3></div>
          {p.description ? <p className="prose" style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p> : <p className="small muted">No brief yet. {p.permissions.edit ? 'Use Edit to add the scope and what the client cares about.' : ''}</p>}
          {p.tags.length > 0 && <div className="row wrap mt-12" style={{ gap: 6 }}>{p.tags.map((t) => <span key={t} className="chip gray">{t}</span>)}</div>}
        </section>
        <section className="card">
          <div className="card-head"><h3>Up next</h3><Link to={`/projects/${p.id}/tasks`} className="link">All tasks</Link></div>
          {p.upcoming_tasks.length === 0 ? <div className="small muted">No open tasks.</div> : p.upcoming_tasks.map((t) => (
            <Link key={t.id} to={`/projects/${p.id}/tasks/${t.id}`} className="list-item plain">
              <span className="dot" style={{ background: TASK_STATUS[t.status].color }} />
              <div className="grow">
                <div className="small b6 ellipsis">{t.title}</div>
                <div className="xs muted">{t.stage} · {TASK_STATUS[t.status].label}</div>
              </div>
              <PriorityFlag priority={t.priority} />
              {t.assignee_name ? <Avatar name={t.assignee_name} color={t.assignee_color} size={26} /> : <span className="xs faint">Unassigned</span>}
              <span className={`xs nowrap ${t.overdue ? 'red b6' : 'muted'}`} style={{ width: 84, textAlign: 'right' }}>{dueText(today, t.due_date)}</span>
            </Link>
          ))}
        </section>
        <section className="card">
          <div className="card-head"><h3>Progress by stage</h3></div>
          <div className="col" style={{ gap: 12 }}>
            {p.stages.map((s) => {
              const st = p.stage_stats.find((x) => x.stage === s) || { total: 0, done: 0 };
              const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
              return (
                <div key={s} className="row" style={{ gap: 12 }}>
                  <span className="small" style={{ width: 130, fontWeight: s === p.stage ? 700 : 500 }}>{s}</span>
                  <div className="grow"><Progress value={pct} color={pct === 100 ? 'var(--green)' : p.vertical_color} /></div>
                  <span className="xs muted" style={{ width: 70, textAlign: 'right' }}>{st.done}/{st.total} done</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      <div className="span-4 col" style={{ gap: 16 }}>
        <Payments p={p} reload={reload} />
        <Milestones p={p} reload={reload} />
        <ProjectTeam p={p} reload={reload} />
        <section className="card">
          <div className="card-head"><h3>Details</h3></div>
          <dl className="kv" style={{ gridTemplateColumns: '110px 1fr' }}>
            <dt>Code</dt><dd>{p.code}</dd>
            <dt>Client</dt><dd>{p.client || '—'}</dd>
            <dt>{p.vertical === 'Marketing' ? 'Channels' : 'Venue'}</dt><dd>{p.venue || '—'}</dd>
            <dt>City</dt><dd>{p.city || '—'}</dd>
            <dt>Priority</dt><dd><PriorityFlag priority={p.priority} label /></dd>
            <dt>Created</dt><dd>{fmtDate(p.created_at?.slice(0, 10), { year: true })}{p.created_by_user ? ` by ${p.created_by_user.name}` : ''}</dd>
            {p.completed_at && <><dt>Delivered</dt><dd>{fmtDate(p.completed_at.slice(0, 10), { year: true })}</dd></>}
          </dl>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tasks

const BOARD_COLS = [
  { key: 'todo', color: '#9aa6b8' },
  { key: 'in_progress', color: '#1a6df0' },
  { key: 'review', color: '#7c5cfc' },
  { key: 'blocked', color: '#e31b3b' },
  { key: 'done', color: '#1fa855' },
];

function TaskCard({ t, today }) {
  const pr = PRIORITY[t.priority];
  return (
    <>
      <Cover file={t.cover} color="#1a6df0" />
      <div className="kb-body">
        <Labels items={[
          t.is_new && { text: 'New', color: '#e31b3b', solid: true },
          t.stage && { text: t.stage, color: labelColor(t.stage) },
          (t.priority === 'high' || t.priority === 'urgent') && { text: pr.label, color: pr.color, solid: true },
        ]} />
        <div className="kb-title">{t.title}</div>
        <div className="kb-meta">
          <Badges checklist={{ done: t.checklist.filter((c) => c.done).length, total: t.checklist.length }} comments={t.comment_count} files={t.file_count}>
            <DueBadge date={t.due_date} today={today} done={t.status === 'done'} />
          </Badges>
          {t.assignee_name && <span className="kb-people"><Avatar name={t.assignee_name} color={t.assignee_color} size={26} /></span>}
        </div>
      </div>
    </>
  );
}

function TaskBoard({ p, tasks, today, onOpen, onMove, onAdd, onSort }) {
  const columns = BOARD_COLS.map((c) => ({
    ...c,
    title: TASK_STATUS[c.key].label,
    canAdd: p.permissions.contribute,
    addPlaceholder: 'What needs doing?',
    cards: tasks.filter((t) => t.status === c.key).sort((a, b) => a.sort - b.sort || a.id - b.id),
  })).map((c) => ({ ...c, fresh: c.cards.filter((t) => t.is_new).length }));
  return (
    <Board id="tasks" columns={columns} renderCard={(t) => <TaskCard t={t} today={today} />} onOpen={onOpen} onMove={onMove} onAdd={onAdd} onSort={onSort}
      canDrag={() => p.permissions.contribute}
      sortOptions={[{ value: 'due', label: 'due date' }, { value: 'priority', label: 'priority' }, { value: 'name', label: 'name' }]} />
  );
}

function QuickAdd({ p, onAdded, defaultStage }) {
  const { assignable, toast } = useApp();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState(null);
  const [due, setDue] = useState('');
  const [stage, setStage] = useState(defaultStage || p.stage);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const t = await api.post(`/projects/${p.id}/tasks`, { title, assignee_id: assignee, due_date: due || null, stage });
      setTitle('');
      onAdded(t);
    } catch (e2) {
      toast(e2.message, 'error');
    }
    setBusy(false);
  };
  return (
    <form className="quick-add" onSubmit={submit}>
      <Plus size={18} className="muted" />
      <input id="qa-title" className="grow qa-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task and press Enter" aria-label="New task title" maxLength={240} />
      <select id="qa-stage" className="select sm" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">{p.stages.map((s) => <option key={s}>{s}</option>)}</select>
      <UserSelect id="qa-assignee" className="select sm" value={assignee} onChange={setAssignee} people={assignable(p.vertical_id)} placeholder="Assign to" />
      <input id="qa-due" type="date" className="input sm" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
      <button type="submit" className="btn sm primary" disabled={busy || !title.trim()}>Add</button>
    </form>
  );
}

function TaskRow({ t, p, onOpen, onToggle, today }) {
  return (
    <div className={`trow ${t.status === 'done' ? 'done' : ''}`}>
      <button type="button" className={`check-btn ${t.status === 'done' ? 'on' : ''}`} disabled={!p.permissions.contribute} onClick={() => onToggle(t)} aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Mark ${t.title} done`}>
        {t.status === 'done' && <Check size={13} strokeWidth={3} />}
      </button>
      <button type="button" className="trow-main" onClick={() => onOpen(t)}>
        <span className="ttitle">{t.is_new && <NewTag />}{t.title}</span>
        <span className="tmeta">
          {t.status !== 'todo' && t.status !== 'done' && <TaskStatusBadge status={t.status} />}
          <PriorityFlag priority={t.priority} />
          {t.checklist.length > 0 && <span className="xs muted nowrap"><Check size={12} /> {t.checklist.filter((c) => c.done).length}/{t.checklist.length}</span>}
          {t.comment_count > 0 && <span className="xs muted nowrap"><MessageSquare size={12} /> {t.comment_count}</span>}
          {t.file_count > 0 && <span className="xs muted nowrap"><Paperclip size={12} /> {t.file_count}</span>}
        </span>
      </button>
      <span className="tassignee">{t.assignee_name ? <><Avatar name={t.assignee_name} color={t.assignee_color} size={26} /><span className="small hide-sm ellipsis">{t.assignee_name.split(' ')[0]}</span></> : <span className="xs faint">Unassigned</span>}</span>
      <span className={`tdue xs ${t.overdue ? 'red b6' : 'muted'}`}>{dueText(today, t.due_date, t.status === 'done')}</span>
    </div>
  );
}

function TasksTab({ p, reloadProject, onSeen }) {
  const { today, me, toast } = useApp();
  const { navigate } = useRouter();
  const [view, setView] = usePref('bpm.tasks.view', 'list');
  const [who, setWho] = useState('');
  const [showDone, setShowDone] = usePref('bpm.tasks.done', true);
  const { data, loading, error, reload, setData } = useLoad(() => api.get(`/projects/${p.id}/tasks`), [p.id]);
  useSeenOnLoad(data, onSeen);
  const tasks = useMemo(() => {
    let list = data?.items || [];
    if (who === 'me') list = list.filter((t) => t.assignee_id === me.id);
    else if (who === 'none') list = list.filter((t) => !t.assignee_id);
    else if (who) list = list.filter((t) => t.assignee_id === Number(who));
    return list;
  }, [data, who, me.id]);
  const people = useMemo(() => {
    const m = new Map();
    for (const t of data?.items || []) if (t.assignee_id) m.set(t.assignee_id, t.assignee_name);
    return [...m.entries()];
  }, [data]);

  const update = async (t, body, msg) => {
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === t.id ? { ...x, ...body } : x)) }));
    try {
      await api.patch(`/tasks/${t.id}`, body);
      if (msg) toast(msg, 'success');
      reload({ quiet: true });
      reloadProject({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };
  const toggle = (t) => update(t, { status: t.status === 'done' ? 'todo' : 'done' });
  const open = (t) => navigate(`/projects/${p.id}/tasks/${t.id}`);
  const exportCsv = () => api.saveText(`${p.code}-tasks.csv`, toCsv([
    ['Stage', 'Task', 'Status', 'Priority', 'Assignee', 'Due', 'Completed'],
    ...(data?.items || []).map((t) => [t.stage, t.title, TASK_STATUS[t.status].label, PRIORITY[t.priority].label, t.assignee_name || '', t.due_date || '', t.completed_at?.slice(0, 10) || '']),
  ])).catch((e) => toast(e.message, 'error'));

  const total = data?.items.length || 0;
  const done = data?.items.filter((t) => t.status === 'done').length || 0;

  return (
    <>
      <div className="row wrap between mb-12" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <Seg value={view} onChange={setView} label="Task view" options={[{ value: 'list', label: 'By stage', icon: LayoutList }, { value: 'board', label: 'Board', icon: Columns3 }]} />
          <select id="tasks-who" className="select sm" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person">
            <option value="">Everyone</option>
            <option value="me">Assigned to me</option>
            <option value="none">Unassigned</option>
            {people.filter(([id]) => id !== me.id).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          {view === 'list' && <label className="check small"><input id="tasks-show-done" type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />Show completed</label>}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="small muted">{done} of {total} done</span>
          <button type="button" className="btn sm" onClick={exportCsv} disabled={!total}><Download size={15} />Export</button>
        </div>
      </div>
      {p.permissions.contribute && <QuickAdd p={p} onAdded={() => { reload({ quiet: true }); reloadProject({ quiet: true }); }} />}
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : total === 0 && view === 'list' ? (
        <div className="card"><Empty title="No tasks yet">{p.permissions.contribute ? 'Add the first task above. Tip: start projects from a template to get a ready-made task list.' : 'Tasks will show here once the team adds them.'}</Empty></div>
      ) : view === 'list' ? (
        <div className="col" style={{ gap: 14 }}>
          {[...p.stages, ...new Set(tasks.map((t) => t.stage).filter((s) => !p.stages.includes(s)))].map((stage) => {
            const list = tasks.filter((t) => (t.stage || p.stages[0]) === stage);
            const shown = showDone ? list : list.filter((t) => t.status !== 'done');
            if (!list.length) return null;
            const d = list.filter((t) => t.status === 'done').length;
            return (
              <section key={stage} className="card flush">
                <div className="stage-head">
                  <b>{stage}</b>
                  {stage === p.stage && <span className="badge b-blue">Current stage</span>}
                  <span className="xs muted">{d}/{list.length} done</span>
                  <div className="grow" style={{ maxWidth: 160, marginLeft: 'auto' }}><Progress value={(d / list.length) * 100} color={d === list.length ? 'var(--green)' : p.vertical_color} height={6} /></div>
                </div>
                {shown.map((t) => <TaskRow key={t.id} t={t} p={p} onOpen={open} onToggle={toggle} today={today} />)}
                {shown.length === 0 && <div className="xs muted" style={{ padding: '10px 16px' }}>All {list.length} tasks done.</div>}
              </section>
            );
          })}
        </div>
      ) : (
        <TaskBoard p={p} tasks={tasks} today={today} onOpen={open} onMove={(t, status, sort) => update(t, status === t.status ? { sort } : { status, sort }, status === t.status ? null : `Moved to ${TASK_STATUS[status].label}`)}
          onAdd={async (col, title) => {
            try {
              await api.post(`/projects/${p.id}/tasks`, { title, status: col.key, assignee_id: who === 'me' ? me.id : who && who !== 'none' ? Number(who) : null });
              reload({ quiet: true });
              reloadProject({ quiet: true });
              return true;
            } catch (e) {
              toast(e.message, 'error');
              return false;
            }
          }}
          onSort={async (col, by) => {
            const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
            const cmp = by === 'due' ? (a, b) => (a.due_date || '9').localeCompare(b.due_date || '9') : by === 'priority' ? (a, b) => rank[a.priority] - rank[b.priority] : (a, b) => a.title.localeCompare(b.title);
            const sorted = [...col.cards].sort(cmp);
            setData((d) => ({ ...d, items: d.items.map((x) => { const i = sorted.findIndex((c) => c.id === x.id); return i === -1 ? x : { ...x, sort: i + 1 }; }) }));
            try {
              for (const [i, c] of sorted.entries()) await api.patch(`/tasks/${c.id}`, { sort: i + 1 });
            } catch (e) {
              toast(e.message, 'error');
            }
            reload({ quiet: true });
          }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- files

function FilesTab({ p, reloadProject, onSeen }) {
  const { categories, me, toast } = useApp();
  const [cat, setCat] = useState('');
  const [layout, setLayout] = usePref('bpm.files.layout', 'grid');
  const [linking, setLinking] = useState(false);
  const [preview, setPreview] = useState(null);
  const { data, loading, error, reload, setData } = useLoad(() => api.get(`/projects/${p.id}/files`), [p.id]);
  useSeenOnLoad(data, onSeen);
  const items = data?.items || [];
  const fresh = (list) => list.filter((f) => f.is_new).length;
  const shown = cat === 'final' ? items.filter((f) => f.is_final) : cat ? items.filter((f) => f.category === cat) : items;
  const counts = Object.fromEntries(categories.map((c) => [c, items.filter((f) => f.category === c).length]));
  const finals = items.filter((f) => f.is_final).length;
  const after = () => { reload({ quiet: true }); reloadProject({ quiet: true }); };
  const toggleFinal = async (f) => {
    setData((d) => ({ ...d, items: d.items.map((x) => (x.id === f.id ? { ...x, is_final: x.is_final ? 0 : 1 } : x)) }));
    try {
      await api.patch(`/files/${f.id}`, { is_final: !f.is_final });
      toast(f.is_final ? 'No longer a final asset' : 'Marked as a final asset', 'success');
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };
  return (
    <>
      {p.permissions.contribute && (
        <div className="row wrap mb-16" style={{ gap: 12, alignItems: 'stretch' }}>
          <div className="grow" style={{ minWidth: 260 }}><UploadZone projectId={p.id} onUploaded={after} /></div>
          <div className="col" style={{ gap: 8, justifyContent: 'center' }}><AddLinkButton onClick={() => setLinking(true)} /></div>
        </div>
      )}
      <div className="row wrap between mb-12" style={{ gap: 10 }}>
        <div className="tabs pills" style={{ marginBottom: 0 }}>
          <button type="button" className={!cat ? 'on' : ''} onClick={() => setCat('')}>All <CountPill n={items.length} fresh={fresh(items)} /></button>
          <button type="button" className={cat === 'final' ? 'on' : ''} onClick={() => setCat('final')}>Final assets <CountPill n={finals} fresh={fresh(items.filter((f) => f.is_final))} /></button>
          {categories.filter((c) => counts[c]).map((c) => <button key={c} type="button" className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c} <CountPill n={counts[c]} fresh={fresh(items.filter((f) => f.category === c))} /></button>)}
        </div>
        <Seg value={layout} onChange={setLayout} label="Layout" options={[{ value: 'grid', icon: Grid2x2, title: 'Grid' }, { value: 'list', icon: List, title: 'List' }]} />
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : shown.length === 0 ? (
        <div className="card"><Empty icon={Paperclip} title={items.length ? 'Nothing in this category' : 'No files yet'}>Keep briefs, designs, POs, invoices and final photos here so the next team can find them.</Empty></div>
      ) : layout === 'grid' ? (
        <div className="fgrid">{shown.map((f) => <FileCard key={f.id} file={f} onOpen={setPreview} onToggleFinal={toggleFinal} canEdit={p.permissions.contribute} />)}</div>
      ) : (
        <div className="card">{shown.map((f) => <FileRow key={f.id} file={f} onOpen={setPreview} />)}</div>
      )}
      {linking && <LinkForm projectId={p.id} onClose={() => setLinking(false)} onSaved={() => { setLinking(false); after(); }} />}
      {preview && (
        <FilePreview file={preview} onClose={() => setPreview(null)} canEdit={p.permissions.contribute}
          canDelete={p.permissions.edit || (preview.uploaded_by === me.id && p.permissions.contribute)}
          onChanged={(f) => { setPreview(f); reload({ quiet: true }); }}
          onDeleted={() => { setPreview(null); after(); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- discussion

function Discussion({ p, onSeen }) {
  const { toast } = useApp();
  const [filter, setFilter] = useState('all');
  const { data, loading, error, reload } = useLoad(() => api.get(`/projects/${p.id}/activity`).then((d) => ({ ...d, comments: stampReceived(d.comments) })), [p.id]);
  useSeenOnLoad(data, onSeen);
  const send = async (body) => {
    try {
      await api.post(`/projects/${p.id}/comments`, { body });
      reload({ quiet: true });
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  const merged = useMemo(() => {
    if (!data) return [];
    const c = data.comments.map((x) => ({ ...x, kind: 'comment' }));
    const a = data.activity.map((x) => ({ ...x, kind: 'activity' }));
    const all = filter === 'comments' ? c : filter === 'activity' ? a : filter === 'requests' ? c.filter((x) => x.delete_status === 'requested') : [...c, ...a];
    return all.sort((x, y) => (y.created_at || '').localeCompare(x.created_at || ''));
  }, [data, filter]);
  const pending = data?.comments.filter((x) => x.delete_status === 'requested').length || 0;
  return (
    <div className="grid">
      <div className="span-8">
        {p.permissions.contribute ? <Composer onSend={send} /> : <div className="alert info mb-12"><Lock size={15} />You have view-only access to {p.vertical_name}.</div>}
        <div className="row between mt-16 mb-8">
          <div className="tabs pills" style={{ marginBottom: 0 }}>
            <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>Everything</button>
            <button type="button" className={filter === 'comments' ? 'on' : ''} onClick={() => setFilter('comments')}>Comments {data && <CountPill n={data.comments.length} fresh={data.comments.filter((x) => x.is_new).length} />}</button>
            <button type="button" className={filter === 'activity' ? 'on' : ''} onClick={() => setFilter('activity')}>Changes</button>
            {pending > 0 && <button type="button" className={filter === 'requests' ? 'on' : ''} onClick={() => setFilter('requests')}>Delete requests <CountPill n={pending} fresh={data.comments.filter((x) => x.delete_status === 'requested' && x.can_decide).length} /></button>}
          </div>
        </div>
        <ErrorNote error={error} retry={reload} />
        {loading && !data ? <Loading /> : merged.length === 0 ? <div className="card"><Empty icon={MessageSquare} title="No updates yet" /></div> : (
          <div className="card">
            <div className="feed">
              {merged.map((x) => x.kind === 'comment' ? (
                <CommentItem key={`c${x.id}`} c={x} onChanged={() => reload({ quiet: true })}
                  taskLink={x.task_title && <span className="muted"> on <Link to={`/projects/${p.id}/tasks/${x.task_id}`}>{x.task_title}</Link></span>} />
              ) : (
                <ActivityList key={`a${x.id}`} items={[x]} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="span-4">
        <section className="card">
          <div className="card-head"><h3>Tips</h3></div>
          <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li>Type <b>@</b> and a teammate's first name to send them a notification.</li>
            <li>Comments on a task also show here, so the whole story stays in one place.</li>
            <li>Every status, stage, date and file change is recorded automatically.</li>
            <li>You can delete a comment for 15 seconds after posting. After that, ask a head of the vertical to approve the deletion. Heads can remove any comment.</li>
            <li>Red counts and NEW tags show what others added since you last opened a tab. They turn grey once you have looked.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export default function Project({ id, tab = 'overview', taskId }) {
  const { today, toast, confirm, refresh, canManage, isAdmin } = useApp();
  const { navigate, back } = useRouter();
  const { markSeen } = useApp();
  const { data: p, loading, error, reload, setData } = useLoad(() => api.get(`/projects/${id}`), [id]);
  // Opening a tab marks it seen: its count turns from red to grey.
  const seen = useMemo(() => Object.fromEntries(['tasks', 'files', 'discussion'].map((tab) => [tab, () => {
    markSeen(`project:${id}:${tab}`);
    setData((d) => (d?.unseen ? { ...d, unseen: { ...d.unseen, [tab]: 0 } } : d));
  }])), [id, markSeen, setData]);
  const [editing, setEditing] = useState(false);
  const [copying, setCopying] = useState(false);

  if (loading && !p) return <Loading />;
  if (error && !p) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
        <Empty icon={Lock} title={error.status === 404 ? 'Project not found' : 'Could not open this project'} action={<Link to="/projects" className="btn">Back to projects</Link>}>
          {error.status === 404 ? 'It may have been deleted, or it belongs to a vertical you do not have access to.' : error.message}
        </Empty>
      </div>
    );
  }
  if (!p) return null;

  const setStatus = async (status, label) => {
    try {
      await api.patch(`/projects/${p.id}`, { status });
      toast(label, 'success');
      reload({ quiet: true });
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const close = async () => {
    const open = p.task_total - p.task_done;
    const ok = await confirm({
      title: `Mark ${p.code} as delivered?`,
      message: `${open ? `${open} task${open > 1 ? 's are' : ' is'} still open. ` : ''}The project moves to Past Projects with all its files and history, and you can reopen it at any time. ${GROUP_GOES}`,
      confirmLabel: 'Mark delivered',
    });
    if (ok) setStatus('completed', 'Project delivered and moved to Past Projects');
  };
  const cancel = async () => {
    const ok = await confirm({
      title: `Cancel ${p.code}?`,
      message: `The project moves to Past Projects with its files and history, and you can reopen it at any time. ${GROUP_GOES}`,
      confirmLabel: 'Cancel project', danger: true,
    });
    if (ok) setStatus('cancelled', 'Project cancelled and moved to Past Projects');
  };
  const del = async () => {
    const ok = await confirm({ title: `Delete ${p.code}?`, message: 'This permanently deletes the project with all its tasks, files and history. Close the project instead if you want to keep a record.', confirmLabel: 'Delete permanently', danger: true });
    if (!ok) return;
    try {
      await api.del(`/projects/${p.id}`);
      toast('Project deleted', 'success');
      refresh();
      navigate('/projects');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const saveTemplate = async () => {
    try {
      const t = await api.post(`/projects/${p.id}/save-template`, { name: `${p.name} (from ${p.code})` });
      toast(`Saved as template “${t.name}”`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const setStage = async (stage) => {
    if (stage === p.stage) return;
    try {
      await api.patch(`/projects/${p.id}`, { stage });
      toast(`Moved to ${stage}`, 'success');
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const setHealth = async (health) => {
    try {
      await api.patch(`/projects/${p.id}`, { health });
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const keyN = p.key_date ? daysFrom(today, p.key_date) : null;
  const tabs = [
    ['overview', 'Overview'],
    ['tasks', 'Tasks', p.task_total, p.unseen?.tasks],
    ['files', 'Files & assets', p.file_count, p.unseen?.files],
    ['activity', 'Discussion', p.comment_total, p.unseen?.discussion],
  ];
  const closed = p.status === 'completed' || p.status === 'cancelled';

  return (
    <>
      <button type="button" className="link mb-12" onClick={() => back(closed ? '/archive' : '/projects')}><ArrowLeft size={15} />Back</button>
      <section className="card phead" style={{ borderTop: `4px solid ${p.vertical_color}` }}>
        <div className="row wrap between" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <VChip name={p.vertical_name} color={p.vertical_color} />
              <span className="small muted b6">{p.code}</span>
              <StatusBadge status={p.status} readyLabel={p.ready_label} />
              {p.permissions.edit ? (
                <select id="ph-health" className="health-select" value={p.health} onChange={(e) => setHealth(e.target.value)} aria-label="Project health" style={{ color: HEALTH[p.health].color }}>
                  {Object.entries(HEALTH).map(([k, h]) => <option key={k} value={k}>● {h.label}</option>)}
                </select>
              ) : <HealthBadge health={p.health} />}
              <PriorityFlag priority={p.priority} label />
              {!p.permissions.contribute && <span className="badge b-gray"><Lock size={12} />View only</span>}
            </div>
            <h1 className="ptitle">{p.name}</h1>
            <div className="sub">{[p.client, p.venue, p.city].filter(Boolean).join(' · ') || 'No client yet'}</div>
          </div>
          <div className="head-actions">
            {p.group && (
              <Link to={`/teams/${p.id}`} className="btn" title="Chat with everyone working on this project">
                <MessagesSquare size={17} />Team group
                {p.group.unread > 0 && <span className="pill-num alert">{p.group.unread}</span>}
              </Link>
            )}
            {p.permissions.edit && p.status === 'planning' && (
              <button type="button" className="btn primary" onClick={() => setStatus('active', 'Project started. Its team group is open.')} title="Moves the project to Active and opens its team group">
                <Play size={16} />Start project
              </button>
            )}
            {p.permissions.edit && !closed && p.status !== 'planning' && p.ready_label && p.status !== 'ready' && (
              <button type="button" className="btn success" onClick={() => setStatus('ready', `Moved to ${p.ready_label}`)} title={`Move to ${p.ready_label}`}><CheckCircle2 size={17} />Mark ready</button>
            )}
            {p.permissions.edit && !closed && p.status !== 'planning' && (!p.ready_label || p.status === 'ready') && <button type="button" className="btn success" onClick={close}><CheckCircle2 size={17} />Mark delivered</button>}
            {p.permissions.edit && closed && <button type="button" className="btn" onClick={() => setStatus('active', 'Project reopened')}><RotateCcw size={16} />Reopen</button>}
            {p.permissions.edit && <button type="button" className="btn" onClick={() => setEditing(true)}><Pencil size={16} />Edit</button>}
            <Menu buttonClass="btn" items={[
              canManage(p.vertical_id) && { label: 'Run again (copy project)', icon: Copy, onClick: () => setCopying(true) },
              canManage(p.vertical_id) && { label: 'Save as template', icon: LayoutTemplate, onClick: saveTemplate },
              p.permissions.edit && !closed && p.ready_label && p.status !== 'ready' && { label: 'Mark delivered', icon: CheckCircle2, onClick: close },
              p.permissions.edit && p.status === 'ready' && { label: 'Back to Active', icon: RotateCcw, onClick: () => setStatus('active', 'Project moved back to Active') },
              p.permissions.edit && !closed && p.status !== 'on_hold' && { label: 'Put on hold', icon: PauseCircle, onClick: () => setStatus('on_hold', 'Project put on hold') },
              p.permissions.edit && p.status === 'on_hold' && { label: 'Resume', icon: RotateCcw, onClick: () => setStatus('active', 'Project resumed') },
              p.permissions.edit && !closed && { label: 'Cancel project', icon: Ban, onClick: cancel },
              isAdmin && { label: 'Delete permanently', icon: Trash2, danger: true, onClick: del },
            ]} />
          </div>
        </div>

        <div className="facts">
          <Fact icon={Diamond} label={p.key_date_label} tone={keyN !== null && keyN < 0 && p.open ? 'red' : ''}>
            {p.key_date ? <>{fmtDate(p.key_date, { today })} <span className={`xs ${keyN < 0 ? 'muted' : keyN <= 7 ? 'amber' : 'muted'}`}>{p.open ? (keyN < 0 ? `${-keyN} days ago` : relDay(today, p.key_date)) : ''}</span></> : 'Not set'}
          </Fact>
          <Fact icon={CalendarRange} label="Start to wrap-up" tone={p.late ? 'red' : ''}>
            {p.start_date ? fmtDate(p.start_date, { today }) : '—'} → {p.due_date ? fmtDate(p.due_date, { today }) : '—'}{p.late && <span className="xs red"> late</span>}
          </Fact>
          <Fact icon={Users} label="Owner">
            <span className="row gap-6"><Avatar name={p.owner_name} color={p.owner_color} size={20} />{p.owner_name || '—'}</span>
          </Fact>
          <Fact icon={IndianRupee} label="Budget" tone={p.status === 'completed' && p.to_collect > 0 ? 'red' : ''}>
            {p.budget ? inr(p.budget) : '—'}
            {collectText(p) && <div className={`xs ${p.to_collect > 0 ? (p.status === 'completed' ? 'red' : 'amber') : 'green'}`}>{collectText(p)}</div>}
          </Fact>
          <Fact icon={MapPin} label="Location">{p.city || p.venue || '—'}</Fact>
          <div className="fact ring-fact">
            <Ring value={p.progress} size={54} stroke={6} color={p.vertical_color} />
            <div className="xs muted">{p.task_done} of {p.task_total} tasks<br />{p.task_overdue > 0 && <span className="red b6">{p.task_overdue} overdue</span>}</div>
          </div>
        </div>

        {p.stages.length > 0 && (
          <StageStepper stages={p.stages} current={p.stage} stats={p.stage_stats} onPick={setStage} disabled={!p.permissions.edit} />
        )}
      </section>

      <div className="tabs mt-16" role="tablist">
        {tabs.map(([k, label, n, fresh]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => navigate(k === 'overview' ? `/projects/${p.id}` : `/projects/${p.id}/${k}`, { replace: true })}>
            {label}<CountPill n={n} fresh={fresh} style={{ marginLeft: 6 }} />
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview p={p} reload={reload} />}
      {tab === 'tasks' && <TasksTab p={p} reloadProject={reload} onSeen={seen.tasks} />}
      {tab === 'files' && <FilesTab p={p} reloadProject={reload} onSeen={seen.files} />}
      {tab === 'activity' && <Discussion p={p} onSeen={seen.discussion} />}

      {taskId && <TaskModal id={taskId} onClose={() => navigate(`/projects/${p.id}/tasks`, { replace: true })} onChanged={() => { reload({ quiet: true }); refresh(); }} />}
      {editing && <ProjectForm project={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload({ quiet: true }); refresh(); }} />}
      {copying && <ProjectForm copyFrom={p} onClose={() => setCopying(false)} onSaved={(np) => { setCopying(false); refresh(); navigate(`/projects/${np.id}`); }} />}
    </>
  );
}
