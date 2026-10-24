// Housekeeping: room status board (occupancy, cleanliness, DND, maintenance held separately),
// today's task schedule with assignment, the attendant's mobile task list, supervisor
// inspection and productivity.
import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Play, Sparkles, UserRound, XCircle, BarChart3, LayoutGrid } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, usePref } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { date, dateTime, number, titleCase } from '../lib/format.js';
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, Notice, PageHead, ROOM_CODES, RoomCode, Select, Tabs, useAction } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';

const TASK_TONE = { open: '', in_progress: 'violet', done: 'info', inspected: 'good', failed: 'danger', cancelled: '' };
const KIND_LABEL = { departure: 'Departure clean', stayover: 'Stayover', deep: 'Deep clean', turndown: 'Turndown', touch_up: 'Touch-up' };

export default function Housekeeping() {
  const { property, opProperty, properties, setScope, can } = useApp();
  const prop = property || opProperty;
  const supervisor = can('housekeeping.assign');
  const [tab, setTab] = usePref('hk-tab', supervisor ? 'board' : 'mine');
  const board = useApi(prop ? `/housekeeping/board${qs({ property: prop.id })}` : null);
  const [run, busy] = useAction();
  if (!prop) return null;
  const tasks = board.data?.tasks || [];
  return (
    <>
      <PageHead title="Housekeeping Management" sub={`${prop.name} · ${date(board.data?.businessDate || prop.business_date)}${board.data?.inspectionRequired ? ' · supervisor inspection required' : ''}`}>
        {properties.length > 1 && <Select aria-label="Property" value={prop.id} onChange={(e) => setScope(e.target.value)} options={properties.map((p) => ({ value: p.id, label: p.name }))} />}
        {supervisor && (
          <Button icon={Sparkles} busy={busy} onClick={() => run(async () => { const r = await api.post('/housekeeping/schedule', { propertyId: prop.id }); board.reload(); return r; }, { success: (r) => `${r.created} task(s) added to today’s schedule` })}>
            Generate today’s schedule
          </Button>
        )}
      </PageHead>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          ...(supervisor ? [{ value: 'board', label: 'Room status', icon: LayoutGrid }] : []),
          ...(supervisor ? [{ value: 'tasks', label: 'Task assignment', icon: ClipboardCheck, count: tasks.filter((t) => !['inspected', 'cancelled'].includes(t.status)).length }] : []),
          { value: 'mine', label: 'My tasks', icon: UserRound },
          ...(supervisor ? [{ value: 'productivity', label: 'Productivity', icon: BarChart3 }] : []),
        ]}
      />
      {tab === 'board' && <Async q={board}>{(b) => <StatusBoard b={b} reload={board.reload} />}</Async>}
      {tab === 'tasks' && <Async q={board}>{(b) => <TaskTable b={b} prop={prop} reload={board.reload} />}</Async>}
      {tab === 'mine' && <MyTasks prop={prop} onChange={board.reload} />}
      {tab === 'productivity' && <Productivity prop={prop} />}
    </>
  );
}

function StatusBoard({ b, reload }) {
  const [code, setCode] = useState('');
  const [room, setRoom] = useState(null);
  const rooms = b.rooms.filter((r) => !code || r.code === code || (code === 'DND' && r.dnd) || (code === 'MR' && r.maintenance_flag === 'required'));
  return (
    <div className="stack">
      <div className="status-counts">
        {[...Object.keys(ROOM_CODES)].map((k) => (
          <button key={k} className={`status-count ${code === k ? 'on' : ''}`} onClick={() => setCode(code === k ? '' : k)}>
            <div className="row">
              <span className="n num">{b.counts[k] || 0}</span>
              <span className="spacer" />
              <RoomCode code={k} short />
            </div>
            <div className="small muted">{ROOM_CODES[k].label}</div>
          </button>
        ))}
        <button className={`status-count ${code === 'DND' ? 'on' : ''}`} onClick={() => setCode(code === 'DND' ? '' : 'DND')}>
          <span className="n num">{b.dnd}</span>
          <div className="small muted">Do not disturb</div>
        </button>
        <button className={`status-count ${code === 'MR' ? 'on' : ''}`} onClick={() => setCode(code === 'MR' ? '' : 'MR')}>
          <span className="n num">{b.maintenanceRequired}</span>
          <div className="small muted">Maintenance required</div>
        </button>
      </div>
      <Card flush>
        <DataTable
          rows={rooms}
          pageSize={50}
          onRowClick={setRoom}
          empty={<Empty title="No rooms in this status" />}
          exportName={`room-status-${b.businessDate}.csv`}
          columns={[
            { key: 'number', label: 'Room', render: (r) => <b>{r.number}</b>, value: (r) => r.number.padStart(6, '0') },
            { key: 'type_name', label: 'Type' },
            { key: 'floor_level', label: 'Floor', num: true },
            { key: 'occupied', label: 'Occupancy', render: (r) => (r.occupied ? `Occupied${r.occupant?.dueOut ? ' · due out' : ''}` : 'Vacant'), value: (r) => (r.occupied ? 1 : 0) },
            { key: 'hk_status', label: 'Housekeeping', render: (r) => <Badge tone={{ inspected: 'teal', clean: 'good', dirty: 'warn', cleaning: 'violet' }[r.hk_status]}>{titleCase(r.hk_status)}</Badge> },
            { key: 'code', label: 'Status', render: (r) => <RoomCode code={r.code} /> },
            { key: 'flags', label: 'Service', sortable: false, render: (r) => <span className="row">{r.dnd ? <Badge tone="violet">DND</Badge> : null}{r.maintenance_flag === 'required' ? <Badge tone="warn" title={r.maintenance_note}>Maintenance</Badge> : null}</span> },
            { key: 'arrival', label: 'Next arrival', render: (r) => (r.arrival ? `${r.arrival.vip ? '★ ' : ''}${r.arrival.guest}` : '—'), value: (r) => (r.arrival ? 0 : 1) },
            { key: 'task', label: 'Today’s task', sortable: false, render: (r) => { const t = b.tasks.find((x) => x.room_id === r.id); return t ? <Badge tone={TASK_TONE[t.status]}>{KIND_LABEL[t.kind]} · {titleCase(t.status)}</Badge> : '—'; } },
          ]}
        />
      </Card>
      {room && <RoomStatusModal room={room} onClose={() => setRoom(null)} onDone={() => { setRoom(null); reload(); }} />}
    </div>
  );
}

function RoomStatusModal({ room, onClose, onDone }) {
  const { can } = useApp();
  const [run, busy] = useAction();
  const set = (body, msg) => run(async () => { await api.put(`/housekeeping/rooms/${room.id}/status`, body); onDone(); }, { success: msg });
  const [note, setNote] = useState(room.maintenance_note || '');
  return (
    <Modal title={`Room ${room.number} · ${room.type_name}`} onClose={onClose}>
      <div className="stack">
        <div className="row wrap">
          <RoomCode code={room.code} />
          {room.occupant && <span className="small">Guest: {room.occupant.guest}</span>}
        </div>
        <div className="small strong">Cleanliness</div>
        <div className="row wrap">
          <Button busy={busy} onClick={() => set({ hk_status: 'dirty', reason: 'Set by housekeeping' }, 'Marked dirty')}>Dirty</Button>
          <Button busy={busy} onClick={() => set({ hk_status: 'cleaning' }, 'Cleaning in progress')}>Cleaning</Button>
          <Button busy={busy} onClick={() => set({ hk_status: 'clean' }, 'Marked clean')}>Clean</Button>
          {can('housekeeping.inspect') && (
            <Button variant="primary" busy={busy} disabled={!['clean', 'inspected'].includes(room.hk_status)} onClick={() => set({ hk_status: 'inspected' }, 'Inspected — ready to sell')}>
              Inspected
            </Button>
          )}
        </div>
        <div className="small strong">Service</div>
        <div className="row">
          <Button busy={busy} onClick={() => set({ dnd: !room.dnd }, room.dnd ? 'DND cleared' : 'Do not disturb set')}>{room.dnd ? 'Clear Do Not Disturb' : 'Set Do Not Disturb'}</Button>
        </div>
        <div className="small strong">Maintenance</div>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs fixing" />
        </Field>
        <div className="row">
          <Button busy={busy} onClick={() => set({ maintenance_flag: 'required', maintenance_note: note }, 'Maintenance requested')}>Maintenance required</Button>
          <Button busy={busy} onClick={() => set({ maintenance_flag: 'ok' }, 'Maintenance cleared')}>Clear</Button>
        </div>
        {!can('housekeeping.inspect') && <div className="small muted">Only a supervisor can mark a room inspected.</div>}
      </div>
    </Modal>
  );
}

function TaskActions({ t, onDone, attendants }) {
  const { can, user } = useApp();
  const [run, busy] = useAction();
  const [fail, setFail] = useState(false);
  const [notes, setNotes] = useState('');
  const call = (path, body, msg) => run(async () => { await api.post(`/housekeeping/tasks/${t.id}/${path}`, body); onDone(); }, { success: msg });
  const mine = t.attendant_id === user.id || can('housekeeping.assign');
  return (
    <div className="row" onClick={(e) => e.stopPropagation()}>
      {attendants && !['inspected', 'cancelled'].includes(t.status) && (
        <Select aria-label="Attendant" value={t.attendant_id || ''} placeholder="Unassigned" options={attendants.map((a) => ({ value: a.id, label: a.name }))} onChange={(e) => e.target.value && call('assign', { attendantId: Number(e.target.value) }, 'Assigned')} style={{ height: 28 }} />
      )}
      {t.status === 'open' && mine && (
        <Button size="sm" icon={Play} busy={busy} disabled={Boolean(t.dnd)} title={t.dnd ? 'Room is on Do Not Disturb' : undefined} onClick={() => call('start', {}, `Started room ${t.room_number}`)}>
          Start
        </Button>
      )}
      {t.status === 'in_progress' && mine && (
        <Button size="sm" variant="primary" icon={CheckCircle2} busy={busy} onClick={() => call('complete', {}, `Room ${t.room_number} cleaned`)}>
          Done
        </Button>
      )}
      {t.status === 'done' && can('housekeeping.inspect') && (
        <>
          <Button size="sm" variant="primary" busy={busy} onClick={() => call('inspect', { pass: true }, `Room ${t.room_number} passed inspection`)}>
            Pass
          </Button>
          <Button size="sm" icon={XCircle} onClick={() => setFail(true)}>
            Fail
          </Button>
        </>
      )}
      {fail && (
        <Modal
          title={`Fail inspection — room ${t.room_number}`}
          onClose={() => setFail(false)}
          footer={
            <>
              <Button onClick={() => setFail(false)}>Cancel</Button>
              <Button variant="accent" busy={busy} disabled={!notes} onClick={() => call('inspect', { pass: false, notes }, 'Sent back for re-cleaning').then(() => setFail(false))}>
                Send back
              </Button>
            </>
          }
        >
          <Field label="What needs re-doing">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function TaskTable({ b, prop, reload }) {
  const attendants = useApi(`/housekeeping/attendants${qs({ property: prop.id })}`);
  const [status, setStatus] = useState('');
  const rows = b.tasks.filter((t) => !status || t.status === status);
  return (
    <Card flush title="Today’s tasks" sub={`${b.tasks.length} task(s) · ${b.tasks.filter((t) => t.status === 'inspected').length} inspected`} action={<Select value={status} placeholder="All statuses" onChange={(e) => setStatus(e.target.value)} options={['open', 'in_progress', 'done', 'inspected'].map((s) => ({ value: s, label: titleCase(s) }))} />}>
      <DataTable
        rows={rows}
        pageSize={50}
        empty={<Empty title="No tasks yet">Tasks are created automatically at checkout, or with “Generate today’s schedule”.</Empty>}
        columns={[
          { key: 'priority', label: 'Priority', render: (t) => (t.priority >= 2 ? <Badge tone="danger">Arrival waiting</Badge> : t.priority === 1 ? <Badge tone="warn">High</Badge> : <Badge>Normal</Badge>), value: (t) => -t.priority },
          { key: 'room_number', label: 'Room', render: (t) => <b>{t.room_number}</b> },
          { key: 'room_type_code', label: 'Type' },
          { key: 'kind', label: 'Task', render: (t) => KIND_LABEL[t.kind] },
          { key: 'status', label: 'Status', render: (t) => <Badge tone={TASK_TONE[t.status]}>{titleCase(t.status)}</Badge> },
          { key: 'attendant_name', label: 'Attendant', render: (t) => t.attendant_name || '—' },
          { key: 'duration_minutes', label: 'Minutes', num: true, render: (t) => t.duration_minutes ?? '—' },
          { key: 'exception', label: 'Notes', render: (t) => <span className="small">{t.exception || t.notes || ''}</span> },
          { key: 'act', label: '', sortable: false, render: (t) => <TaskActions t={t} onDone={reload} attendants={attendants.data} /> },
        ]}
      />
    </Card>
  );
}

// Mobile-friendly list for room attendants.
function MyTasks({ prop, onChange }) {
  const q = useApi(`/housekeeping/tasks${qs({ property: prop.id, mine: 1 })}`);
  const reload = () => {
    q.reload();
    onChange?.();
  };
  return (
    <Async q={q} isEmpty={(t) => !t.length} emptyView={<Empty title="No tasks assigned to you today" />}>
      {(tasks) => (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {tasks.map((t) => (
            <div key={t.id} className="task-card">
              <div className="row">
                <b style={{ fontSize: 20 }}>{t.room_number}</b>
                <span className="small muted">
                  {t.room_type_code} · floor {t.floor_level}
                </span>
                <span className="spacer" />
                <Badge tone={TASK_TONE[t.status]}>{titleCase(t.status)}</Badge>
              </div>
              <div className="row">
                <span>{KIND_LABEL[t.kind]}</span>
                {t.priority >= 2 && <Badge tone="danger">Guest arriving</Badge>}
                {t.dnd ? <Badge tone="violet">DND</Badge> : null}
              </div>
              {t.exception && <Notice tone="warn">{t.exception}</Notice>}
              {t.started_at && <div className="small muted">Started {dateTime(t.started_at)}{t.duration_minutes ? ` · ${t.duration_minutes} min` : ''}</div>}
              <TaskActions t={t} onDone={reload} />
            </div>
          ))}
        </div>
      )}
    </Async>
  );
}

function Productivity({ prop }) {
  const q = useApi(`/housekeeping/productivity${qs({ property: prop.id })}`);
  const rows = useMemo(() => (q.data || []).map((r, i) => ({ ...r, id: i })), [q.data]);
  return (
    <Card title="Attendant productivity" sub="Last 30 days, completed and inspected tasks" flush>
      <Async q={q}>
        {() => (
          <DataTable
            rows={rows}
            empty={<Empty title="No completed tasks in the last 30 days" />}
            exportName="housekeeping-productivity.csv"
            columns={[
              { key: 'name', label: 'Attendant' },
              { key: 'kind', label: 'Task', render: (r) => KIND_LABEL[r.kind] },
              { key: 'tasks', label: 'Tasks', num: true, render: (r) => number(r.tasks) },
              { key: 'avg_minutes', label: 'Average minutes', num: true },
              { key: 'failed_inspections', label: 'Failed inspections', num: true },
            ]}
          />
        )}
      </Async>
    </Card>
  );
}
