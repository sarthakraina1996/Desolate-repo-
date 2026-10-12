import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserCheck, House, Clock, UserX, CalendarX, AlarmClock, CircleDashed, Download, LogIn, LogOut, CheckCheck } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction, useClickOutside } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { fmtTime, fmtDay, addMonths, fmtMonth, dowOf } from '../lib/format.js';
import { Card, Kpi, Badge, Button, Tabs, Empty, Loading, ErrorBox, Person, Select, Input } from '../components/ui.jsx';
import { VerticalFilterNote } from './Dashboard.jsx';

const LABEL = { P: 'Present', WFH: 'WFH', HD: 'Half day', A: 'Absent', L: 'On leave', H: 'Holiday', WO: 'Weekly off', U: 'Not marked', F: 'Not marked yet', NA: '—' };
const TONE = { P: 'green', WFH: 'amber', HD: 'amber', A: 'red', L: 'purple', H: 'blue', WO: 'gray', U: 'gray', F: 'gray' };

export default function Attendance() {
  const [sp, setSp] = useSearchParams();
  const { isHR, isManager } = useApp();
  const team = isHR || isManager;
  const tab = sp.get('tab') || (team ? 'today' : 'month');
  return (
    <div>
      <div className="page-head">
        <div><h1>Attendance</h1><div className="sub">Check-ins, work from home and the monthly register that feeds payroll. <VerticalFilterNote /></div></div>
      </div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ value: 'today', label: 'Today' }, { value: 'month', label: team ? 'Monthly Register' : 'My Attendance' }]} />
      {tab === 'today' && <Today />}
      {tab === 'month' && <Register />}
    </div>
  );
}

function Today() {
  const { toast, vertical, isHR, isManager } = useApp();
  const { data, error, reload } = useApi(`/attendance/today${vertical ? `?vertical=${vertical}` : ''}`);
  const [run, busy] = useAction(toast);
  const [filter, setFilter] = useState('');
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
            <div className="b7" style={{ fontSize: 20, marginTop: 4 }}>
              {me.record?.check_in ? <>Checked in at {fmtTime(me.record.check_in)}{me.record.check_out && <> · out at {fmtTime(me.record.check_out)}</>} {me.late && <Badge tone="amber">Late</Badge>}</> : ['H', 'WO'].includes(me.status.code) ? LABEL[me.status.code] : me.status.code === 'L' ? `On ${me.status.leave?.name}` : 'You have not checked in'}
            </div>
          </div>
          <div className="row">
            {!me.record?.check_in && <><Button variant="primary" icon={LogIn} loading={busy} onClick={async () => { if (await run(() => api.post('/attendance/check-in', { mode: 'office' }), 'Checked in')) reload(); }}>Check in</Button>
              <Button icon={House} loading={busy} onClick={async () => { if (await run(() => api.post('/attendance/check-in', { mode: 'wfh' }), 'Checked in from home')) reload(); }}>Work from home</Button></>}
            {me.record?.check_in && !me.record.check_out && <Button icon={LogOut} loading={busy} onClick={async () => { if (await run(() => api.post('/attendance/check-out'), (r) => `Checked out after ${r.hours} hours`)) reload(); }}>Check out</Button>}
          </div>
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
