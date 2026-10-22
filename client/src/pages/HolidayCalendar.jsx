// Year view of public holidays: company and restricted holidays on twelve
// month grids, with weekly offs, today and the viewer's own leave marked.
// This is the only place holidays are shown, and where HR adds and removes them.
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarHeart, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { Card, Badge, Button, Empty, Loading, ErrorBox, Modal, Field, Input, Select, useConfirm } from '../components/ui.jsx';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad = (n) => String(n).padStart(2, '0');
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const weekday = (d) => fmtDate(d, { weekday: 'short' });

function Month({ year, month, byDate, leaveByDate, weeklyOffs, today }) {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first grid
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<span key={`b${i}`} />);
  for (let d = 1; d <= days; d++) {
    const date = `${year}-${pad(month + 1)}-${pad(d)}`;
    const dow = new Date(Date.UTC(year, month, d)).getUTCDay();
    const h = byDate.get(date);
    const lv = leaveByDate.get(date);
    const cls = ['cal-day', h ? (h.type === 'Company' ? 'hol' : 'rh') : weeklyOffs.includes(dow) ? 'off' : '', date === today ? 'today' : '', date < today ? 'past' : ''].filter(Boolean).join(' ');
    const label = [fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }), h && `${h.name} (${h.type === 'Company' ? 'company holiday' : 'restricted holiday'})`, !h && weeklyOffs.includes(dow) && 'Weekly off', lv && `Your ${lv.name}${lv.status === 'Pending' ? ' (pending)' : ''}`].filter(Boolean).join(' · ');
    cells.push(
      <span key={date} className={cls} title={label} aria-label={label}>
        {d}
        {lv && <i className={`lv ${lv.status === 'Pending' ? 'pending' : ''}`} style={{ background: lv.color }} />}
      </span>,
    );
  }
  return (
    <div className="cal-month">
      <div className="cal-title">{MONTHS[month]}</div>
      <div className="cal-grid cal-dow">{DOW.map((d) => <span key={d}>{d[0]}</span>)}</div>
      <div className="cal-grid">{cells}</div>
    </div>
  );
}

function AddHoliday({ year, today, onClose, onAdded }) {
  const { toast } = useApp();
  const [f, setF] = useState({ date: today.startsWith(String(year)) ? today : `${year}-01-01`, name: '', type: 'Company' });
  const [run, busy] = useAction(toast);
  const save = async () => {
    if (busy) return;
    if (await run(() => api.post('/holidays', f), `${f.name.trim() || 'Holiday'} added`)) onAdded(Number(f.date.slice(0, 4)));
  };
  return (
    <Modal title="Add a holiday" size="narrow" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} icon={Plus} onClick={save}>Add holiday</Button></>}>
      <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Diwali" maxLength={80} autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} /></Field>
      <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: 'Company', label: 'Company holiday (office closed)' }, { value: 'Restricted', label: 'Restricted holiday (optional)' }]} /></Field>
      <div className="xs muted">Restricted holidays are optional and are taken as Casual Leave. Festival dates change every year, so check them each January.</div>
    </Modal>
  );
}

export default function HolidayCalendar() {
  const { meta, isHR, toast } = useApp();
  const thisYear = Number(meta.today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const { data, error, reload } = useApi(`/holidays/calendar?year=${year}`);
  const [adding, setAdding] = useState(false);
  const [run] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const remove = async (h) => {
    if (!(await confirm({ title: 'Delete holiday?', text: `${h.name} on ${fmtDate(h.date)}`, danger: true, confirmLabel: 'Delete' }))) return;
    if (await run(() => api.del(`/holidays/${h.id}`), `${h.name} removed`)) reload();
  };
  const derived = useMemo(() => {
    if (!data) return null;
    const byDate = new Map();
    for (const h of data.holidays) if (h.type === 'Company' || !byDate.has(h.date)) byDate.set(h.date, h);
    const leaveByDate = new Map(data.myLeave.map((l) => [l.date, l]));
    const next = data.holidays.find((h) => h.date >= data.today && h.type === 'Company');
    return { byDate, leaveByDate, next, company: data.holidays.filter((h) => h.type === 'Company').length, restricted: data.holidays.filter((h) => h.type !== 'Company').length };
  }, [data]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const months = data ? MONTHS.map((_, m) => m) : [];
  const grouped = data ? months.map((m) => ({ m, items: data.holidays.filter((h) => Number(h.date.slice(5, 7)) === m + 1) })).filter((g) => g.items.length) : [];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Holiday Calendar</h1>
          <div className="sub">Public holidays at {meta.settings.companyName || 'BrainADZ'}, with weekly offs and your own leave.</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Button icon={ChevronLeft} aria-label="Previous year" onClick={() => setYear(year - 1)} />
          <div className="b7" style={{ fontSize: 20, minWidth: 64, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{year}</div>
          <Button icon={ChevronRight} aria-label="Next year" onClick={() => setYear(year + 1)} />
          {year !== thisYear && <Button onClick={() => setYear(thisYear)}>This year</Button>}
        </div>
      </div>
      {!data || !derived ? <Loading /> : (
        <div className="cal-layout">
          <Card flush>
            <div className="cal-summary">
              <span><b>{derived.company}</b> company holidays</span>
              <span><b>{derived.restricted}</b> restricted holidays</span>
              {derived.next && year === thisYear && <span>Next: <b>{derived.next.name}</b>, {fmtDate(derived.next.date, { weekday: 'short', day: 'numeric', month: 'short' })}{dayDiff(data.today, derived.next.date) === 0 ? ' (today)' : ` (in ${dayDiff(data.today, derived.next.date)} days)`}</span>}
            </div>
            <div className="cal-legend">
              <span><i className="sw hol" />Company holiday</span>
              <span><i className="sw rh" />Restricted holiday</span>
              <span><i className="sw off" />Weekly off</span>
              <span><i className="sw lv" />Your leave</span>
              <span><i className="sw today" />Today</span>
            </div>
            <div className="cal-year">
              {months.map((m) => <Month key={m} year={year} month={m} byDate={derived.byDate} leaveByDate={derived.leaveByDate} weeklyOffs={data.weeklyOffs} today={data.today} />)}
            </div>
          </Card>
          <Card title={`Holidays ${year}`} action={isHR && <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add holiday</Button>}>
            {!grouped.length ? <Empty icon={CalendarHeart} text={isHR ? `No holidays for ${year} yet. Use Add holiday to publish them.` : `No holidays published for ${year} yet.`} /> : grouped.map((g) => (
              <div key={g.m} className="hol-group">
                <div className="xs muted b6 hol-month">{MONTHS[g.m].toUpperCase()}</div>
                {g.items.map((h) => (
                  <div key={h.id} className={`hol-row ${h.date < data.today ? 'past' : ''} ${derived.next?.id === h.id ? 'next' : ''}`}>
                    <div className="hol-date"><b>{Number(h.date.slice(8))}</b><span>{weekday(h.date)}</span></div>
                    <div className="grow">{h.name}</div>
                    <Badge tone={h.type === 'Company' ? 'blue' : 'pink'}>{h.type === 'Company' ? 'Company' : 'Restricted'}</Badge>
                    {isHR && <Button size="xs" variant="ghost" icon={Trash2} aria-label={`Delete ${h.name}`} title="Delete holiday" onClick={() => remove(h)} />}
                  </div>
                ))}
              </div>
            ))}
            {grouped.length > 0 && <div className="xs muted mt-8">Restricted holidays are optional: take them as Casual Leave.</div>}
          </Card>
        </div>
      )}
      {adding && data && <AddHoliday year={year} today={data.today} onClose={() => setAdding(false)} onAdded={(y) => { setAdding(false); if (y === year) reload(); else setYear(y); }} />}
      {confirmEl}
    </div>
  );
}
