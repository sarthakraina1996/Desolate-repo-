import { today, isHR, isAdmin, scopeIds, requireHR, fullName, date, oneOf, id, fail, notFound, getSettings, sendCsv, str, audit, notifyUsers, userIdForEmployee } from '../core.js';
import * as D from '../lib/dates.js';
import { dayStatuses } from '../services/calendar.js';
import {
  GAP_REASONS, workdaySummary, startSession, endSession, generateShortfalls, shortfallRow, approverUserIds, canDecideShortfall, fmtMinutes, dayLabel,
} from '../services/workday.js';
import { checkLocation, logLocation, readCoords, geofencePolicy, fmtDistance } from '../services/geofence.js';
import { destroySession } from '../auth.js';

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

  // ---------- work clock ----------
  // Today's sessions for the signed-in employee, plus what needs their
  // attention (short days to explain) or their approval (team short days).
  r.get('/attendance/workday', (req, res) => {
    const T = today(db);
    const s = settings();
    const out = { today: T, serverNow: new Date().toISOString(), gapReasons: GAP_REASONS, workday: null, toExplain: 0, toApprove: 0, workdayEnd: s.workdayEnd };
    if (req.user.employeeId) {
      generateShortfalls(db, { today: T, employeeIds: [req.user.employeeId], settings: s });
      out.workday = workdaySummary(db, req.user.employeeId, T, s);
      out.dayStatus = dayStatuses(db, [db.get('SELECT * FROM employees WHERE id = ?', req.user.employeeId)], T, T, T, s).get(req.user.employeeId).get(T).code;
      out.toExplain = db.value("SELECT COUNT(*) FROM hour_shortfalls WHERE employee_id = ? AND status = 'Awaiting explanation'", req.user.employeeId);
    }
    if (isAdmin(req.user)) out.toApprove = db.value("SELECT COUNT(*) FROM hour_shortfalls WHERE status = 'Pending approval' AND employee_id != ?", req.user.employeeId || 0);
    else if (req.user.employeeId) out.toApprove = db.value("SELECT COUNT(*) FROM hour_shortfalls s JOIN employees e ON e.id = s.employee_id WHERE s.status = 'Pending approval' AND e.manager_id = ?", req.user.employeeId);
    res.json(out);
  });

  r.post('/attendance/check-in', (req, res) => {
    if (!req.user.employeeId) fail(400, 'Your login is not linked to an employee record');
    const mode = oneOf(req.body.mode || 'office', ['office', 'wfh'], { name: 'Mode' });
    const gapReason = req.body.gap_reason ? oneOf(req.body.gap_reason, GAP_REASONS, { name: 'Reason' }) : null;
    const gapNote = str(req.body.gap_note, { max: 300 });
    if (gapReason === 'Other' && !gapNote) fail(400, 'Add a short note for "Other"');
    const s = settings();
    const T = today(db);
    if (geofencePolicy(s).mode !== 'off') {
      const coords = readCoords(req.body.location);
      const check = checkLocation(db, { user: req.user, coords, ip: req.ip, today: T, settings: s });
      const wfhDay = check.method === 'exempt';
      const resuming = db.value('SELECT COUNT(*) FROM work_sessions WHERE employee_id = ? AND date = ?', req.user.employeeId, T) > 0;
      const wantsWfh = mode === 'wfh' || (resuming && db.value('SELECT mode FROM work_sessions WHERE employee_id = ? AND date = ? ORDER BY start_at LIMIT 1', req.user.employeeId, T) === 'wfh');
      if (wantsWfh && !wfhDay) {
        res.status(403).json({ error: 'Working from home needs an approved work-from-home day. Apply for it in Leave & Policies, or check in at the office.', code: 'wfh_not_approved' });
        return;
      }
      if (!check.ok) {
        if (check.code !== 'location_required') logLocation(db, { user: req.user, event: 'check-in blocked', coords, ip: req.ip, check });
        res.status(403).json({ error: check.message.replace('sign in', 'check in'), code: check.code, distance: check.distance ?? null, office: check.site?.name ?? null });
        return;
      }
      logLocation(db, { user: req.user, event: 'check-in', coords, ip: req.ip, check });
    }
    const out = startSession(db, { employeeId: req.user.employeeId, date: T, mode, gapReason, gapNote, userId: req.user.id });
    if (out.error) fail(out.needsReason ? 400 : 409, out.error);
    res.json(out);
  });

  r.post('/attendance/check-out', (req, res) => {
    if (!req.user.employeeId) fail(400, 'Your login is not linked to an employee record');
    const out = endSession(db, { employeeId: req.user.employeeId, date: today(db), by: 'checkout', userId: req.user.id });
    if (!out) fail(400, 'Your work clock is not running');
    res.json({ ok: true, at: out.at, workedMinutes: out.workedMinutes, worked: fmtMinutes(out.workedMinutes), hours: Math.round((out.workedMinutes / 60) * 10) / 10 });
  });

  // ---------- location ----------
  // Sent by the app every few minutes while the work clock runs (and always
  // in strict mode). Strict mode signs the user out after two readings in a
  // row outside the office, which also pauses their clock.
  r.post('/attendance/location', (req, res) => {
    const s = settings();
    const policy = geofencePolicy(s);
    if (policy.mode === 'off') return res.json({ ok: true, tracking: false });
    const T = today(db);
    const coords = readCoords(req.body);
    const check = checkLocation(db, { user: req.user, coords, ip: req.ip, today: T, settings: s });
    if (check.method === 'exempt') return res.json({ ok: true, tracking: false, exempt: check.exempt });
    if (check.code === 'location_required') return res.json({ ok: false, code: check.code, message: check.message });
    const logId = logLocation(db, { user: req.user, event: 'while working', coords, ip: req.ip, check });
    const out = { ok: check.ok, office: check.site?.name ?? null, method: check.method, distance: check.distance ?? null, message: check.ok ? null : check.message.replace(' You can only sign in from the office.', '') };
    if (!check.ok && policy.mode === 'strict' && check.code === 'outside_office') {
      const prev = db.get("SELECT * FROM location_log WHERE user_id = ? AND event = 'while working' AND id < ? ORDER BY id DESC LIMIT 1", req.user.id, logId);
      if (prev && prev.result === 'outside' && Date.now() - Date.parse(prev.at) < 30 * 60000) {
        if (req.user.employeeId) endSession(db, { employeeId: req.user.employeeId, date: T, by: 'signout', userId: req.user.id });
        db.update('location_log', logId, { event: 'signed out (left office)' });
        destroySession(db, req, res);
        out.signedOut = true;
        out.message = `You were signed out because you left the office (${fmtDistance(check.distance)} from ${check.site.name}). Your work clock is paused; sign in again when you are back.`;
      }
    }
    res.json(out);
  });

  // view=mine: your own location history. view=team: your reports (HR and
  // administrators: everyone). issues=1 keeps only refusals and outside readings.
  r.get('/attendance/locations', (req, res) => {
    const view = req.query.view === 'team' ? 'team' : 'mine';
    const where = [];
    const params = [];
    if (view === 'mine') { where.push('l.user_id = ?'); params.push(req.user.id); }
    else if (!isHR(req.user)) {
      const ids = scopeIds(db, req.user).filter((x) => x !== req.user.employeeId);
      where.push(ids.length ? `l.employee_id IN (${ids.map(() => '?').join(',')})` : '0=1');
      params.push(...ids);
    }
    const d = req.query.date ? date(req.query.date) : null;
    if (d) {
      const tz = settings().timezone;
      where.push('l.at >= ? AND l.at < ?');
      params.push(D.zonedIso(d, '00:00', tz), D.zonedIso(D.addDays(d, 1), '00:00', tz));
    }
    if (req.query.issues === '1') where.push("l.result IN ('outside','imprecise','no-location')");
    if (req.query.vertical) { where.push('e.vertical_id = ?'); params.push(Number(req.query.vertical)); }
    const sql = `FROM location_log l LEFT JOIN employees e ON e.id = l.employee_id LEFT JOIN users u ON u.id = l.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const items = db.all(`SELECT l.*, e.first_name, e.last_name, e.code, e.designation, e.photo IS NOT NULL AS has_photo, u.email ${sql} ORDER BY l.at DESC, l.id DESC LIMIT 300`, ...params)
      .map((x) => ({ ...x, name: x.first_name ? fullName(x) : x.email }));
    const policy = geofencePolicy(settings());
    res.json({
      view, mode: policy.mode, items,
      summary: {
        total: items.length,
        inOffice: items.filter((x) => x.result === 'in-office' || x.result === 'office-network').length,
        outside: items.filter((x) => x.result === 'outside').length,
        blocked: items.filter((x) => /blocked|signed out/.test(x.event)).length,
      },
    });
  });

  // ---------- short hours ----------
  // view=mine: the employee's own days. view=team: days the user can approve
  // (direct reports; administrators see everyone). HR can view everyone.
  r.get('/attendance/short-hours', (req, res) => {
    const view = req.query.view === 'team' ? 'team' : 'mine';
    const where = [];
    const params = [];
    if (view === 'mine') {
      if (!req.user.employeeId) return res.json({ items: [], view });
      where.push('s.employee_id = ?');
      params.push(req.user.employeeId);
    } else if (!isHR(req.user)) {
      if (!req.user.employeeId) return res.json({ items: [], view });
      where.push('e.manager_id = ?');
      params.push(req.user.employeeId);
    } else if (req.user.employeeId) {
      where.push('s.employee_id != ?');
      params.push(req.user.employeeId);
    }
    if (req.query.status === 'open') where.push("s.status IN ('Awaiting explanation','Pending approval')");
    else if (req.query.status) { where.push('s.status = ?'); params.push(String(req.query.status)); }
    if (req.query.vertical) { where.push('e.vertical_id = ?'); params.push(Number(req.query.vertical)); }
    const rows = db.all(`SELECT s.* FROM hour_shortfalls s JOIN employees e ON e.id = s.employee_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE s.status WHEN 'Pending approval' THEN 0 WHEN 'Awaiting explanation' THEN 1 ELSE 2 END, s.date DESC LIMIT 300`, ...params);
    res.json({ view, items: rows.map((s) => shortfallRow(db, s, req.user)), required: fmtMinutes(Math.round(Number(settings().workHours || 8) * 60)) });
  });

  r.post('/attendance/short-hours/:id/explain', (req, res) => {
    const s = db.get('SELECT * FROM hour_shortfalls WHERE id = ?', id(req.params.id)) || notFound('Short-hours record');
    if (s.employee_id !== req.user.employeeId) fail(403, 'You can only explain your own hours');
    if (!['Awaiting explanation', 'Pending approval'].includes(s.status)) fail(409, `This day is already ${s.status.toLowerCase()}`);
    const reason = str(req.body.reason, { required: true, max: 1000, name: 'Reason' });
    db.update('hour_shortfalls', s.id, { reason, status: 'Pending approval', explained_at: new Date().toISOString() });
    notifyUsers(db, approverUserIds(db, s.employee_id), `${req.user.name} explained short hours on ${dayLabel(s.date)} (${fmtMinutes(s.worked_minutes)} of ${fmtMinutes(s.required_minutes)})`, '/attendance?tab=short');
    res.json({ ok: true });
  });

  r.post('/attendance/short-hours/:id/decide', (req, res) => {
    const s = db.get('SELECT * FROM hour_shortfalls WHERE id = ?', id(req.params.id)) || notFound('Short-hours record');
    if (!canDecideShortfall(db, req.user, s.employee_id)) fail(403, 'Only the reporting manager or the CEO can approve this');
    if (!['Awaiting explanation', 'Pending approval'].includes(s.status)) fail(409, `This day is already ${s.status.toLowerCase()}`);
    const action = oneOf(req.body.action, ['approve', 'reject'], { required: true, name: 'Action' });
    const note = str(req.body.note, { max: 500 });
    const att = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', s.employee_id, s.date);
    db.tx(() => {
      db.update('hour_shortfalls', s.id, { status: action === 'approve' ? 'Approved' : 'Rejected', decided_by: req.user.id, decided_at: new Date().toISOString(), decision_note: note });
      if (att) {
        const base = db.value('SELECT mode FROM work_sessions WHERE employee_id = ? AND date = ? ORDER BY start_at LIMIT 1', s.employee_id, s.date) === 'wfh' || att.status === 'WFH' ? 'WFH' : 'P';
        const status = action === 'approve' ? (att.status === 'HD' ? base : att.status) : 'HD';
        db.run('UPDATE attendance SET status = ?, note = ?, updated_by = ? WHERE employee_id = ? AND date = ?', status, `Short hours ${action === 'approve' ? 'approved' : 'rejected'} by ${req.user.name}`, req.user.id, s.employee_id, s.date);
      }
    });
    audit(db, req.user, `shortfall.${action}`, 'employee', s.employee_id, { date: s.date, note });
    notifyUsers(db, [userIdForEmployee(db, s.employee_id)], action === 'approve'
      ? `${req.user.name} approved your short hours on ${dayLabel(s.date)}. The day counts in full.`
      : `${req.user.name} did not approve your short hours on ${dayLabel(s.date)}; it is marked as a half day.${note ? ` Note: ${note}` : ''}`, '/attendance?tab=short');
    res.json({ ok: true });
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
