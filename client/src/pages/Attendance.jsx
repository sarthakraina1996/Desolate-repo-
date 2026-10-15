import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserCheck, House, Clock, UserX, CalendarX, AlarmClock, CircleDashed, Download, CheckCheck, MapPin } from 'lucide-react';
import { fmtDistance } from '../lib/location.js';
import { useApp } from '../context.jsx';
import { useApi, useAction, useClickOutside } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { fmtTime, fmtDay, addMonths, fmtMonth, dowOf } from '../lib/format.js';
import { Card, Kpi, Badge, Button, Tabs, Empty, Loading, ErrorBox, Person, Select, Input, Modal, Field, Textarea, Progress, Seg } from '../components/ui.jsx';
import { VerticalFilterNote } from './Dashboard.jsx';
import { ClockActions, SessionList, ExplainModal } from '../components/WorkClock.jsx';
import { useWorkday, useNow, workedNow, clockText, useOnWorkdayChange, refreshWorkday } from '../lib/workday.js';

const LABEL = { P: 'Present', WFH: 'WFH', HD: 'Half day', A: 'Absent', L: 'On leave', H: 'Holiday', WO: 'Weekly off', U: 'Not marked', F: 'Not marked yet', NA: '—' };
const TONE = { P: 'green', WFH: 'amber', HD: 'amber', A: 'red', L: 'purple', H: 'blue', WO: 'gray', U: 'gray', F: 'gray' };

export default function Attendance() {
  const [sp, setSp] = useSearchParams();
  const { isHR, isManager, isAdmin } = useApp();
  const s = useWorkday();
  const team = isHR || isManager;
  const tab = sp.get('tab') || (team ? 'today' : 'month');
  const shortCount = (s?.toExplain || 0) + (s?.toApprove || 0);
  return (
    <div>
      <div className="page-head">
        <div><h1>Attendance</h1><div className="sub">Check-ins, work from home and the monthly register that feeds payroll. <VerticalFilterNote /></div></div>
      </div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ value: 'today', label: 'Today' }, { value: 'month', label: team ? 'Monthly Register' : 'My Attendance' }, { value: 'short', label: shortCount ? `Short hours (${shortCount})` : 'Short hours' }, { value: 'locations', label: 'Location log' }]} />
      {tab === 'today' && <Today />}
      {tab === 'month' && <Register />}
      {tab === 'short' && <ShortHours team={team || isAdmin} />}
      {tab === 'locations' && <LocationLog team={team || isAdmin} />}
    </div>
  );
}

function Today() {
  const { toast, vertical, isHR, isManager } = useApp();
  const { data, error, reload } = useApi(`/attendance/today${vertical ? `?vertical=${vertical}` : ''}`);
  const [run, busy] = useAction(toast);
  const [filter, setFilter] = useState('');
  const clock = useWorkday();
  const now = useNow(1000);
  useOnWorkdayChange(reload);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const me = data.me;
  const s = data.team?.summary;
  const rows = (data.team?.rows || []).filter((r) => !filter || (filter === 'late' ? r.late : filter === 'NM' ? ['F', 'U'].includes(r.code_today) : r.code_today === filter));
  const mark = async (r, status) => { if (await run(() => api.put('/attendance', { employee_id: r.id, date: data.today, status }), `${r.name}: ${status ? LABEL[status] : 'cleared'}`)) reload(); };
  const unmarked = (data.team?.rows || []).filter((r) => r.code_today === 'F' && r.canMark);
  return (
    <div>
      {me && (
        <div className="card mb-16 row between wrap" style={{ gap: 14 }}>
          <div>
            <div className="small muted">{fmtDay(data.today)} · Late after {fmtTime(me.lateAfter)}</div>
            <div className="b7" style={{ fontSize: 20, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {me.record?.check_in ? <>Checked in at {fmtTime(me.record.check_in)}{me.record.check_out && <> · out at {fmtTime(me.record.check_out)}</>} {me.late && <Badge tone="amber">Late</Badge>}</> : ['H', 'WO'].includes(me.status.code) ? LABEL[me.status.code] : me.status.code === 'L' ? `On ${me.status.leave?.name}` : 'You have not checked in'}
            </div>
            {clock?.workday?.sessions.length > 0 && <>
              <div className="small muted mt-8">{clock.workday.openSince ? 'Working' : 'Paused'} · {clockText(workedNow(clock, now), false)} of {clockText(clock.workday.requiredMinutes, false)} today</div>
              <SessionList w={clock.workday} />
            </>}
          </div>
          <ClockActions />
        </div>
      )}
      {s && (
        <>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <Kpi icon={UserCheck} tone="green" label="Present" value={s.present} onClick={() => setFilter(filter === 'P' ? '' : 'P')} />
            <Kpi icon={House} tone="amber" label="Work From Home" value={s.wfh} onClick={() => setFilter(filter === 'WFH' ? '' : 'WFH')} />
            <Kpi icon={CalendarX} tone="purple" label="On Leave" value={s.onLeave} onClick={() => setFilter(filter === 'L' ? '' : 'L')} />
            <Kpi icon={UserX} tone="red" label="Absent" value={s.absent} onClick={() => setFilter(filter === 'A' ? '' : 'A')} />
            <Kpi icon={CircleDashed} tone="gray" label="Not Marked" value={s.notMarked} onClick={() => setFilter(filter === 'NM' ? '' : 'NM')} />
            <Kpi icon={AlarmClock} tone="red" label="Late Check-ins" value={s.late} onClick={() => setFilter(filter === 'late' ? '' : 'late')} />
          </div>
          <Card flush title={<>{isHR ? 'Everyone' : 'My team'} today {filter && <Badge tone="blue">{filter === 'NM' ? 'Not marked' : filter === 'late' ? 'Late' : LABEL[filter]} <button type="button" style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setFilter('')}>✕</button></Badge>}</>}
            action={(isHR || isManager) && unmarked.length > 0 && <Button size="sm" icon={CheckCheck} loading={busy} style={{ marginRight: 18 }} onClick={async () => { if (await run(() => api.post('/attendance/bulk', { date: data.today, status: 'P', employee_ids: unmarked.map((r) => r.id) }), (o) => `Marked ${o.count} present`)) reload(); }}>Mark {unmarked.length} unmarked present</Button>}>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="table">
                <thead><tr><th style={{ paddingLeft: 18 }}>Employee</th><th className="hide-sm">Department</th><th>Status</th><th>Check-in</th><th>Check-out</th><th /></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ paddingLeft: 18 }}><Person name={r.name} sub={r.designation} id={r.id} hasPhoto={r.has_photo} size={32} /></td>
                    <td className="hide-sm small muted">{r.vertical} • {r.department}</td>
                    <td><Badge tone={TONE[r.code_today]}>{r.code_today === 'L' ? r.leave : LABEL[r.code_today]}</Badge></td>
                    <td className="small">{r.checkIn ? <>{fmtTime(r.checkIn)} {r.late && <Badge tone="amber">Late</Badge>}</> : '—'}</td>
                    <td className="small">{r.checkOut ? fmtTime(r.checkOut) : '—'}</td>
                    <td className="right" style={{ paddingRight: 18 }}>
                      {r.canMark && !['L', 'H', 'WO'].includes(r.code_today) && (
                        <select className="select sm" style={{ width: 120 }} value={['P', 'WFH', 'HD', 'A'].includes(r.code_today) ? r.code_today : ''} onChange={(e) => mark(r, e.target.value || null)} aria-label={`Mark ${r.name}`}>
                          <option value="">Mark…</option><option value="P">Present</option><option value="WFH">WFH</option><option value="HD">Half day</option><option value="A">Absent</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              {!rows.length && <Empty text="No one in this view" />}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Register() {
  const { meta, toast, vertical, isHR, isManager } = useApp();
  const [month, setMonth] = useState(meta.today.slice(0, 7));
  const [dept, setDept] = useState('');
  const [q, setQ] = useState('');
  const { data, error, reload, setData } = useApi(`/attendance/register?month=${month}${vertical ? `&vertical=${vertical}` : ''}${dept ? `&department=${dept}` : ''}`);
  const [pick, setPick] = useState(null);
  const [run] = useAction(toast);
  const rows = useMemo(() => (data?.rows || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const close = useCallback(() => setPick(null), []);
  const ref = useClickOutside(close);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const team = isHR || isManager;
  const setMark = async (row, date, status) => {
    setPick(null);
    const ok = await run(() => api.put('/attendance', { employee_id: row.id, date, status }));
    if (ok) {
      setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id !== row.id ? r : { ...r, days: r.days.map((x) => (x.date !== date ? x : { ...x, code: status || (date < d.today ? 'U' : 'F') })) })) }));
      reload();
    }
  };
  return (
    <div>
      <div className="row wrap mb-16" style={{ gap: 10 }}>
        <Button size="sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹</Button>
        <b style={{ minWidth: 130, textAlign: 'center' }}>{fmtMonth(month)}</b>
        <Button size="sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">›</Button>
        {team && <Select className="sm" style={{ width: 180 }} value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All Departments" options={meta.departments.map((d) => ({ value: d.id, label: d.name }))} />}
        {team && <Input className="sm" style={{ width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search employee" />}
        <span className="grow" />
        {isHR && <Button size="sm" icon={Download} onClick={() => download(`/attendance/export.csv?month=${month}`)}>Export CSV</Button>}
      </div>
      <div className="row wrap small mb-12" style={{ gap: 10 }}>
        {['P', 'WFH', 'HD', 'A', 'L', 'H', 'U'].map((c) => <span key={c} className="row gap-4"><span className={`cell c-${c}`} style={{ width: 22, height: 18, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700 }}>{c === 'U' ? '·' : c === 'L' ? 'L' : c.slice(0, 2)}</span>{LABEL[c]}</span>)}
        {team && <span className="muted">· Click a past day to change it. Unmarked past days are paid as {data?.unmarkedAs || 'present'}.</span>}
      </div>
      {!data ? <Loading /> : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap" style={{ maxHeight: '70vh', overflow: 'auto' }}>
            <table className="reg">
              <thead><tr>
                <th className="name" style={{ paddingLeft: 14 }}>Employee</th>
                {data.days.map((d) => <th key={d} className={data.weeklyOffs.includes(dowOf(d)) ? 'we' : ''}>{Number(d.slice(8))}<div style={{ fontWeight: 500, fontSize: 9.5 }}>{new Date(`${d}T00:00:00Z`).toLocaleString('en-US', { weekday: 'narrow', timeZone: 'UTC' })}</div></th>)}
                {['P', 'WFH', 'L', 'A', 'LOP'].map((h) => <th key={h} style={{ minWidth: 40, padding: '6px 6px' }}>{h}</th>)}
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="name" style={{ paddingLeft: 14 }}><Person name={r.name} sub={r.code} id={r.id} hasPhoto={r.has_photo} size={26} /></td>
                  {r.days.map((d) => {
                    const can = r.canMark && d.date <= data.today && !['H', 'WO', 'L', 'NA'].includes(d.code);
                    const title = `${d.date}: ${d.code === 'L' ? d.leave : LABEL[d.code]}${d.in ? ` · in ${d.in}` : ''}${d.out ? ` · out ${d.out}` : ''}${d.late ? ' · late' : ''}`;
                    return (
                      <td key={d.date} className={data.weeklyOffs.includes(dowOf(d.date)) ? 'we' : ''} style={{ position: 'relative' }}>
                        <button type="button" className={`cell c-${d.code} ${can ? 'can' : ''}`} title={title} disabled={!can} onClick={() => can && setPick({ row: r, date: d.date })}
                          style={d.late ? { boxShadow: 'inset 0 -2px 0 #f2a600' } : undefined}>
                          {d.code === 'L' ? d.leave : d.code === 'WO' || d.code === 'F' || d.code === 'NA' ? '' : d.code === 'U' ? '·' : d.code === 'WFH' ? 'W' : d.code}
                        </button>
                        {pick && pick.row.id === r.id && pick.date === d.date && (
                          <div ref={ref} className="dropdown" style={{ left: 0, right: 'auto', minWidth: 130, top: '100%' }}>
                            {['P', 'WFH', 'HD', 'A'].map((c) => <div key={c} className="item" onClick={() => setMark(r, d.date, c)}><span className={`cell c-${c}`} style={{ width: 22, height: 18, borderRadius: 5, display: 'inline-block' }} />{LABEL[c]}</div>)}
                            <div className="item muted" onClick={() => setMark(r, d.date, null)}>Clear</div>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="b6">{r.summary.P}</td><td>{r.summary.WFH}</td><td>{r.summary.L}</td><td className={r.summary.A ? 'red b6' : ''}>{r.summary.A}</td><td className={r.summary.lop ? 'red b6' : 'muted'}>{r.summary.lop}</td>
                </tr>
              ))}</tbody>
            </table>
            {!rows.length && <Empty text="No employees" />}
          </div>
        </div>
      )}
      <div className="small muted mt-12"><Clock size={13} style={{ verticalAlign: -2 }} /> LOP = loss-of-pay days used by payroll (absent, half days, unpaid leave).</div>
    </div>
  );
}

// ---------- short hours ----------
const SHORT_TONE = { 'Awaiting explanation': 'amber', 'Pending approval': 'blue', Approved: 'green', Rejected: 'red' };

function Worked({ x }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div className="small b6" style={{ fontVariantNumeric: 'tabular-nums' }}>{clockText(x.worked_minutes, false)} <span className="muted" style={{ fontWeight: 400 }}>of {clockText(x.required_minutes, false)}</span></div>
      <Progress value={(x.worked_minutes / x.required_minutes) * 100} color="var(--amber)" height={5} />
    </div>
  );
}

const awaySummary = (x) => x.gaps.length ? x.gaps.map((g) => `${clockText(g.minutes, false)}${g.reason ? ` ${g.reason.toLowerCase()}` : ''}`).join(', ') : x.sessions.length === 1 && x.sessions[0].end ? `Left at ${fmtTime(x.sessions[0].end)}` : '—';

function DecideModal({ item, action, onClose, onDone }) {
  const { toast } = useApp();
  const [note, setNote] = useState('');
  const [run, busy] = useAction(toast);
  const approve = action === 'approve';
  return (
    <Modal title={`${approve ? 'Approve' : 'Reject'} short hours`} size="narrow" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={approve ? 'primary' : 'solid-red'} loading={busy} disabled={!approve && !note.trim()} onClick={async () => { if (await run(() => api.post(`/attendance/short-hours/${item.id}/decide`, { action, note }), approve ? 'Approved. The day counts in full.' : 'Rejected. The day is marked as a half day.')) { onDone(); onClose(); } }}>{approve ? 'Approve' : 'Reject'}</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div><b>{item.name}</b> · {fmtDay(item.date)} · worked {clockText(item.worked_minutes, false)} of {clockText(item.required_minutes, false)}</div>
        <SessionList w={{ sessions: item.sessions, gaps: item.gaps }} />
        <div className="alert info"><span>{item.reason ? <>“{item.reason}”</> : 'No explanation yet.'}</span></div>
        <div className="small muted">{approve ? 'The day will count as a full working day.' : 'The day will be marked as a half day (half a day of loss of pay).'}</div>
        <Field label={approve ? 'Note (optional)' : 'Reason for rejecting'}><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
      </div>
    </Modal>
  );
}

function ShortHours({ team }) {
  const { user, isHR, isAdmin } = useApp();
  const [status, setStatus] = useState('open');
  const mine = useApi(user.employeeId ? '/attendance/short-hours?view=mine' : null);
  const others = useApi(team ? `/attendance/short-hours?view=team${status === 'open' ? '&status=open' : ''}` : null);
  const [explain, setExplain] = useState(null);
  const [decide, setDecide] = useState(null);
  const reloadAll = () => { mine.reload(); others.reload(); refreshWorkday().catch(() => {}); };
  const required = mine.data?.required || others.data?.required || '8h 00m';
  const readOnly = isHR && !isAdmin;
  return (
    <div>
      <div className="alert info mb-16"><Clock size={16} /><span>A working day with less than <b>{required}</b> is flagged the next morning. The employee explains why; their reporting manager or the CEO approves it (the day counts in full) or rejects it (the day becomes a half day).</span></div>
      {user.employeeId && (
        <Card title="My short days" className="mb-16" flush>
          {!mine.data ? <Loading /> : !mine.data.items.length ? <Empty icon={CheckCheck} text="No short days. Every working day met the required hours." /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Date</th><th>Worked</th><th className="hide-sm">Time away</th><th>Reason</th><th>Status</th><th /></tr></thead>
                <tbody>{mine.data.items.map((x) => (
                  <tr key={x.id}>
                    <td className="b6" style={{ whiteSpace: 'nowrap' }}>{fmtDay(x.date)}</td>
                    <td><Worked x={x} /></td>
                    <td className="hide-sm small">{awaySummary(x)}</td>
                    <td className="small" style={{ maxWidth: 320 }}>{x.reason || <span className="muted">Not explained yet</span>}{x.decision_note && <div className="xs muted mt-8">{x.decidedByName}: {x.decision_note}</div>}</td>
                    <td><Badge tone={SHORT_TONE[x.status]}>{x.status}</Badge>{x.decidedByName && !x.decision_note && <div className="xs muted mt-8">by {x.decidedByName}</div>}</td>
                    <td className="right">{x.canExplain && <Button size="sm" variant={x.status === 'Awaiting explanation' ? 'primary' : ''} onClick={() => setExplain(x)}>{x.reason ? 'Edit reason' : 'Explain'}</Button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {team && (
        <Card title={readOnly ? 'Short days across the company' : isAdmin ? 'Short days to approve' : 'Your team’s short days'} sub={readOnly ? 'Reporting managers and the CEO approve these.' : undefined} flush
          action={<Seg options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} />}>
          {!others.data ? <Loading /> : !others.data.items.length ? <Empty icon={CheckCheck} text={status === 'open' ? 'Nothing waiting. All short days are settled.' : 'No short days yet.'} /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Employee</th><th>Date</th><th>Worked</th><th className="hide-sm">Time away</th><th>Reason</th><th>Status</th><th /></tr></thead>
                <tbody>{others.data.items.map((x) => (
                  <tr key={x.id}>
                    <td><Person name={x.name} sub={x.designation} id={x.employee_id} hasPhoto={x.has_photo} size={34} /></td>
                    <td className="b6" style={{ whiteSpace: 'nowrap' }}>{fmtDay(x.date)}</td>
                    <td><Worked x={x} /></td>
                    <td className="hide-sm small">{awaySummary(x)}</td>
                    <td className="small" style={{ maxWidth: 300 }}>{x.reason || <span className="muted">Waiting for the employee</span>}</td>
                    <td><Badge tone={SHORT_TONE[x.status]}>{x.status}</Badge>{x.decidedByName && <div className="xs muted mt-8">by {x.decidedByName}</div>}</td>
                    <td className="right" style={{ whiteSpace: 'nowrap' }}>{x.canDecide && <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <Button size="sm" variant="primary" onClick={() => setDecide({ item: x, action: 'approve' })}>Approve</Button>
                      <Button size="sm" onClick={() => setDecide({ item: x, action: 'reject' })}>Reject</Button>
                    </div>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {explain && <ExplainModal item={explain} onClose={() => setExplain(null)} onDone={reloadAll} />}
      {decide && <DecideModal item={decide.item} action={decide.action} onClose={() => setDecide(null)} onDone={reloadAll} />}
    </div>
  );
}

// ---------- location log ----------
const LOC_RESULT = {
  'in-office': ['In office', 'green'], 'office-network': ['Office network', 'green'], outside: ['Outside', 'red'],
  imprecise: ['Location unclear', 'amber'], 'no-location': ['No location', 'amber'], exempt: ['Exempt', 'gray'],
};
const EVENT_LABEL = { 'sign-in': 'Signed in', 'check-in': 'Checked in', 'while working': 'While working', 'sign-in blocked': 'Sign-in refused', 'check-in blocked': 'Check-in refused', 'signed out (left office)': 'Signed out: left office' };

function LocationLog({ team }) {
  const { meta } = useApp();
  const [view, setView] = useState(team ? 'team' : 'mine');
  const [day, setDay] = useState(meta.today);
  const [issues, setIssues] = useState(false);
  const qs = new URLSearchParams({ view, ...(day ? { date: day } : {}), ...(issues ? { issues: '1' } : {}) });
  const { data, error, reload } = useApi(`/attendance/locations?${qs}`);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const mapUrl = (x) => `https://www.google.com/maps?q=${x.lat},${x.lng}`;
  return (
    <div>
      <div className={`alert ${data?.mode === 'off' ? 'warn' : 'info'} mb-16`}><MapPin size={16} /><span>
        {data?.mode === 'off'
          ? <>The office-only sign-in rule is off, so locations are not being checked. {team ? 'HR can turn it on in Settings → Office Locations.' : ''}</>
          : <>Sign-in and check-in are allowed only at an office{data?.mode === 'strict' ? ', and leaving the office signs people out' : ''}. Locations are recorded at sign-in, at check-in and every 10 minutes while the work clock runs.</>}
      </span></div>
      <Card flush title={view === 'team' ? 'Location log' : 'My location history'} sub={data ? `${data.summary.inOffice} in office · ${data.summary.outside} outside · ${data.summary.blocked} refused or signed out` : undefined}
        action={team && <Seg options={[{ value: 'team', label: 'Team' }, { value: 'mine', label: 'Mine' }]} value={view} onChange={setView} />}>
        <div className="filters" style={{ padding: '0 18px 14px' }}>
          <Input type="date" value={day} max={meta.today} onChange={(e) => setDay(e.target.value)} aria-label="Date" />
          <label className="check small"><input type="checkbox" checked={issues} onChange={(e) => setIssues(e.target.checked)} />Only problems</label>
        </div>
        {!data ? <Loading /> : !data.items.length ? <Empty icon={MapPin} text="Nothing recorded for this day." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th>{view === 'team' && <th>Employee</th>}<th>Event</th><th>Result</th><th>Where</th><th className="hide-sm">Accuracy</th><th /></tr></thead>
              <tbody>{data.items.map((x) => {
                const [label, tone] = LOC_RESULT[x.result] || [x.result, 'gray'];
                return (
                  <tr key={x.id}>
                    <td className="small nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(x.at)}</td>
                    {view === 'team' && <td>{x.employee_id ? <Person name={x.name} sub={x.code} id={x.employee_id} hasPhoto={x.has_photo} size={30} /> : x.name}</td>}
                    <td className="small">{EVENT_LABEL[x.event] || x.event}</td>
                    <td><Badge tone={tone}>{label}</Badge></td>
                    <td className="small">{x.result === 'exempt' ? x.note : x.site_name ? `${x.result === 'outside' || x.result === 'imprecise' ? `${fmtDistance(x.distance_m)} from ` : ''}${x.site_name}${x.result === 'in-office' && x.distance_m != null ? ` · ${fmtDistance(x.distance_m)}` : ''}` : '—'}</td>
                    <td className="hide-sm small muted">{x.accuracy_m != null ? `±${fmtDistance(x.accuracy_m)}` : x.result === 'office-network' ? 'Network' : '—'}</td>
                    <td className="right">{x.lat != null && <a className="small" href={mapUrl(x)} target="_blank" rel="noreferrer">Map</a>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
