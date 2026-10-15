import {
  today, isHR, scopeIds, canSeeEmployee, requireHR, fullName, str, num, date, oneOf, id, fail, notFound,
  notifyUsers, hrUserIds, managerUserId, userIdForEmployee, audit, getSettings,
} from '../core.js';
import * as D from '../lib/dates.js';
import { leaveDaysByYear, isWorkingDay } from '../lib/leave.js';
import { balances, leaveTypesFor } from '../services/leave.js';
import { calendarCtx } from '../services/calendar.js';

const LIST_SELECT = `
  SELECT r.*, t.name AS type, t.code, t.color, t.kind, e.first_name, e.last_name, e.code AS emp_code, e.designation,
         e.photo IS NOT NULL AS has_photo, d.name AS department, v.short AS vertical, v.color AS vertical_color,
         u.email AS decided_by_email, de.first_name AS dec_first, de.last_name AS dec_last
  FROM leave_requests r
  JOIN leave_types t ON t.id = r.leave_type_id
  JOIN employees e ON e.id = r.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN verticals v ON v.id = e.vertical_id
  LEFT JOIN users u ON u.id = r.decided_by
  LEFT JOIN employees de ON de.id = u.employee_id`;

const shape = (r) => ({ ...r, name: fullName(r), decided_by_name: r.dec_first ? fullName({ first_name: r.dec_first, last_name: r.dec_last }) : r.decided_by_email || null });

function canApprove(db, user, employeeId) {
  if (user.employeeId === employeeId && !isHR(user)) return false;
  if (isHR(user)) return true;
  const scope = scopeIds(db, user);
  return scope !== null && scope.includes(employeeId) && employeeId !== user.employeeId;
}

export default function leaveRoutes(r, { db }) {
  r.get('/leave/overview', (req, res) => {
    const T = today(db);
    const year = Number(req.query.year) || D.yearOf(T);
    const scope = scopeIds(db, req.user);
    const approvable = isHR(req.user) ? null : scope.filter((x) => x !== req.user.employeeId);
    const apWhere = approvable === null ? '1=1' : approvable.length ? `r.employee_id IN (${approvable.map(() => '?').join(',')})` : '0=1';
    const pendingApprovals = db.all(`SELECT r.created_at FROM leave_requests r WHERE r.status = 'Pending' AND ${apWhere} ${req.user.employeeId ? 'AND r.employee_id != ?' : ''}`,
      ...(approvable || []), ...(req.user.employeeId ? [req.user.employeeId] : []));
    const avgAge = pendingApprovals.length ? pendingApprovals.reduce((t, x) => t + (Date.now() - new Date(x.created_at).getTime()) / 86400000, 0) / pendingApprovals.length : 0;
    const emp = req.user.employeeId ? db.get('SELECT * FROM employees WHERE id = ?', req.user.employeeId) : null;
    const bal = emp ? balances(db, emp, year, year === D.yearOf(T) ? T : `${year}-12-31`, calendarCtx(db)) : [];
    const myPending = emp ? db.value("SELECT COUNT(*) FROM leave_requests WHERE employee_id = ? AND status = 'Pending'", emp.id) : 0;
    const current = db.all("SELECT id FROM employees WHERE status != 'Exited' AND join_date <= ?", T).map((x) => x.id);
    const required = db.value('SELECT COUNT(*) FROM policies WHERE requires_ack = 1');
    const acked = required ? db.value(`SELECT COUNT(*) FROM (SELECT a.employee_id FROM policy_acks a JOIN policies p ON p.id = a.policy_id AND p.version = a.version AND p.requires_ack = 1
      JOIN employees e ON e.id = a.employee_id AND e.status != 'Exited' GROUP BY a.employee_id HAVING COUNT(*) >= ?)`, required) : 0;
    const orgPending = isHR(req.user) ? db.value("SELECT COUNT(*) FROM leave_requests WHERE status = 'Pending'") : myPending;
    res.json({
      year,
      balances: bal,
      totalBalance: bal.filter((b) => b.available != null && ['EL', 'CL', 'SL'].includes(b.code)).reduce((t, b) => t + b.available, 0),
      pendingRequests: orgPending,
      pendingApprovals: pendingApprovals.length,
      avgApprovalAgeDays: Math.round(avgAge * 10) / 10,
      holidays: db.value("SELECT COUNT(*) FROM holidays WHERE type = 'Company' AND date BETWEEN ? AND ?", `${year}-01-01`, `${year}-12-31`),
      policyAckPct: current.length ? Math.round((acked / current.length) * 100) : 0,
    });
  });

  r.get('/leave/requests', (req, res) => {
    const scopeName = req.query.scope || 'mine';
    const where = [];
    const params = [];
    if (scopeName === 'mine') {
      where.push('r.employee_id = ?');
      params.push(req.user.employeeId || 0);
    } else {
      const scope = scopeIds(db, req.user);
      let ids = scope;
      if (scopeName === 'approvals' || scopeName === 'team') ids = scope === null ? null : scope.filter((x) => x !== req.user.employeeId);
      if (scopeName === 'team' && ids === null && req.user.employeeId) {
        // HR "team" = their own reports; fall back to everyone if they have none.
        const own = db.all('SELECT id FROM employees WHERE manager_id = ?', req.user.employeeId).map((x) => x.id);
        if (own.length) ids = own;
      }
      if (ids !== null) {
        where.push(ids.length ? `r.employee_id IN (${ids.map(() => '?').join(',')})` : '0=1');
        params.push(...ids);
      }
      if (scopeName === 'approvals') {
        where.push("r.status = 'Pending'");
        if (req.user.employeeId) { where.push('r.employee_id != ?'); params.push(req.user.employeeId); }
      }
    }
    if (req.query.status) { where.push('r.status = ?'); params.push(req.query.status); }
    if (req.query.type) { where.push('t.code = ?'); params.push(req.query.type); }
    if (req.query.employee) { where.push('r.employee_id = ?'); params.push(Number(req.query.employee)); }
    if (req.query.from) { where.push('r.to_date >= ?'); params.push(req.query.from); }
    if (req.query.to) { where.push('r.from_date <= ?'); params.push(req.query.to); }
    const limit = Math.min(500, Number(req.query.limit) || 100);
    const rows = db.all(`${LIST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY r.status = 'Pending' DESC, r.from_date DESC LIMIT ?`, ...params, limit);
    res.json({ items: rows.map((x) => ({ ...shape(x), canDecide: x.status === 'Pending' && canApprove(db, req.user, x.employee_id) })) });
  });

  function validateRequest(body, user) {
    const employeeId = body.employee_id ? id(body.employee_id) : user.employeeId;
    if (!employeeId) fail(400, 'Your login is not linked to an employee record');
    if (employeeId !== user.employeeId && !isHR(user)) fail(403, 'Only HR can apply leave on behalf of someone else');
    const emp = db.get('SELECT * FROM employees WHERE id = ?', employeeId) || notFound('Employee');
    if (emp.status === 'Exited') fail(400, 'This employee has exited');
    const type = db.get('SELECT * FROM leave_types WHERE id = ? AND active = 1', id(body.leave_type_id)) || fail(400, 'Choose a leave type');
    if (type.gender && emp.gender && type.gender !== emp.gender) fail(400, `${type.name} is not applicable`);
    const from = date(body.from_date, { required: true, name: 'From date' });
    const to = date(body.to_date || body.from_date, { required: true, name: 'To date' });
    if (to < from) fail(400, 'To date must be on or after the from date');
    if (D.diffDays(from, to) > 200) fail(400, 'Leave cannot exceed 200 days in one request');
    const halfDay = Boolean(body.half_day);
    if (halfDay && from !== to) fail(400, 'Half day leave must be a single date');
    if (from < emp.join_date) fail(400, 'Leave cannot start before the joining date');
    const T = today(db);
    if (from < D.addDays(T, -45) && !isHR(user)) fail(400, 'Leave older than 45 days must be applied by HR');
    const ctx = calendarCtx(db);
    const perYear = leaveDaysByYear({ from, to, halfDay, calendarDays: Boolean(type.calendar_days) }, ctx);
    const days = [...perYear.values()].reduce((a, b) => a + b, 0);
    if (!days) fail(400, 'The selected dates are weekly offs or holidays');
    const overlap = db.get("SELECT id FROM leave_requests WHERE employee_id = ? AND status IN ('Pending','Approved') AND from_date <= ? AND to_date >= ?", employeeId, to, from);
    if (overlap) fail(409, 'You already have leave applied for some of these dates');
    if (type.annual_quota != null) {
      for (const [year, n] of perYear) {
        const b = balances(db, emp, year, year === D.yearOf(T) ? (to > T ? to : T) : `${year}-12-31`, ctx).find((x) => x.typeId === type.id);
        if (b && b.available != null && b.available < n) fail(400, `Not enough ${type.name} balance for ${year}: ${b.available} day(s) available, ${n} requested`);
      }
    }
    return { emp, type, from, to, halfDay, days };
  }

  r.post('/leave/preview', (req, res) => {
    try {
      const v = validateRequest(req.body, req.user);
      res.json({ ok: true, days: v.days });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  r.post('/leave/requests', (req, res) => {
    const v = validateRequest(req.body, req.user);
    const reason = str(req.body.reason, { max: 500 });
    const onBehalf = v.emp.id !== req.user.employeeId;
    const autoApprove = onBehalf && isHR(req.user) && req.body.approve === true;
    const rid = db.insert('leave_requests', {
      employee_id: v.emp.id, leave_type_id: v.type.id, from_date: v.from, to_date: v.to, half_day: v.halfDay, days: v.days, reason,
      status: autoApprove ? 'Approved' : 'Pending', decided_by: autoApprove ? req.user.id : null, decided_at: autoApprove ? new Date().toISOString() : null,
    });
    const name = fullName(v.emp);
    const when = v.from === v.to ? D.parseYmd(v.from).toDateString().slice(4, 10) : `${D.parseYmd(v.from).toDateString().slice(4, 10)} – ${D.parseYmd(v.to).toDateString().slice(4, 10)}`;
    if (!autoApprove) {
      const mgr = managerUserId(db, v.emp.id);
      notifyUsers(db, mgr ? [mgr] : hrUserIds(db), `${name} applied for ${v.days} day(s) of ${v.type.name} (${when})`, '/leave?tab=manage');
    } else {
      notifyUsers(db, [userIdForEmployee(db, v.emp.id)], `HR recorded ${v.days} day(s) of ${v.type.name} for you (${when})`, '/leave');
    }
    audit(db, req.user, 'leave.apply', 'leave_request', rid);
    res.json({ id: rid, days: v.days });
  });

  r.post('/leave/requests/:id/decision', (req, res) => {
    const rid = id(req.params.id);
    const lr = db.get('SELECT r.*, t.name AS type FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id WHERE r.id = ?', rid) || notFound('Leave request');
    if (!canApprove(db, req.user, lr.employee_id)) fail(403, 'You cannot approve this request');
    if (lr.status !== 'Pending') fail(409, `This request is already ${lr.status.toLowerCase()}`);
    const action = oneOf(req.body.action, ['approve', 'reject'], { required: true, name: 'Action' });
    const note = str(req.body.note, { max: 300 });
    if (action === 'reject' && !note && req.body.requireNote) fail(400, 'Add a reason for rejecting');
    const status = action === 'approve' ? 'Approved' : 'Rejected';
    db.update('leave_requests', rid, { status, decided_by: req.user.id, decided_at: new Date().toISOString(), decision_note: note });
    notifyUsers(db, [userIdForEmployee(db, lr.employee_id)], `Your ${lr.type} request (${lr.from_date}${lr.to_date !== lr.from_date ? ` to ${lr.to_date}` : ''}) was ${status.toLowerCase()}${note ? `: ${note}` : ''}`, '/leave');
    audit(db, req.user, `leave.${action}`, 'leave_request', rid);
    res.json({ ok: true, status });
  });

  r.post('/leave/requests/:id/cancel', (req, res) => {
    const rid = id(req.params.id);
    const lr = db.get('SELECT * FROM leave_requests WHERE id = ?', rid) || notFound('Leave request');
    const own = lr.employee_id === req.user.employeeId;
    if (!own && !isHR(req.user)) fail(403, 'You cannot cancel this request');
    if (!['Pending', 'Approved'].includes(lr.status)) fail(409, 'Only pending or approved leave can be cancelled');
    if (own && !isHR(req.user) && lr.status === 'Approved' && lr.from_date <= today(db)) fail(400, 'Leave that has already started can only be cancelled by HR');
    db.update('leave_requests', rid, { status: 'Cancelled', decision_note: str(req.body.note, { max: 300 }) || (own ? 'Cancelled by employee' : 'Cancelled by HR'), decided_at: new Date().toISOString() });
    if (!own) notifyUsers(db, [userIdForEmployee(db, lr.employee_id)], `Your leave from ${lr.from_date} was cancelled by HR`, '/leave');
    res.json({ ok: true });
  });

  r.get('/leave/balances', (req, res) => {
    const T = today(db);
    const eid = req.query.employee ? id(req.query.employee) : req.user.employeeId;
    if (!eid) return res.json({ items: [] });
    if (!canSeeEmployee(db, req.user, eid)) fail(403, 'You cannot view this balance');
    const emp = db.get('SELECT * FROM employees WHERE id = ?', eid) || notFound('Employee');
    const year = Number(req.query.year) || D.yearOf(T);
    res.json({ items: balances(db, emp, year, year === D.yearOf(T) ? T : `${year}-12-31`, calendarCtx(db)), types: leaveTypesFor(db, emp).map((t) => t.id) });
  });

  r.get('/leave/calendar', (req, res) => {
    const T = today(db);
    const from = date(req.query.from) || T;
    const to = date(req.query.to) || D.addDays(from, 6);
    if (D.diffDays(from, to) > 62) fail(400, 'Choose a range of up to two months');
    let ids = scopeIds(db, req.user);
    if (ids !== null && req.user.role === 'employee' && req.user.employeeId) {
      const mgr = db.value('SELECT manager_id FROM employees WHERE id = ?', req.user.employeeId);
      ids = mgr ? db.all("SELECT id FROM employees WHERE (manager_id = ? OR id = ?) AND status != 'Exited'", mgr, mgr).map((x) => x.id) : ids;
    }
    const where = ["r.status IN ('Approved','Pending')", 'r.from_date <= ?', 'r.to_date >= ?'];
    const params = [to, from];
    if (ids !== null) { where.push(ids.length ? `r.employee_id IN (${ids.map(() => '?').join(',')})` : '0=1'); params.push(...ids); }
    if (req.query.department) { where.push('e.department_id = ?'); params.push(Number(req.query.department)); }
    if (req.query.vertical) { where.push('e.vertical_id = ?'); params.push(Number(req.query.vertical)); }
    if (req.query.type) { where.push('t.code = ?'); params.push(req.query.type); }
    const rows = db.all(`${LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.first_name, r.from_date`, ...params);
    const byEmp = new Map();
    for (const x of rows) {
      if (!byEmp.has(x.employee_id)) byEmp.set(x.employee_id, { id: x.employee_id, name: fullName(x), designation: x.designation, has_photo: x.has_photo, leaves: [] });
      byEmp.get(x.employee_id).leaves.push({ id: x.id, from: x.from_date, to: x.to_date, type: x.type, code: x.code, color: x.color, status: x.status, half_day: x.half_day });
    }
    const holidays = db.all('SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date', from, to);
    res.json({ from, to, employees: [...byEmp.values()], holidays, weeklyOffs: getSettings(db).weeklyOffs });
  });

  // ---------- holidays ----------
  r.get('/holidays', (req, res) => {
    const year = Number(req.query.year) || D.yearOf(today(db));
    res.json({ items: db.all('SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date', `${year}-01-01`, `${year}-12-31`) });
  });
  // Year view for the holiday calendar: holidays, weekly offs and the
  // signed-in employee's own leave (approved and pending), day by day.
  r.get('/holidays/calendar', (req, res) => {
    const T = today(db);
    const year = Number(req.query.year) || D.yearOf(T);
    if (year < 2000 || year > 2100) fail(400, 'Choose a year between 2000 and 2100');
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const settings = getSettings(db);
    const ctx = calendarCtx(db, settings);
    const myLeave = [];
    if (req.user.employeeId) {
      const rows = db.all(`SELECT r.from_date, r.to_date, r.half_day, r.status, t.name, t.code, t.color, t.calendar_days FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
        WHERE r.employee_id = ? AND r.status IN ('Approved','Pending') AND r.from_date <= ? AND r.to_date >= ?`, req.user.employeeId, to, from);
      for (const r of rows) {
        for (const d of D.eachDay(r.from_date < from ? from : r.from_date, r.to_date > to ? to : r.to_date)) {
          if (!r.calendar_days && !isWorkingDay(d, ctx)) continue;
          myLeave.push({ date: d, name: r.name, code: r.code, color: r.color, status: r.status, half: Boolean(r.half_day) });
        }
      }
    }
    res.json({
      year, today: T, weeklyOffs: settings.weeklyOffs,
      holidays: db.all('SELECT * FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date', from, to),
      years: db.all("SELECT DISTINCT substr(date, 1, 4) AS y FROM holidays ORDER BY y").map((x) => Number(x.y)),
      myLeave,
    });
  });

  r.post('/holidays', (req, res) => {
    requireHR(req);
    const hid = db.insert('holidays', {
      date: date(req.body.date, { required: true }),
      name: str(req.body.name, { required: true, max: 80, name: 'Holiday name' }),
      type: oneOf(req.body.type || 'Company', ['Company', 'Restricted'], { name: 'Type' }),
    });
    res.json({ id: hid });
  });
  r.delete('/holidays/:id', (req, res) => {
    requireHR(req);
    db.run('DELETE FROM holidays WHERE id = ?', id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- leave policy builder ----------
  r.get('/leave/types', (_req, res) => {
    res.json({ items: db.all('SELECT * FROM leave_types ORDER BY sort, id') });
  });
  function readType(b) {
    return {
      name: str(b.name, { required: true, max: 60, name: 'Name' }),
      annual_quota: b.annual_quota === '' || b.annual_quota == null ? null : num(b.annual_quota, { min: 0, max: 400, name: 'Annual quota' }),
      accrual: oneOf(b.accrual || 'annual', ['annual', 'monthly'], { name: 'Accrual' }),
      carry_forward_max: num(b.carry_forward_max ?? 0, { min: 0, max: 400, name: 'Carry forward' }),
      paid: b.paid === false || b.paid === 0 ? 0 : 1,
      calendar_days: b.calendar_days ? 1 : 0,
      gender: oneOf(b.gender || null, ['M', 'F'], { name: 'Gender' }),
      kind: oneOf(b.kind || 'leave', ['leave', 'wfh'], { name: 'Kind' }),
      color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#2F6FED',
      rule: str(b.rule, { max: 160 }),
      active: b.active === false || b.active === 0 ? 0 : 1,
    };
  }
  r.post('/leave/types', (req, res) => {
    requireHR(req);
    const code = str(req.body.code, { required: true, max: 6, name: 'Code' }).toUpperCase();
    if (!/^[A-Z]{2,6}$/.test(code)) fail(400, 'Code must be 2-6 letters');
    const tid = db.insert('leave_types', { code, ...readType(req.body), sort: (db.value('SELECT MAX(sort) FROM leave_types') ?? 0) + 1 });
    audit(db, req.user, 'leave_type.create', 'leave_type', tid);
    res.json({ id: tid });
  });
  r.put('/leave/types/:id', (req, res) => {
    requireHR(req);
    const tid = id(req.params.id);
    db.get('SELECT 1 FROM leave_types WHERE id = ?', tid) || notFound('Leave type');
    db.update('leave_types', tid, readType(req.body));
    audit(db, req.user, 'leave_type.update', 'leave_type', tid);
    res.json({ ok: true });
  });

  // Year-end view of every employee's balance (HR).
  r.get('/leave/register', (req, res) => {
    requireHR(req);
    const T = today(db);
    const year = Number(req.query.year) || D.yearOf(T);
    const ctx = calendarCtx(db);
    const emps = db.all(`SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status != 'Exited' AND e.join_date <= ? ORDER BY e.first_name`, `${year}-12-31`);
    res.json({
      year,
      items: emps.map((e) => ({ id: e.id, code: e.code, name: fullName(e), department: e.department, balances: balances(db, e, year, year === D.yearOf(T) ? T : `${year}-12-31`, ctx) })),
    });
  });
}
