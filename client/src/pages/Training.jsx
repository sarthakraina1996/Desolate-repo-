// Training: your courses, the catalogue, and HR / manager tracking. Opening a course shows its
// material and your progress; HR and managers also see the people taking it.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlarmClock,
  Archive,
  BookOpen,
  CalendarClock,
  CircleCheck,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  Laptop,
  ListTodo,
  MapPin,
  MonitorPlay,
  PartyPopper,
  Pencil,
  Plus,
  Presentation,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { addDays, fmtDate, fmtDay, fmtShort, pct } from '../lib/format.js';
import {
  Badge,
  Button,
  Card,
  EmployeeSelect,
  Empty,
  ErrorBox,
  Field,
  Input,
  Kpi,
  Loading,
  Menu,
  Modal,
  Person,
  Progress,
  Select,
  Seg,
  SimpleMarkdown,
  Tabs,
  Textarea,
  useConfirm,
} from '../components/ui.jsx';
import { PolicyModal } from './MySpace.jsx';

const FORMAT_ICON = {
  'Online course': Laptop,
  Video: MonitorPlay,
  Classroom: Presentation,
  Reading: BookOpen,
};
const STATUS_TONE = { Completed: 'green', 'In progress': 'blue', Assigned: 'gray', Overdue: 'red' };

// "Tue, 27 Oct, 3:00 PM" from a session's local "YYYY-MM-DDTHH:mm".
function sessionText(s) {
  if (!s) return '';
  const [d, t] = s.split('T');
  const [h, m] = t.split(':').map(Number);
  return `${fmtDay(d)}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// "45 min" or "1h 30m".
const duration = (min) =>
  !min
    ? ''
    : min < 60
      ? `${min} min`
      : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`;

// What's next for an assignment: when it's due, the session, or when it was finished.
function dueText(a) {
  if (a.completed_at) return `Completed ${fmtDate(a.completed_at)}`;
  if (a.status === 'Overdue') return `Overdue since ${fmtShort(a.due_date)}`;
  if (a.format === 'Classroom' && a.session_at) return `Session ${sessionText(a.session_at)}`;
  return a.due_date ? `Due ${fmtShort(a.due_date)}` : 'No due date';
}

// Round icon for a course's format; red when it's overdue.
function FormatIcon({ format, late }) {
  const Icon = FORMAT_ICON[format] || BookOpen;
  return (
    <span className={`tr-ic ${late ? 'late' : ''}`}>
      <Icon size={20} />
    </span>
  );
}

export default function Training() {
  const { user, isHR } = useApp();
  const [sp, setSp] = useSearchParams();
  const tracker = isHR || user.role === 'manager';
  const tabs = [
    user.employeeId && { value: 'mine', label: 'My trainings' },
    { value: 'catalogue', label: 'Catalogue' },
    tracker && { value: 'tracking', label: isHR ? 'Tracking' : 'My team' },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : tabs[0].value;
  const openId = Number(sp.get('open')) || null;
  const [editing, setEditing] = useState(null); // {} for a new course, or the course to edit
  const [tick, setTick] = useState(0); // bumped after a change so the lists reload
  // Sets or clears one query parameter, keeping the others
  const setParam = (k, v) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next);
  };
  const changed = () => setTick((t) => t + 1);
  const open = (cid) => setParam('open', cid);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Training</h1>
          <div className="sub">Courses, workshops and compliance training at BrainADZ.</div>
        </div>
        {isHR && (
          <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>
            New course
          </Button>
        )}
      </div>
      <Tabs
        value={tab}
        onChange={(t) => setParam('tab', t === tabs[0].value ? null : t)}
        tabs={tabs}
      />
      {tab === 'mine' && <MyTrainings key={tick} onOpen={open} />}
      {tab === 'catalogue' && (
        <Catalogue key={tick} onOpen={open} onEdit={setEditing} onChanged={changed} />
      )}
      {tab === 'tracking' && <Tracking key={tick} onOpen={open} />}
      {/* Course viewer and editor */}
      {openId && (
        <CourseModal
          id={openId}
          onClose={() => setParam('open', null)}
          onEdit={setEditing}
          onChanged={changed}
        />
      )}
      {editing && (
        <CourseEditor
          course={editing}
          onClose={() => setEditing(null)}
          onDone={(cid) => {
            setEditing(null);
            changed();
            if (cid) open(cid);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- my trainings
// The signed-in person's courses: what's left to do and what they've finished.
function MyTrainings({ onOpen }) {
  const { data, error, reload } = useApi('/training/mine');
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const s = data.summary;
  const todo = data.items.filter((a) => a.status !== 'Completed');
  const done = data.items.filter((a) => a.status === 'Completed');
  return (
    <div>
      <div className="kpis">
        <Kpi icon={ListTodo} tone="blue" label="To do" value={s.toDo} />
        <Kpi icon={AlarmClock} tone="red" label="Overdue" value={s.overdue} />
        <Kpi icon={CircleCheck} tone="green" label="Completed" value={s.completed} />
        <Kpi
          icon={GraduationCap}
          tone="purple"
          label="Hours of Learning"
          value={s.hours}
          unit="hrs"
        />
      </div>
      <div className="grid">
        <Card className="span-7" title="To do">
          {todo.length ? (
            todo.map((a) => <AssignmentRow key={a.id} a={a} onOpen={onOpen} />)
          ) : (
            <Empty icon={PartyPopper} text="You're all caught up." />
          )}
        </Card>
        <Card className="span-5" title="Completed">
          {done.length ? (
            done.map((a) => <AssignmentRow key={a.id} a={a} onOpen={onOpen} />)
          ) : (
            <Empty icon={GraduationCap} text="Nothing completed yet" />
          )}
        </Card>
      </div>
    </div>
  );
}

// One of your courses as a clickable row.
function AssignmentRow({ a, onOpen }) {
  return (
    <button type="button" className="tr-row" onClick={() => onOpen(a.training_id)}>
      <FormatIcon format={a.format} late={a.status === 'Overdue'} />
      <span className="tr-row-text">
        <b className="ellipsis">{a.title}</b>
        <span className={`xs ${a.status === 'Overdue' ? 'red' : 'muted'}`}>
          {dueText(a)} · {a.format}
          {a.duration_min ? ` · ${duration(a.duration_min)}` : ''}
        </span>
      </span>
      <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
    </button>
  );
}

// ---------------------------------------------------------------- catalogue
// Every course, filterable; HR can edit and archive. HR and managers see completion.
function Catalogue({ onOpen, onEdit, onChanged }) {
  const { isHR, toast } = useApp();
  const { data, error, reload } = useApi('/training/courses');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [run] = useAction(toast);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const shown = data.items.filter(
    (c) =>
      Boolean(c.active) !== archived &&
      (!category || c.category === category) &&
      c.title.toLowerCase().includes(q.trim().toLowerCase()),
  );
  // Archives or restores a course
  const setActive = async (c, active) => {
    if (
      await run(
        () => api.post(`/training/courses/${c.id}/active`, { active }),
        active ? `${c.title} is back in the catalogue` : `${c.title} archived`,
      )
    ) {
      reload();
      onChanged();
    }
  };
  return (
    <div>
      {/* Search and filters */}
      <div className="filters mb-16">
        <Input
          placeholder="Search courses"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="All categories"
          options={data.categories}
          style={{ maxWidth: 200 }}
        />
        {isHR && (
          <label className="check small">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived
          </label>
        )}
      </div>
      {shown.length ? (
        <div className="tr-grid">
          {shown.map((c) => (
            <CourseCard
              key={c.id}
              c={c}
              onOpen={onOpen}
              menu={
                isHR && [
                  { label: 'Edit', icon: Pencil, onClick: () => onEdit(c) },
                  !c.builtIn &&
                    (c.active
                      ? { label: 'Archive', icon: Archive, onClick: () => setActive(c, false) }
                      : { label: 'Restore', icon: RotateCcw, onClick: () => setActive(c, true) }),
                ]
              }
            />
          ))}
        </div>
      ) : (
        <Empty icon={GraduationCap} text="No courses match" />
      )}
    </div>
  );
}

// A course in the catalogue grid.
function CourseCard({ c, onOpen, menu }) {
  const mine = c.mine;
  return (
    <div className="card tr-card">
      <div className="row between">
        <FormatIcon format={c.format} />
        <div className="row wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
          {c.builtIn && <Badge tone="purple">Built-in</Badge>}
          {Boolean(c.mandatory) && <Badge tone="red">Mandatory</Badge>}
          {Boolean(c.open_enrol) && <Badge tone="blue">Open to all</Badge>}
        </div>
      </div>
      <h3 className="mt-12">{c.title}</h3>
      <div className="xs muted">
        {c.category} · {c.format}
        {c.duration_min ? ` · ${duration(c.duration_min)}` : ''}
      </div>
      {c.description && <p className="small tr-desc">{c.description}</p>}
      {c.format === 'Classroom' && c.session_at && (
        <div className="small row gap-6">
          <CalendarClock size={14} /> {sessionText(c.session_at)}
        </div>
      )}
      {/* People progress, for HR and managers */}
      {c.assigned != null && (
        <div className="mt-8">
          <div className="row between xs muted mb-8" style={{ marginBottom: 4 }}>
            <span>
              {c.completed} of {c.assigned} completed
            </span>
            {c.overdue > 0 && <span className="red">{c.overdue} overdue</span>}
          </div>
          <Progress value={pct(c.completed, c.assigned)} color="var(--green)" height={6} />
        </div>
      )}
      <div className="row mt-12" style={{ gap: 8, marginTop: 'auto', paddingTop: 12 }}>
        <Button
          size="sm"
          variant={mine && mine.status !== 'Completed' ? 'primary' : ''}
          onClick={() => onOpen(c.id)}
        >
          {mine ? (mine.status === 'Completed' ? 'View' : 'Continue') : 'Open'}
        </Button>
        {mine && <Badge tone={STATUS_TONE[mine.status]}>{mine.status}</Badge>}
        <span className="grow" />
        {menu && <Menu items={menu} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tracking
// HR (everyone) or a manager (their team): completion, each course's progress, who's overdue.
function Tracking({ onOpen }) {
  const { isHR } = useApp();
  const { data, error, reload } = useApi('/training/tracking');
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const s = data.summary;
  return (
    <div>
      <div className="kpis">
        <Kpi
          icon={GraduationCap}
          tone="blue"
          label="Trainings Assigned"
          value={s.assigned}
          extra={
            <span className="delta">
              <small>{s.people} people</small>
            </span>
          }
        />
        <Kpi icon={CircleCheck} tone="green" label="Completion" value={`${s.completionPct}%`} />
        <Kpi icon={AlarmClock} tone="red" label="Overdue" value={s.overdue} />
        <Kpi
          icon={PartyPopper}
          tone="purple"
          label="Completed This Month"
          value={s.completedThisMonth}
        />
      </div>
      <div className="grid">
        {/* Each course's progress */}
        <Card
          className="span-7"
          flush
          title={isHR ? 'Courses' : 'Your team’s courses'}
          action={
            <Button
              size="sm"
              icon={Download}
              style={{ marginRight: 18 }}
              onClick={() => download('/training/export.csv')}
            >
              CSV
            </Button>
          }
        >
          {data.courses.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 18 }}>Course</th>
                    <th>Completed</th>
                    <th className="hide-sm">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.courses.map((c) => (
                    <tr key={c.id} className="click" onClick={() => onOpen(c.id)}>
                      <td style={{ paddingLeft: 18 }}>
                        <div className="b6">{c.title}</div>
                        <div className="xs muted">
                          {c.category} · {c.format}
                          {c.mandatory ? ' · Mandatory' : ''}
                        </div>
                      </td>
                      <td style={{ minWidth: 150 }}>
                        <div className="small b6">
                          {c.completed} / {c.assigned}
                        </div>
                        <Progress
                          value={pct(c.completed, c.assigned)}
                          color="var(--green)"
                          height={6}
                        />
                      </td>
                      <td className="hide-sm">
                        {c.overdue ? (
                          <Badge tone="red">{c.overdue}</Badge>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={GraduationCap} text="No courses assigned to your team yet" />
          )}
        </Card>
        {/* Who is overdue, oldest first */}
        <Card className="span-5" title="Overdue" sub={data.overdue.length || undefined}>
          {data.overdue.length ? (
            <div className="tr-scroll">
              {data.overdue.map((a) => (
                <div
                  key={a.id}
                  className="list-item"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onOpen(a.training_id)}
                >
                  <Person
                    name={a.name}
                    sub={a.title}
                    id={a.employee_id}
                    hasPhoto={a.has_photo}
                    size={32}
                    link={false}
                  />
                  <span className="grow" />
                  <span className="xs red nowrap">since {fmtShort(a.due_date)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={PartyPopper} text="No one is overdue" />
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- course viewer
// A course: its material and your progress, plus (HR / managers) the people taking it.
function CourseModal({ id, onClose, onEdit, onChanged }) {
  const { toast, isHR, user } = useApp();
  const { data, error, reload } = useApi(`/training/courses/${id}`);
  const [view, setView] = useState('course');
  const [assigning, setAssigning] = useState(false);
  const [policy, setPolicy] = useState(false);
  const [run, busy] = useAction(toast);
  // Reloads this course and the lists behind it
  const done = () => {
    reload();
    onChanged();
  };
  if (error && !data)
    return (
      <Modal title="Training" onClose={onClose}>
        <ErrorBox error={error} onRetry={reload} />
      </Modal>
    );
  if (!data)
    return (
      <Modal title="Training" onClose={onClose}>
        <Loading />
      </Modal>
    );
  const c = data.course;
  const people = data.people;
  return (
    <Modal
      title={c.title}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {isHR && (
            <Button icon={Pencil} onClick={() => onEdit(c)}>
              Edit course
            </Button>
          )}
          <span className="grow" />
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {/* Course summary */}
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <FormatIcon format={c.format} />
        <Badge tone="gray">{c.category}</Badge>
        <Badge tone="gray">{c.format}</Badge>
        {Boolean(c.mandatory) && <Badge tone="red">Mandatory</Badge>}
        {c.builtIn && <Badge tone="purple">Built-in</Badge>}
        {!c.active && <Badge tone="amber">Archived</Badge>}
        {c.duration_min ? <span className="small muted">{duration(c.duration_min)}</span> : null}
      </div>
      {people && (
        <Tabs
          variant="pills"
          value={view}
          onChange={setView}
          tabs={[
            { value: 'course', label: 'Course' },
            { value: 'people', label: `People (${people.length})` },
          ]}
        />
      )}
      {view === 'course' ? (
        <CourseBody
          data={data}
          busy={busy}
          run={run}
          user={user}
          onDone={done}
          onPolicy={() => setPolicy(true)}
        />
      ) : (
        <People course={c} people={people} onAssign={() => setAssigning(true)} onDone={done} />
      )}
      {assigning && <AssignModal course={c} onClose={() => setAssigning(false)} onDone={done} />}
      {policy && data.policy && (
        <PolicyModal id={data.policy.id} onClose={() => setPolicy(false)} onDone={() => {}} />
      )}
    </Modal>
  );
}

// The material for each format, and the signed-in person's progress and actions.
function CourseBody({ data, busy, run, user, onDone, onPolicy }) {
  const c = data.course;
  const a = data.mine;
  const [cert, setCert] = useState(null);
  // Opening an online course or video counts as starting it
  const openLink = () => {
    window.open(c.link, '_blank', 'noopener,noreferrer');
    if (a && !a.started_at && !a.completed_at)
      api
        .post(`/training/assignments/${a.id}/start`)
        .then(onDone)
        .catch(() => {});
  };
  // Marks your own course complete, with the certificate when it asks for one
  const complete = async () => {
    const form = new FormData();
    if (cert) form.append('certificate', cert);
    if (
      await run(
        () => api.upload(`/training/assignments/${a.id}/complete`, form),
        `Well done! ${c.title} is complete.`,
      )
    )
      onDone();
  };
  const enrol = async () => {
    if (await run(() => api.post(`/training/courses/${c.id}/enrol`), 'Added to your trainings'))
      onDone();
  };
  let host = '';
  try {
    host = c.link ? new URL(c.link).host : '';
  } catch {
    // Not a valid URL; the server only stores web links, so this shouldn't happen
  }
  return (
    <div>
      {c.description && <p style={{ marginTop: 0, lineHeight: 1.55 }}>{c.description}</p>}
      {/* Online course or video: open it in a new tab */}
      {c.link && (
        <div className="tr-box">
          {c.format === 'Video' ? <MonitorPlay size={20} /> : <Laptop size={20} />}
          <span className="grow small">
            {c.format === 'Video' ? 'Watch the video' : 'Take the course'} on <b>{host}</b>
          </span>
          <Button size="sm" variant="primary" icon={ExternalLink} onClick={openLink}>
            {c.format === 'Video' ? 'Watch' : 'Open course'}
          </Button>
        </div>
      )}
      {/* Classroom: when and where */}
      {c.format === 'Classroom' && (
        <div className="tr-box">
          <CalendarClock size={20} />
          <span className="grow small">
            <b>{sessionText(c.session_at)}</b>
            {c.venue && (
              <span className="row gap-6 muted">
                <MapPin size={13} /> {c.venue}
              </span>
            )}
          </span>
        </div>
      )}
      {/* Reading in the app */}
      {c.content && (
        <div className="tr-reading">
          <SimpleMarkdown text={c.content} />
        </div>
      )}
      {/* Attached material and the linked policy */}
      {(c.file || data.policy) && (
        <div className="row wrap mt-12" style={{ gap: 8 }}>
          {c.file && (
            <Button
              size="sm"
              icon={Download}
              onClick={() => download(`/training/courses/${c.id}/material`)}
            >
              {c.file_name || 'Download material'}
            </Button>
          )}
          {data.policy && (
            <Button size="sm" icon={FileText} onClick={onPolicy}>
              Read the {data.policy.title}
            </Button>
          )}
        </div>
      )}
      {/* Your progress */}
      {a ? (
        <div
          className={`tr-progress ${a.status === 'Completed' ? 'done' : a.status === 'Overdue' ? 'late' : ''}`}
        >
          <div className="row between wrap" style={{ gap: 8 }}>
            <span className="row gap-6">
              <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
              <span className="small">
                {a.status === 'Overdue'
                  ? `Was due ${fmtShort(a.due_date)}`
                  : dueText({ ...a, format: c.format, session_at: c.session_at })}
              </span>
            </span>
            {a.certificate && (
              <Button
                size="sm"
                variant="ghost"
                icon={Download}
                onClick={() => download(`/training/assignments/${a.id}/certificate`)}
              >
                Certificate
              </Button>
            )}
          </div>
          {a.status !== 'Completed' &&
            (c.format === 'Classroom' ? (
              <div className="small muted mt-8">
                Your attendance is marked by HR or your manager after the session.
              </div>
            ) : (
              <div className="row wrap mt-12" style={{ gap: 10, alignItems: 'flex-end' }}>
                {Boolean(c.needs_certificate) && (
                  <Field label="Your certificate (PDF or photo)" className="grow">
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => setCert(e.target.files[0] || null)}
                    />
                  </Field>
                )}
                <Button
                  variant="primary"
                  icon={CircleCheck}
                  loading={busy}
                  disabled={Boolean(c.needs_certificate) && !cert}
                  onClick={complete}
                >
                  I have completed this
                </Button>
              </div>
            ))}
        </div>
      ) : (
        user.employeeId &&
        c.active && (
          <div className="tr-progress">
            {c.open_enrol ? (
              <div className="row between wrap" style={{ gap: 8 }}>
                <span className="small">Open to everyone. Join to add it to your trainings.</span>
                <Button variant="primary" icon={Plus} loading={busy} onClick={enrol}>
                  Join this course
                </Button>
              </div>
            ) : (
              <span className="small muted">HR or your manager assigns this course.</span>
            )}
          </div>
        )
      )}
    </div>
  );
}

// HR / manager view of a course: who has it, their progress, and the actions on them.
function People({ course, people, onAssign, onDone }) {
  const { isHR, toast } = useApp();
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const pending = people.filter((p) => p.status !== 'Completed').length;
  // Marks someone complete (classroom attendance, or done outside the HRMS)
  const markDone = async (p) => {
    if (
      await run(
        () => api.upload(`/training/assignments/${p.id}/complete`, new FormData()),
        `${p.name} marked complete`,
      )
    )
      onDone();
  };
  const unassign = async (p) => {
    if (
      await confirm({
        title: `Remove ${course.title} from ${p.name}?`,
        text: 'Their progress on it is deleted.',
        danger: true,
        confirmLabel: 'Remove',
      })
    ) {
      if (await run(() => api.del(`/training/assignments/${p.id}`), 'Removed')) onDone();
    }
  };
  const remind = async () => {
    await run(
      () => api.post(`/training/courses/${course.id}/remind`),
      (r) => `Reminder sent to ${r.sent} people`,
    );
  };
  return (
    <div>
      <div className="row wrap mb-12" style={{ gap: 8 }}>
        {course.active ? (
          <Button size="sm" variant="primary" icon={UserPlus} onClick={onAssign}>
            Assign people
          </Button>
        ) : null}
        {pending > 0 && (
          <Button size="sm" icon={Send} loading={busy} onClick={remind}>
            Remind {pending} not finished
          </Button>
        )}
      </div>
      {people.length ? (
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th className="hide-sm">Due</th>
                <th className="hide-sm">Completed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Person
                      name={p.name}
                      sub={p.department || p.designation}
                      id={p.employee_id}
                      hasPhoto={p.has_photo}
                      size={30}
                    />
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </td>
                  <td className="hide-sm small nowrap">
                    {p.due_date ? fmtShort(p.due_date) : '—'}
                  </td>
                  <td className="hide-sm small nowrap">
                    {p.completed_at ? fmtShort(p.completed_at) : '—'}
                  </td>
                  <td className="right nowrap">
                    {p.certificate && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={Download}
                        aria-label={`${p.name}'s certificate`}
                        onClick={() => download(`/training/assignments/${p.id}/certificate`)}
                      />
                    )}
                    {!p.completed_at && (
                      <Button size="xs" onClick={() => markDone(p)}>
                        {course.format === 'Classroom' ? 'Attended' : 'Mark done'}
                      </Button>
                    )}
                    {isHR && !course.builtIn && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={Trash2}
                        aria-label={`Remove from ${p.name}`}
                        onClick={() => unassign(p)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty icon={UserPlus} text="No one has this course yet" />
      )}
      {confirmEl}
    </div>
  );
}

// Assigns a course: HR to everyone, a department, a vertical or chosen people; managers to people.
function AssignModal({ course, onClose, onDone }) {
  const { meta, isHR, toast } = useApp();
  const [to, setTo] = useState('people');
  const [people, setPeople] = useState([]); // [{ id, name }]
  const [group, setGroup] = useState('');
  const [due, setDue] = useState(
    course.format === 'Classroom' && course.session_at
      ? course.session_at.slice(0, 10)
      : course.due_days
        ? addDays(meta.today, course.due_days)
        : '',
  );
  const [run, busy] = useAction(toast);
  const save = async () => {
    const r = await run(
      () =>
        api.post(`/training/courses/${course.id}/assign`, {
          to,
          ids: people.map((p) => p.id),
          group_id: group || null,
          due_date: due || null,
        }),
      (x) =>
        `${x.added} ${x.added === 1 ? 'person' : 'people'} added${x.already ? ` (${x.already} already had it)` : ''}`,
    );
    if (r) {
      onDone();
      onClose();
    }
  };
  const ready = to === 'everyone' || (to === 'people' ? people.length > 0 : Boolean(group));
  return (
    <Modal
      title={`Assign ${course.title}`}
      size="narrow"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={save}>
            Assign
          </Button>
        </>
      }
    >
      {isHR && (
        <Field label="Who takes it">
          <Seg
            value={to}
            onChange={(v) => {
              setTo(v);
              setGroup('');
            }}
            options={[
              { value: 'people', label: 'People' },
              { value: 'department', label: 'Department' },
              { value: 'vertical', label: 'Vertical' },
              { value: 'everyone', label: 'Everyone' },
            ]}
          />
        </Field>
      )}
      {to === 'people' && (
        <Field label={isHR ? 'People' : 'People in your team'}>
          {people.length > 0 && (
            <div className="row wrap mb-8" style={{ gap: 6 }}>
              {people.map((p) => (
                <span key={p.id} className="chip gray">
                  {p.name}
                  <button
                    type="button"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => setPeople(people.filter((x) => x.id !== p.id))}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <EmployeeSelect
            value=""
            placeholder="Add a person"
            exclude={people.map((p) => p.id)}
            onChange={(e) => {
              if (e.target.value)
                setPeople([
                  ...people,
                  {
                    id: Number(e.target.value),
                    name: e.target.selectedOptions[0].text.split(' · ')[0],
                  },
                ]);
            }}
          />
        </Field>
      )}
      {to === 'department' && (
        <Field label="Department">
          <Select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Choose a department"
            options={meta.departments.map((d) => ({ value: d.id, label: d.name }))}
          />
        </Field>
      )}
      {to === 'vertical' && (
        <Field label="Vertical">
          <Select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="Choose a vertical"
            options={meta.verticals.map((v) => ({ value: v.id, label: v.name }))}
          />
        </Field>
      )}
      <Field
        label="Due date"
        hint="Leave blank for no deadline. People who already have the course keep theirs."
      >
        <Input type="date" value={due} min={meta.today} onChange={(e) => setDue(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- course editor
// Creates or edits a course (HR). Built-in courses keep their format and stay mandatory.
function CourseEditor({ course, onClose, onDone }) {
  const { toast } = useApp();
  const isNew = !course.id;
  const builtIn = Boolean(course.system_key);
  const [f, setF] = useState(() => ({
    title: course.title || '',
    category: course.category || 'Skills',
    format: course.format || 'Online course',
    description: course.description || '',
    link: course.link || '',
    session_at: course.session_at || '',
    venue: course.venue || '',
    content: course.content || '',
    duration_min: course.duration_min ?? '',
    due_days: course.due_days ?? '',
    policy_id: course.policy_id ?? '',
    mandatory: Boolean(course.mandatory),
    open_enrol: Boolean(course.open_enrol),
    auto_new_joiners: Boolean(course.auto_new_joiners),
    needs_certificate: Boolean(course.needs_certificate),
  }));
  const [file, setFile] = useState(null);
  const { data: policies } = useApi('/policies');
  const { data: lists } = useApi('/training/courses');
  const [run, busy] = useAction(toast);
  const set = (k) => (e) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  // Sends the form, with the attached file if there is one
  const save = async () => {
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) form.append(k, typeof v === 'boolean' ? String(v) : v);
    if (file) form.append('file', file);
    const r = await run(
      () =>
        api.upload(
          isNew ? '/training/courses' : `/training/courses/${course.id}`,
          form,
          isNew ? 'POST' : 'PUT',
        ),
      isNew ? 'Course created' : 'Course saved',
    );
    if (r) onDone(isNew ? r.id : course.id);
  };
  const online = f.format === 'Online course' || f.format === 'Video';
  return (
    <Modal
      title={isNew ? 'New course' : `Edit ${course.title}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {isNew ? 'Create course' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Title" className="full">
          <Input
            value={f.title}
            onChange={set('title')}
            maxLength={120}
            placeholder="e.g. Client presentation skills"
          />
        </Field>
        <Field label="Category">
          <Select
            value={f.category}
            onChange={set('category')}
            options={lists?.categories || [f.category]}
          />
        </Field>
        <Field label="Format">
          <Select
            value={f.format}
            onChange={set('format')}
            disabled={builtIn}
            options={lists?.formats || [f.format]}
          />
        </Field>
        <Field label="What it covers" className="full">
          <Textarea
            value={f.description}
            onChange={set('description')}
            maxLength={1000}
            style={{ minHeight: 70 }}
          />
        </Field>
        {online && (
          <Field
            label={f.format === 'Video' ? 'Video link' : 'Course link'}
            hint="The full web address, starting with https://"
            className="full"
          >
            <Input value={f.link} onChange={set('link')} placeholder="https://" />
          </Field>
        )}
        {f.format === 'Classroom' && (
          <>
            <Field label="Session date and time">
              <Input type="datetime-local" value={f.session_at} onChange={set('session_at')} />
            </Field>
            <Field label="Where">
              <Input
                value={f.venue}
                onChange={set('venue')}
                maxLength={120}
                placeholder="e.g. Bengaluru office, Training room 2"
              />
            </Field>
          </>
        )}
        {(f.format === 'Reading' || f.content) && (
          <Field
            label="Reading"
            hint="Use ## for headings and - for bullet points"
            className="full"
          >
            <Textarea value={f.content} onChange={set('content')} style={{ minHeight: 180 }} />
          </Field>
        )}
        <Field
          label="Material (slides, handbook)"
          hint="PDF, PowerPoint, Word or Excel, up to 25 MB"
          className="full"
        >
          <input
            type="file"
            accept=".pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
          {course.file_name && !file && (
            <div className="xs muted mt-8">Current: {course.file_name}</div>
          )}
        </Field>
        <Field label="Length (minutes)">
          <Input type="number" min="1" value={f.duration_min} onChange={set('duration_min')} />
        </Field>
        <Field label="Days to finish" hint="Sets the due date when people are given it">
          <Input type="number" min="1" max="365" value={f.due_days} onChange={set('due_days')} />
        </Field>
        <Field
          label="Linked policy"
          hint="Shown as “Read the policy” in the course"
          className="full"
        >
          <Select
            value={f.policy_id}
            onChange={set('policy_id')}
            placeholder="None"
            options={(policies?.items || []).map((p) => ({ value: p.id, label: p.title }))}
          />
        </Field>
        <div className="full tr-checks">
          <label className="check">
            <input
              type="checkbox"
              checked={f.mandatory}
              disabled={builtIn}
              onChange={set('mandatory')}
            />
            Mandatory
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={f.auto_new_joiners}
              disabled={builtIn}
              onChange={set('auto_new_joiners')}
            />
            Give to every new joiner
          </label>
          <label className="check">
            <input type="checkbox" checked={f.open_enrol} onChange={set('open_enrol')} />
            Anyone can join
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={f.needs_certificate}
              onChange={set('needs_certificate')}
            />
            People upload a certificate to finish
          </label>
        </div>
      </div>
    </Modal>
  );
}
