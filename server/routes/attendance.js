import { today, isHR, scopeIds, requireHR, fullName, date, oneOf, id, fail, getSettings, sendCsv, str, audit } from '../core.js';
import * as D from '../lib/dates.js';
import { dayStatuses } from '../services/calendar.js';

const MARKS = ['P', 'WFH', 'HD', 'A'];

function scopedEmployees(db, user, { vertical, department, search, from, to }) {
  const scope = scopeIds(db, user);
  const where = ['e.join_date <= ?', '(e.exit_date IS NULL OR e.exit_date >= ?)'];
  const params = [to, from];
  if (scope !== null) { where.push(scope.length ? `e.id IN (${scope.map(() => '?').join(',')})` : '0=1'); params.push(...scope); }
  if (vertical) { where.push('e.vertical_id = ?'); params.push(Number(vertical)); }
  if (department) { where.push('e.department_id = ?'); params.push(Number(department)); }
  if (search) {
    const like = `%${String(search).replace(/[%_]/g, '')}%`;
    where.push("(e.first_name || ' ' || e.last_name LIKE ? OR e.code LIKE ?)");
    params.push(like, like);
  }
  return db.all(`SELECT e.*, d.name AS department, v.short AS vertical, v.color AS vertical_color FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN verticals v ON v.id = e.vertical_id
    WHERE ${where.join(' AND ')} ORDER BY e.first_name, e.last_name`, ...params);
}

function canMark(db, user, employeeId) {
  if (isHR(user)) return true;
  const scope = scopeIds(db, user);
  return user.role === 'manager' && scope.includes(employeeId) && employeeId !== user.employeeId;
}

function summarize(days) {
  const s = { P: 0, WFH: 0, HD: 0, A: 0, L: 0, U: 0, H: 0, WO: 0, lop: 0, late: 0 };
  for (const d of days.values()) {
    if (d.code in s) s[d.code]++;
    s.lop += d.lop;
    if (d.late) s.late++;
  }
  return s;
}

export default function attendanceRoutes(r, { db }) {
  const settings = () => getSettings(db);
  const timeLocal = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: settings().timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

  r.get('/attendance/today', (req, res) => {
    const T = today(db);
    const out = { today: T, me: null, team: null };
    const s = settings();
    if (req.user.employeeId) {
      const e = db.get('SELECT * FROM employees WHERE id = ?', req.user.employeeId);
      const st = dayStatuses(db, [e], T, T, T, s).get(e.id).get(T);
      const rec = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', e.id, T);
      out.me = { status: st, record: rec, lateAfter: s.lateAfter, late: rec?.check_in ? timeLocal(rec.check_in) > s.lateAfter : false };
    }
    if (isHR(req.user) || req.user.role === 'manager') {
      const emps = scopedEmployees(db, req.user, { from: T, to: T, vertical: req.query.vertical, department: req.query.department });
      const st = dayStatuses(db, emps, T, T, T, s);
      const rows = emps.map((e) => {
        const d = st.get(e.id).get(T);
        return { id: e.id, name: fullName(e), code: e.code, designation: e.designation, department: e.department, vertical: e.vertical, has_photo: Boolean(e.photo), code_today: d.code, leave: d.leave?.name, checkIn: d.checkIn, checkOut: d.checkOut, late: d.checkIn ? timeLocal(d.checkIn) > s.lateAfter : false, canMark: canMark(db, req.user, e.id) };
      });
      const count = (c) => rows.filter((x) => x.code_today === c).length;
      out.team = { rows, summary: { total: rows.length, present: count('P'), wfh: count('WFH'), halfDay: count('HD'), absent: count('A'), onLeave: count('L'), notMarked: count('F') + count('U'), off: count('H') + count('WO'), late: rows.filter((x) => x.late).length } };
    }
    res.json(out);
  });

  r.post('/attendance/check-in', (req, res) => {
    if (!req.user.employeeId) fail(400, 'Your login is not linked to an employee record');
    const T = today(db);
    const mode = oneOf(req.body.mode || 'office', ['office', 'wfh'], { name: 'Mode' });
    const rec = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.employeeId, T);
    if (rec?.check_in) fail(409, 'You have already checked in today');
    const now = new Date().toISOString();
    db.run(`INSERT INTO attendance (employee_id, date, status, check_in, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, date) DO UPDATE SET status = excluded.status, check_in = excluded.check_in, updated_by = excluded.updated_by`,
    req.user.employeeId, T, mode === 'wfh' ? 'WFH' : 'P', now, req.user.id);
    res.json({ ok: true, at: now });
  });

  r.post('/attendance/check-out', (req, res) => {
    if (!req.user.employeeId) fail(400, 'Your login is not linked to an employee record');
    const T = today(db);
    const rec = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', req.user.employeeId, T);
    if (!rec?.check_in) fail(400, 'Check in first');
    if (rec.check_out) fail(409, 'You have already checked out today');
    const now = new Date().toISOString();
    const hours = (Date.parse(now) - Date.parse(rec.check_in)) / 3600000;
    db.run('UPDATE attendance SET check_out = ?, status = ? WHERE employee_id = ? AND date = ?', now, rec.status === 'P' && hours < 4 ? 'HD' : rec.status, req.user.employeeId, T);
    res.json({ ok: true, at: now, hours: Math.round(hours * 10) / 10 });
  });

  r.get('/attendance/register', (req, res) => {
    const T = today(db);
    const month = D.isValidMonth(req.query.month) ? req.query.month : D.monthOf(T);
    const from = D.monthStart(month);
    const to = D.monthEnd(month);
    const s = settings();
    const emps = scopedEmployees(db, req.user, { ...req.query, from, to });
    const st = dayStatuses(db, emps, from, to, T, s);
    const holidays = db.all('SELECT * FROM holidays WHERE date BETWEEN ? AND ?', from, to);
    const rows = emps.map((e) => {
      const days = st.get(e.id);
      for (const d of days.values()) if (d.checkIn && timeLocal(d.checkIn) > s.lateAfter) d.late = true;
      return {
        id: e.id, name: fullName(e), code: e.code, designation: e.designation, department: e.department, vertical: e.vertical, has_photo: Boolean(e.photo),
        canMark: canMark(db, req.user, e.id),
        days: [...days.entries()].map(([d, x]) => ({ date: d, code: x.code, leave: x.leave?.code, leaveColor: x.leave?.color, lop: x.lop, in: x.checkIn ? timeLocal(x.checkIn) : null, out: x.checkOut ? timeLocal(x.checkOut) : null, late: Boolean(x.late), mark: x.mark })),
        summary: summarize(days),
      };
    });
    res.json({ month, label: D.monthLabel(month), days: D.eachDay(from, to), weeklyOffs: s.weeklyOffs, holidays, rows, today: T, unmarkedAs: s.payroll.unmarkedAs });
  });

  r.put('/attendance', (req, res) => {
    const eid = id(req.body.employee_id);
    if (!canMark(db, req.user, eid)) fail(403, 'You cannot change attendance for this employee');
    const d = date(req.body.date, { required: true });
    if (d > today(db)) fail(400, 'Attendance cannot be marked for a future date');
    const status = req.body.status ? oneOf(req.body.status, MARKS, { name: 'Status' }) : null;
    if (!status) db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', eid, d);
    else {
      db.run(`INSERT INTO attendance (employee_id, date, status, note, updated_by) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(employee_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, updated_by = excluded.updated_by`,
      eid, d, status, str(req.body.note, { max: 200 }), req.user.id);
    }
    audit(db, req.user, 'attendance.mark', 'employee', eid, { date: d, status });
    res.json({ ok: true });
  });

  r.post('/attendance/bulk', (req, res) => {
    const d = date(req.body.date, { required: true });
    if (d > today(db)) fail(400, 'Attendance cannot be marked for a future date');
    const status = oneOf(req.body.status || 'P', MARKS, { name: 'Status' });
    const ids = (Array.isArray(req.body.employee_ids) ? req.body.employee_ids : []).map(id).filter((x) => canMark(db, req.user, x));
    if (!ids.length) fail(400, 'Select at least one employee you can mark');
    db.tx(() => {
      for (const eid of ids) {
        db.run(`INSERT INTO attendance (employee_id, date, status, updated_by) VALUES (?, ?, ?, ?)
          ON CONFLICT(employee_id, date) DO NOTHING`, eid, d, status, req.user.id);
      }
    });
    res.json({ ok: true, count: ids.length });
  });

  r.get('/attendance/export.csv', (req, res) => {
    requireHR(req);
    const T = today(db);
    const month = D.isValidMonth(req.query.month) ? req.query.month : D.monthOf(T);
    const from = D.monthStart(month);
    const to = D.monthEnd(month);
    const emps = scopedEmployees(db, req.user, { from, to });
    const st = dayStatuses(db, emps, from, to, T);
    const days = D.eachDay(from, to);
    const rows = emps.map((e) => ({ e, days: st.get(e.id), sum: summarize(st.get(e.id)) }));
    sendCsv(res, `attendance-${month}.csv`, rows, [
      { label: 'Employee ID', value: (x) => x.e.code }, { label: 'Name', value: (x) => fullName(x.e) }, { label: 'Department', value: (x) => x.e.department },
      ...days.map((d) => ({ label: d.slice(8), value: (x) => { const s = x.days.get(d); return s.code === 'L' ? s.leave?.code : s.code; } })),
      { label: 'Present', value: (x) => x.sum.P }, { label: 'WFH', value: (x) => x.sum.WFH }, { label: 'Half Day', value: (x) => x.sum.HD },
      { label: 'Absent', value: (x) => x.sum.A }, { label: 'Leave', value: (x) => x.sum.L }, { label: 'Unmarked', value: (x) => x.sum.U }, { label: 'LOP Days', value: (x) => x.sum.lop },
    ]);
  });
}
