import { today, isHR, scopeIds, requireHR, fullName, str, num, date, oneOf, id, fail, notFound, getSettings, notifyUsers, hrUserIds, managerUserId, userIdForEmployee, audit } from '../core.js';
import { json } from '../db.js';
import * as D from '../lib/dates.js';
import { headcountOn } from './dashboard.js';

export const REASONS = ['Better Opportunities', 'Career Growth', 'Compensation', 'Personal Reasons', 'Work-Life Balance', 'Relocation', 'Higher Studies', 'Health', 'Other'];
export const CHECKLIST = [
  ['manager_approval', 'Manager Approval'], ['hr_review', 'HR Review'], ['knowledge_transfer', 'Knowledge Transfer'], ['handover', 'Handover Tasks'],
  ['exit_interview', 'Exit Interview'], ['asset_return', 'Asset Return'], ['access_revocation', 'Access Revocation'], ['fnf', 'Full & Final Settlement'],
];
const CLEARANCE = [['manager', 'Reporting Manager'], ['it', 'IT (Access & Assets)'], ['admin', 'Admin (Assets)'], ['finance', 'Finance (F&F)']];

const SELECT = `
  SELECT r.*, e.first_name, e.last_name, e.code, e.designation, e.grade, e.join_date, e.manager_id, e.photo IS NOT NULL AS has_photo, e.status AS emp_status,
         d.name AS department, v.short AS vertical, v.color AS vertical_color
  FROM resignations r JOIN employees e ON e.id = r.employee_id
  LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN verticals v ON v.id = e.vertical_id`;

function shape(r) {
  const checklist = json(r.checklist, {});
  const clearance = json(r.clearance, {});
  const done = CHECKLIST.filter(([k]) => checklist[k]?.status === 'Completed').length;
  return {
    ...r, name: fullName(r), steps: json(r.steps, {}), checklist, clearance, exit_interview: json(r.exit_interview, null), settlement: json(r.settlement, null), letters: json(r.letters, {}),
    progress: { done, total: CHECKLIST.length },
  };
}

export default function resignationRoutes(r, { db }) {
  const load = (rid) => db.get(`${SELECT} WHERE r.id = ?`, id(rid)) || notFound('Resignation');
  const canManagerAct = (user, row) => isHR(user) || (user.role === 'manager' && scopeIds(db, user).includes(row.employee_id) && row.employee_id !== user.employeeId);
  const canView = (user, row) => isHR(user) || row.employee_id === user.employeeId || canManagerAct(user, row);

  r.get('/resignations', (req, res) => {
    const T = today(db);
    const scope = scopeIds(db, req.user);
    const where = [];
    const params = [];
    if (scope !== null) { where.push(scope.length ? `r.employee_id IN (${scope.map(() => '?').join(',')})` : '0=1'); params.push(...scope); }
    if (req.query.status) { where.push('r.status = ?'); params.push(req.query.status); }
    const rows = db.all(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.submitted_on DESC`, ...params).map(shape);
    const year = T.slice(0, 4);
    const thisYear = rows.filter((x) => x.submitted_on.slice(0, 4) === year);
    const month = D.monthOf(T);
    const prev = rows.filter((x) => x.submitted_on.slice(0, 7) === D.addMonths(month, -1)).length;
    const cur = rows.filter((x) => x.submitted_on.slice(0, 7) === month).length;
    const reasons = REASONS.map((label) => ({ label, value: thisYear.filter((x) => x.reason_category === label).length })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    const f = { sql: scope === null ? '1=1' : scope.length ? `e.id IN (${scope.map(() => '?').join(',')})` : '0=1', params: scope || [] };
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const m = D.addMonths(month, -i);
      const end = m === month ? T : D.monthEnd(m);
      const exits = db.value(`SELECT COUNT(*) FROM employees e WHERE e.exit_date BETWEEN ? AND ? AND ${f.sql}`, D.monthStart(m), end, ...f.params);
      const avg = (headcountOn(db, D.monthStart(m), f) + headcountOn(db, end, f)) / 2;
      trend.push({ month: m, label: D.shortMonth(m), resignations: rows.filter((x) => x.submitted_on.slice(0, 7) === m).length, exits, rate: avg ? Math.round((exits / avg) * 1000) / 10 : 0 });
    }
    res.json({
      items: rows,
      kpis: {
        total: thisYear.length,
        totalChange: prev ? Math.round(((cur - prev) / prev) * 100) : null,
        approved: thisYear.filter((x) => ['Approved', 'In Progress', 'Completed'].includes(x.status)).length,
        pending: rows.filter((x) => x.status === 'Pending').length,
        avgNotice: thisYear.length ? Math.round(thisYear.reduce((t, x) => t + x.notice_days, 0) / thisYear.length) : 0,
      },
      reasons,
      trend,
      reasonOptions: REASONS,
      checklistLabels: CHECKLIST,
      clearanceLabels: CLEARANCE,
      mine: req.user.employeeId ? rows.find((x) => x.employee_id === req.user.employeeId && !['Rejected', 'Withdrawn'].includes(x.status)) || null : null,
    });
  });

  r.get('/resignations/:id', (req, res) => {
    const row = load(req.params.id);
    if (!canView(req.user, row)) fail(403, 'You cannot view this resignation');
    const assets = db.all('SELECT * FROM assets WHERE employee_id = ?', row.employee_id);
    res.json({ ...shape(row), assets, checklistLabels: CHECKLIST, clearanceLabels: CLEARANCE, canManage: isHR(req.user), canManagerAct: canManagerAct(req.user, row) });
  });

  r.post('/resignations', (req, res) => {
    const employeeId = req.body.employee_id ? id(req.body.employee_id) : req.user.employeeId;
    if (!employeeId) fail(400, 'Your login is not linked to an employee record');
    if (employeeId !== req.user.employeeId) requireHR(req);
    const e = db.get('SELECT * FROM employees WHERE id = ?', employeeId) || notFound('Employee');
    if (e.status === 'Exited') fail(400, 'This employee has already exited');
    if (db.value("SELECT 1 FROM resignations WHERE employee_id = ? AND status IN ('Pending','Approved','In Progress')", employeeId)) fail(409, 'There is already an active resignation');
    const T = today(db);
    const s = getSettings(db);
    const notice = ['Manager', 'Head', 'CXO'].includes(e.grade) ? s.noticePeriodSeniorDays : s.noticePeriodDays;
    const requested = date(req.body.last_working_day, { name: 'Last working day' });
    if (requested && requested < T) fail(400, 'Last working day cannot be in the past');
    const lwd = requested || D.addDays(T, notice);
    const rid = db.insert('resignations', {
      employee_id: employeeId, submitted_on: T,
      reason_category: oneOf(req.body.reason_category, REASONS, { required: true, name: 'Reason' }),
      reason: str(req.body.reason, { max: 1000 }),
      notice_days: notice, last_working_day: lwd, status: 'Pending',
      steps: { submitted: new Date().toISOString() },
      checklist: Object.fromEntries(CHECKLIST.map(([k]) => [k, { status: 'Pending' }])),
      clearance: Object.fromEntries(CLEARANCE.map(([k]) => [k, { status: 'Pending' }])),
    });
    const mgr = managerUserId(db, employeeId);
    notifyUsers(db, [mgr, ...hrUserIds(db)], `${fullName(e)} submitted a resignation (requested last day ${lwd})`, `/resignation?id=${rid}`);
    audit(db, req.user, 'resignation.submit', 'resignation', rid);
    res.json({ id: rid });
  });

  const save = (row, patch) => db.update('resignations', row.id, patch);

  r.post('/resignations/:id/manager-decision', (req, res) => {
    const row = load(req.params.id);
    if (!canManagerAct(req.user, row)) fail(403, 'Only the reporting manager or HR can decide');
    if (row.status !== 'Pending') fail(409, 'This resignation is not waiting for manager approval');
    const action = oneOf(req.body.action, ['approve', 'reject'], { required: true, name: 'Action' });
    const steps = { ...json(row.steps, {}), manager: new Date().toISOString() };
    const checklist = json(row.checklist, {});
    const note = str(req.body.note, { max: 500 });
    if (action === 'approve') {
      checklist.manager_approval = { status: 'Completed', at: steps.manager, by: req.user.name };
      save(row, { status: 'Approved', steps, checklist, decision_note: note });
      notifyUsers(db, hrUserIds(db), `${fullName(row)}'s resignation was approved by the manager and needs HR review`, `/resignation?id=${row.id}`);
    } else {
      save(row, { status: 'Rejected', steps, decision_note: note || 'Not accepted' });
    }
    notifyUsers(db, [userIdForEmployee(db, row.employee_id)], `Your resignation was ${action === 'approve' ? 'approved by your manager' : 'not accepted'}${note ? `: ${note}` : ''}`, '/resignation');
    res.json({ ok: true });
  });

  r.post('/resignations/:id/hr-review', (req, res) => {
    requireHR(req);
    const row = load(req.params.id);
    if (!['Pending', 'Approved'].includes(row.status)) fail(409, 'This resignation is not waiting for HR review');
    const action = oneOf(req.body.action, ['approve', 'reject'], { required: true, name: 'Action' });
    const now = new Date().toISOString();
    const steps = { ...json(row.steps, {}), hr: now };
    const checklist = json(row.checklist, {});
    if (action === 'reject') {
      save(row, { status: 'Rejected', steps, decision_note: str(req.body.note, { max: 500 }) || 'Not accepted' });
      notifyUsers(db, [userIdForEmployee(db, row.employee_id)], 'Your resignation was not accepted by HR', '/resignation');
      return res.json({ ok: true });
    }
    const lwd = date(req.body.last_working_day, { name: 'Last working day' }) || row.last_working_day;
    if (!steps.manager) steps.manager = now;
    checklist.manager_approval = checklist.manager_approval?.status === 'Completed' ? checklist.manager_approval : { status: 'Completed', at: now, by: req.user.name };
    checklist.hr_review = { status: 'Completed', at: now, by: req.user.name };
    save(row, { status: 'In Progress', steps, checklist, last_working_day: lwd });
    db.run("UPDATE employees SET status = 'Notice', exit_date = ? WHERE id = ?", lwd, row.employee_id);
    notifyUsers(db, [userIdForEmployee(db, row.employee_id)], `HR accepted your resignation. Your last working day is ${lwd}.`, '/resignation');
    audit(db, req.user, 'resignation.accept', 'resignation', row.id);
    res.json({ ok: true });
  });

  r.post('/resignations/:id/withdraw', (req, res) => {
    const row = load(req.params.id);
    if (row.employee_id !== req.user.employeeId && !isHR(req.user)) fail(403, 'You cannot withdraw this resignation');
    if (!['Pending', 'Approved', 'In Progress'].includes(row.status)) fail(409, 'This resignation can no longer be withdrawn');
    if (row.status === 'In Progress' && !isHR(req.user)) fail(400, 'Talk to HR to withdraw an accepted resignation');
    save(row, { status: 'Withdrawn', decision_note: str(req.body.note, { max: 300 }) || 'Withdrawn' });
    db.run("UPDATE employees SET status = 'Active', exit_date = NULL WHERE id = ? AND status = 'Notice'", row.employee_id);
    notifyUsers(db, [managerUserId(db, row.employee_id), ...hrUserIds(db)], `${fullName(row)} withdrew their resignation`, '/resignation');
    res.json({ ok: true });
  });

  r.put('/resignations/:id/checklist', (req, res) => {
    const row = load(req.params.id);
    const key = oneOf(req.body.key, CHECKLIST.map(([k]) => k), { required: true, name: 'Checklist item' });
    const managerKeys = ['knowledge_transfer', 'handover'];
    if (!isHR(req.user) && !(managerKeys.includes(key) && canManagerAct(req.user, row))) fail(403, 'You cannot update this item');
    if (!['In Progress', 'Approved'].includes(row.status)) fail(409, 'Offboarding has not started for this resignation');
    const status = oneOf(req.body.status, ['Pending', 'In Progress', 'Completed'], { required: true, name: 'Status' });
    const checklist = json(row.checklist, {});
    checklist[key] = { status, at: new Date().toISOString(), by: req.user.name };
    const steps = json(row.steps, {});
    const offboarding = ['knowledge_transfer', 'handover', 'asset_return', 'access_revocation'];
    if (offboarding.every((k) => checklist[k]?.status === 'Completed')) steps.checklist = steps.checklist || new Date().toISOString();
    save(row, { checklist, steps });
    if (key === 'asset_return' && status === 'Completed') db.run("UPDATE assets SET status = 'Returned', returned_on = ? WHERE employee_id = ? AND status = 'Issued'", today(db), row.employee_id);
    if (key === 'access_revocation' && status === 'Completed' && row.last_working_day <= today(db)) db.run('UPDATE users SET active = 0 WHERE employee_id = ?', row.employee_id);
    res.json({ ok: true });
  });

  r.put('/resignations/:id/clearance', (req, res) => {
    requireHR(req);
    const row = load(req.params.id);
    const key = oneOf(req.body.key, CLEARANCE.map(([k]) => k), { required: true, name: 'Department' });
    const status = oneOf(req.body.status, ['Pending', 'Approved'], { required: true, name: 'Status' });
    const clearance = json(row.clearance, {});
    clearance[key] = status === 'Approved' ? { status, by: str(req.body.by, { max: 80 }) || req.user.name, at: new Date().toISOString() } : { status };
    save(row, { clearance });
    res.json({ ok: true });
  });

  r.post('/resignations/:id/exit-interview', (req, res) => {
    const row = load(req.params.id);
    if (!isHR(req.user) && row.employee_id !== req.user.employeeId) fail(403, 'You cannot submit this exit interview');
    const data = {
      rating: num(req.body.rating, { required: true, min: 1, max: 5, int: true, name: 'Rating' }),
      joinAgain: Boolean(req.body.joinAgain),
      liked: str(req.body.liked, { max: 1000 }),
      improve: str(req.body.improve, { max: 1000 }),
      feedback: str(req.body.feedback, { max: 2000 }),
      submittedBy: req.user.name,
      at: new Date().toISOString(),
    };
    const checklist = json(row.checklist, {});
    checklist.exit_interview = { status: 'Completed', at: data.at, by: req.user.name };
    save(row, { exit_interview: data, checklist, steps: { ...json(row.steps, {}), exit_interview: data.at } });
    res.json({ ok: true });
  });

  r.post('/resignations/:id/settlement', (req, res) => {
    requireHR(req);
    const row = load(req.params.id);
    const data = { amount: num(req.body.amount, { required: true, min: 0, max: 100000000, name: 'Amount' }), paidOn: date(req.body.paid_on, { name: 'Paid on' }), notes: str(req.body.notes, { max: 500 }) };
    const checklist = json(row.checklist, {});
    if (data.paidOn) checklist.fnf = { status: 'Completed', at: new Date().toISOString(), by: req.user.name };
    save(row, { settlement: data, checklist, steps: data.paidOn ? { ...json(row.steps, {}), settlement: new Date().toISOString() } : json(row.steps, {}) });
    res.json({ ok: true });
  });

  r.put('/resignations/:id/rehire', (req, res) => {
    requireHR(req);
    const row = load(req.params.id);
    const letters = { ...json(row.letters, {}) };
    if ('experience' in req.body) letters.experience = Boolean(req.body.experience);
    if ('relieving' in req.body) letters.relieving = Boolean(req.body.relieving);
    save(row, { rehire_eligible: req.body.rehire_eligible == null ? row.rehire_eligible : (req.body.rehire_eligible ? 1 : 0), letters });
    res.json({ ok: true });
  });

  r.post('/resignations/:id/complete', (req, res) => {
    requireHR(req);
    const row = load(req.params.id);
    if (row.status !== 'In Progress') fail(409, 'Only resignations in progress can be completed');
    if (row.last_working_day > today(db)) fail(400, `The last working day (${row.last_working_day}) has not passed yet`);
    const checklist = json(row.checklist, {});
    const open = CHECKLIST.filter(([k]) => checklist[k]?.status !== 'Completed').map(([, l]) => l);
    if (open.length) fail(400, `Complete these first: ${open.join(', ')}`);
    save(row, { status: 'Completed' });
    db.run("UPDATE employees SET status = 'Exited', exit_date = ? WHERE id = ?", row.last_working_day, row.employee_id);
    db.run('UPDATE users SET active = 0 WHERE employee_id = ?', row.employee_id);
    audit(db, req.user, 'resignation.complete', 'resignation', row.id);
    res.json({ ok: true });
  });
}
