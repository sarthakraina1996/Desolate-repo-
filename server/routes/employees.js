import fs from 'node:fs';
import path from 'node:path';
import {
  today, isHR, canSeeEmployee, assertCanSee, requireHR, fullName, str, num, date, oneOf, email, id, strList,
  fail, notFound, getSettings, audit, notifyUsers, reportIds, sendCsv, DOC_CATEGORIES,
} from '../core.js';
import { json } from '../db.js';
import { hashPassword, tempPassword } from '../auth.js';
import * as D from '../lib/dates.js';
import { salaryStructure, estimateMonthlyTds } from '../lib/payroll.js';
import { balances } from '../services/leave.js';
import { calendarCtx, dayStatuses } from '../services/calendar.js';
import { IFSC_RE, ACCOUNT_RE } from '../services/payroll.js';

const TYPES = ['Full-time', 'Part-time', 'Contract', 'Intern'];
const STATUSES = ['Active', 'Notice', 'Exited'];
const GRADES = ['Executive', 'Senior', 'Manager', 'Head', 'CXO'];
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const ONBOARDING = ['Offer letter signed', 'Documents & KYC collected', 'Laptop and accounts set up', 'Welcome kit & ID card', 'Orientation and buddy assigned'];

const BASE_SELECT = `
  SELECT e.*, d.name AS department, v.name AS vertical, v.short AS vertical_short, v.color AS vertical_color, l.name AS location,
         m.first_name AS m_first, m.last_name AS m_last, m.designation AS m_designation, m.photo AS m_photo
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN verticals v ON v.id = e.vertical_id
  LEFT JOIN locations l ON l.id = e.location_id
  LEFT JOIN employees m ON m.id = e.manager_id`;

export function onLeaveToday(db, T) {
  return new Set(db.all(`SELECT DISTINCT r.employee_id FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
    WHERE r.status = 'Approved' AND t.kind = 'leave' AND r.from_date <= ? AND r.to_date >= ?`, T, T).map((x) => x.employee_id));
}

function listRow(e, leaveSet) {
  return {
    id: e.id, code: e.code, name: fullName(e), first_name: e.first_name, last_name: e.last_name, designation: e.designation, grade: e.grade,
    department: e.department, department_id: e.department_id, vertical: e.vertical, vertical_short: e.vertical_short, vertical_color: e.vertical_color, vertical_id: e.vertical_id,
    location: e.location, status: e.status === 'Active' && leaveSet.has(e.id) ? 'On Leave' : e.status, employment_type: e.employment_type,
    join_date: e.join_date, exit_date: e.exit_date, email: e.email, phone: e.phone, has_photo: Boolean(e.photo), manager: e.m_first ? fullName({ first_name: e.m_first, last_name: e.m_last }) : null,
  };
}

function nextCode(db) {
  const prefix = getSettings(db).employeeCodePrefix || 'BZ';
  const max = db.all('SELECT code FROM employees').map((r) => Number(String(r.code).replace(/\D/g, '')) || 0).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function readEmployeeBody(db, b, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const set = (k, v) => { if (!partial || has(k)) out[k] = v; };
  set('first_name', str(b.first_name, { required: !partial || has('first_name'), max: 60, name: 'First name' }));
  set('last_name', str(b.last_name, { max: 60 }) || '');
  if (!partial || has('email')) out.email = email(b.email, { required: true });
  set('phone', str(b.phone, { max: 20 }));
  set('gender', oneOf(b.gender || null, ['M', 'F', 'O'], { name: 'Gender' }));
  set('dob', date(b.dob, { name: 'Date of birth' }));
  for (const [k, table] of [['vertical_id', 'verticals'], ['department_id', 'departments'], ['location_id', 'locations']]) {
    if (!partial || has(k)) {
      const v = b[k] ? id(b[k]) : null;
      if (v && !db.value(`SELECT 1 FROM ${table} WHERE id = ?`, v)) fail(400, `Unknown ${k.replace('_id', '')}`);
      out[k] = v;
    }
  }
  set('designation', str(b.designation, { max: 80 }));
  set('grade', oneOf(b.grade || null, GRADES, { name: 'Grade' }));
  if (!partial || has('manager_id')) out.manager_id = b.manager_id ? id(b.manager_id) : null;
  set('employment_type', oneOf(b.employment_type || 'Full-time', TYPES, { name: 'Employment type' }));
  if (!partial || has('join_date')) out.join_date = date(b.join_date, { required: true, name: 'Joining date' });
  set('about', str(b.about, { max: 1000 }));
  if (!partial || has('skills')) out.skills = strList(b.skills);
  if (has('certifications')) {
    out.certifications = (Array.isArray(b.certifications) ? b.certifications : []).slice(0, 20).map((c) => ({
      name: str(c.name, { required: true, max: 100, name: 'Certification' }), issuer: str(c.issuer, { max: 80 }), issued: date(c.issued),
    }));
  }
  if (!partial || has('ctc')) out.ctc = num(b.ctc, { min: 0, max: 100000000, name: 'CTC' }) ?? 0;
  if (!partial || has('monthly_tds')) {
    out.monthly_tds = b.monthly_tds === '' || b.monthly_tds == null ? estimateMonthlyTds(out.ctc ?? 0, getSettings(db).payroll) : num(b.monthly_tds, { min: 0, max: 10000000, name: 'Monthly TDS' });
  }
  if (!partial || has('pan')) {
    const pan = str(b.pan, { max: 10 })?.toUpperCase() || null;
    if (pan && !PAN_RE.test(pan)) fail(400, 'PAN must look like ABCDE1234F');
    out.pan = pan;
  }
  if (!partial || has('uan')) {
    const uan = str(b.uan, { max: 12 });
    if (uan && !/^\d{12}$/.test(uan)) fail(400, 'UAN must be 12 digits');
    out.uan = uan;
  }
  set('bank_name', str(b.bank_name, { max: 80 }));
  if (!partial || has('bank_account')) {
    const acc = str(b.bank_account, { max: 18 });
    if (acc && !ACCOUNT_RE.test(acc)) fail(400, 'Bank account must be 9-18 digits');
    out.bank_account = acc;
  }
  if (!partial || has('ifsc')) {
    const ifsc = str(b.ifsc, { max: 11 })?.toUpperCase() || null;
    if (ifsc && !IFSC_RE.test(ifsc)) fail(400, 'IFSC must look like HDFC0001234');
    out.ifsc = ifsc;
  }
  set('address', str(b.address, { max: 300 }));
  set('emergency_contact', str(b.emergency_contact, { max: 150 }));
  return out;
}

export default function employeeRoutes(r, { db, uploads, upload }) {
  r.get('/employees', (req, res) => {
    const T = today(db);
    const where = [];
    const params = [];
    const status = req.query.status || 'current';
    if (status === 'current') where.push("e.status != 'Exited'");
    else if (STATUSES.includes(status)) { where.push('e.status = ?'); params.push(status); }
    for (const k of ['vertical', 'department', 'location']) {
      if (req.query[k]) { where.push(`e.${k}_id = ?`); params.push(Number(req.query[k])); }
    }
    if (req.query.type) { where.push('e.employment_type = ?'); params.push(req.query.type); }
    if (req.query.team === '1') {
      const team = reportIds(db, req.user.employeeId);
      where.push(team.length ? `e.id IN (${team.map(() => '?').join(',')})` : '0=1');
      params.push(...team);
    }
    const q = String(req.query.search || '').trim();
    if (q) {
      const like = `%${q.replace(/[%_]/g, '')}%`;
      where.push("(e.first_name || ' ' || e.last_name LIKE ? OR e.code LIKE ? OR e.designation LIKE ? OR d.name LIKE ? OR e.email LIKE ?)");
      params.push(like, like, like, like, like);
    }
    const sorts = { name: 'e.first_name, e.last_name', '-name': 'e.first_name DESC, e.last_name DESC', code: 'e.code', join: 'e.join_date', '-join': 'e.join_date DESC' };
    const order = sorts[req.query.sort] || sorts.name;
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 10));
    const page = Math.max(1, Number(req.query.page) || 1);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.value(`SELECT COUNT(*) FROM employees e LEFT JOIN departments d ON d.id = e.department_id ${w}`, ...params);
    const rows = db.all(`${BASE_SELECT} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
    const leaveSet = onLeaveToday(db, T);
    const month = D.monthOf(T);
    const kpi = db.get(`SELECT SUM(status != 'Exited' AND join_date <= ?) AS total, SUM(status = 'Active' AND join_date <= ?) AS active,
      SUM(join_date BETWEEN ? AND ?) AS joiners FROM employees`, T, T, D.monthStart(month), T);
    res.json({
      items: rows.map((e) => listRow(e, leaveSet)),
      total, page, pageSize,
      kpis: { total: kpi.total || 0, active: Math.max(0, (kpi.active || 0) - leaveSet.size), onLeave: leaveSet.size, joiners: kpi.joiners || 0 },
    });
  });

  r.get('/employees/export.csv', (req, res) => {
    requireHR(req);
    const rows = db.all(`${BASE_SELECT} ORDER BY e.code`);
    sendCsv(res, 'employees.csv', rows, [
      { label: 'Employee ID', value: 'code' }, { label: 'Name', value: (e) => fullName(e) }, { label: 'Email', value: 'email' }, { label: 'Phone', value: 'phone' },
      { label: 'Gender', value: 'gender' }, { label: 'Vertical', value: 'vertical' }, { label: 'Department', value: 'department' }, { label: 'Designation', value: 'designation' },
      { label: 'Grade', value: 'grade' }, { label: 'Manager', value: (e) => (e.m_first ? `${e.m_first} ${e.m_last}` : '') }, { label: 'Employment Type', value: 'employment_type' },
      { label: 'Location', value: 'location' }, { label: 'Joining Date', value: 'join_date' }, { label: 'Status', value: 'status' }, { label: 'Exit Date', value: 'exit_date' },
      { label: 'Annual CTC', value: 'ctc' }, { label: 'PAN', value: 'pan' }, { label: 'UAN', value: 'uan' }, { label: 'Bank', value: 'bank_name' }, { label: 'IFSC', value: 'ifsc' },
    ]);
  });

  r.get('/employees/:id', (req, res) => {
    const eid = id(req.params.id);
    const T = today(db);
    const e = db.get(`${BASE_SELECT} WHERE e.id = ?`, eid) || notFound('Employee');
    const full = canSeeEmployee(db, req.user, eid);
    const self = req.user.employeeId === eid;
    const sensitive = isHR(req.user) || self;
    const leaveSet = onLeaveToday(db, T);
    const base = {
      ...listRow(e, leaveSet), gender: e.gender, about: e.about, skills: json(e.skills, []), certifications: json(e.certifications, []), manager_id: e.manager_id,
      location_id: e.location_id, employment_type: e.employment_type,
    };
    const manager = e.manager_id ? { id: e.manager_id, name: fullName({ first_name: e.m_first, last_name: e.m_last }), designation: e.m_designation, has_photo: Boolean(e.m_photo) } : null;
    const reports = db.all("SELECT id, first_name, last_name, designation, photo IS NOT NULL AS has_photo, status FROM employees WHERE manager_id = ? AND status != 'Exited' ORDER BY first_name", eid).map((x) => ({ ...x, name: fullName(x) }));
    const peers = e.manager_id ? db.all("SELECT id, first_name, last_name, designation, photo IS NOT NULL AS has_photo FROM employees WHERE manager_id = ? AND id != ? AND status != 'Exited' ORDER BY first_name LIMIT 8", e.manager_id, eid).map((x) => ({ ...x, name: fullName(x) })) : [];
    if (!full) return res.json({ employee: base, manager, reports, peers, limited: true });

    const month = req.query.month && D.isValidMonth(req.query.month) ? req.query.month : D.monthOf(T);
    const to = D.monthEnd(month) < T ? D.monthEnd(month) : T;
    const statuses = D.monthStart(month) <= T ? dayStatuses(db, [e], D.monthStart(month), to, T).get(eid) : new Map();
    const attendance = [...statuses.entries()].map(([d, s]) => ({ date: d, code: s.code, leave: s.leave?.code, checkIn: s.checkIn, checkOut: s.checkOut }));
    const cycle = db.get("SELECT * FROM review_cycles WHERE status = 'Active' ORDER BY start_date DESC LIMIT 1");
    const out = {
      employee: {
        ...base,
        dob: sensitive ? e.dob : null,
        address: sensitive ? e.address : null,
        emergency_contact: sensitive ? e.emergency_contact : null,
      },
      manager, reports, peers,
      documents: db.all('SELECT id, name, category, mime, size, uploaded_at FROM documents WHERE employee_id = ? ORDER BY uploaded_at DESC', eid),
      assets: db.all('SELECT * FROM assets WHERE employee_id = ? ORDER BY status, issued_on DESC', eid),
      acknowledgements: db.all(`SELECT p.id, p.title, p.version, p.requires_ack, a.acked_at, a.version AS acked_version FROM policies p
        LEFT JOIN policy_acks a ON a.policy_id = p.id AND a.employee_id = ? WHERE p.requires_ack = 1 ORDER BY p.title`, eid),
      poshTraining: db.value('SELECT completed_at FROM posh_training WHERE employee_id = ?', eid) || null,
      leave: {
        balances: balances(db, e, D.yearOf(T), T, calendarCtx(db)),
        requests: db.all(`SELECT r.*, t.name AS type, t.code, t.color FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
          WHERE r.employee_id = ? ORDER BY r.from_date DESC LIMIT 20`, eid),
      },
      attendance: { month, days: attendance },
      performance: {
        cycle,
        goals: cycle ? db.all('SELECT * FROM goals WHERE cycle_id = ? AND employee_id = ? ORDER BY id', cycle.id, eid) : [],
        reviews: db.all(`SELECT rv.*, c.name AS cycle_name, c.status AS cycle_status FROM reviews rv JOIN review_cycles c ON c.id = rv.cycle_id
          WHERE rv.employee_id = ? ORDER BY c.start_date DESC`, eid),
      },
      onboarding: db.all('SELECT * FROM onboarding_tasks WHERE employee_id = ? ORDER BY sort, id', eid),
      resignation: db.get('SELECT id, status, submitted_on, last_working_day, reason_category FROM resignations WHERE employee_id = ? ORDER BY id DESC LIMIT 1', eid) || null,
    };
    if (sensitive) {
      const rules = getSettings(db).payroll;
      out.compensation = {
        ctc: e.ctc, monthlyTds: e.monthly_tds, structure: salaryStructure(e.ctc, rules),
        pan: e.pan, uan: e.uan, bank_name: e.bank_name, bank_account: e.bank_account, ifsc: e.ifsc,
        payslips: db.all(`SELECT p.id, p.gross, p.net, p.deductions, p.status, r.month, r.status AS run_status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
          WHERE p.employee_id = ? ${isHR(req.user) ? '' : "AND r.status = 'Completed'"} ORDER BY r.month DESC LIMIT 12`, eid),
      };
    }
    if (isHR(req.user)) out.login = db.get('SELECT id, email, role, active, last_login FROM users WHERE employee_id = ?', eid) || null;
    res.json(out);
  });

  r.post('/employees', (req, res) => {
    requireHR(req);
    const data = readEmployeeBody(db, req.body);
    if (data.manager_id && !db.value('SELECT 1 FROM employees WHERE id = ?', data.manager_id)) fail(400, 'Unknown manager');
    const createLogin = Boolean(req.body.create_login);
    const role = oneOf(req.body.role || 'employee', ['employee', 'manager', 'hr', 'admin'], { name: 'Role' });
    if (role === 'admin' && req.user.role !== 'admin') fail(403, 'Only an administrator can create admin logins');
    let temp = null;
    const eid = db.tx(() => {
      const newId = db.insert('employees', { ...data, code: nextCode(db), status: 'Active' });
      if (data.join_date >= D.addDays(today(db), -30)) ONBOARDING.forEach((t, i) => db.insert('onboarding_tasks', { employee_id: newId, title: t, sort: i }));
      // An existing login with this email and no employee record (e.g. the
      // first administrator) is linked instead of creating a second login.
      const orphan = db.get('SELECT id FROM users WHERE email = ? AND employee_id IS NULL', data.email);
      if (orphan) db.run('UPDATE users SET employee_id = ? WHERE id = ?', newId, orphan.id);
      else if (createLogin) {
        if (db.value('SELECT 1 FROM users WHERE email = ?', data.email)) fail(409, 'A login with this email already exists');
        temp = tempPassword();
        db.insert('users', { email: data.email, password_hash: hashPassword(temp), role, employee_id: newId, must_change_password: 1 });
      }
      return newId;
    });
    audit(db, req.user, 'employee.create', 'employee', eid);
    res.json({ id: eid, tempPassword: temp });
  });

  r.put('/employees/:id', (req, res) => {
    const eid = id(req.params.id);
    const existing = db.get('SELECT * FROM employees WHERE id = ?', eid) || notFound('Employee');
    let data;
    if (isHR(req.user)) {
      data = readEmployeeBody(db, req.body, { partial: true });
      if ('manager_id' in data && data.manager_id) {
        if (data.manager_id === eid || reportIds(db, eid).includes(data.manager_id)) fail(400, 'An employee cannot report to themselves or their own team');
        if (!db.value('SELECT 1 FROM employees WHERE id = ?', data.manager_id)) fail(400, 'Unknown manager');
      }
      if ('status' in req.body) {
        data.status = oneOf(req.body.status, STATUSES, { name: 'Status' });
        data.exit_date = date(req.body.exit_date, { name: 'Exit date', required: data.status !== 'Active' });
        if (data.status === 'Active') data.exit_date = null;
      }
      if ('ctc' in data && !('monthly_tds' in req.body)) data.monthly_tds = estimateMonthlyTds(data.ctc, getSettings(db).payroll);
    } else if (req.user.employeeId === eid) {
      // Self-service edits are limited to contact and profile details.
      const allowed = ['phone', 'address', 'emergency_contact', 'about', 'skills', 'certifications'];
      const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
      data = readEmployeeBody(db, body, { partial: true });
    } else fail(403, 'You can only edit your own profile');
    if (data.email && data.email !== existing.email) {
      db.run('UPDATE users SET email = ? WHERE employee_id = ?', data.email, eid);
    }
    db.update('employees', eid, data);
    if (data.status === 'Exited') db.run('UPDATE users SET active = 0 WHERE employee_id = ?', eid);
    audit(db, req.user, 'employee.update', 'employee', eid, Object.keys(data));
    res.json({ ok: true });
  });

  r.post('/employees/:id/login', (req, res) => {
    requireHR(req);
    const eid = id(req.params.id);
    const e = db.get('SELECT * FROM employees WHERE id = ?', eid) || notFound('Employee');
    const role = oneOf(req.body.role || 'employee', ['employee', 'manager', 'hr', 'admin'], { name: 'Role' });
    if (role === 'admin' && req.user.role !== 'admin') fail(403, 'Only an administrator can grant admin access');
    const temp = tempPassword();
    const existing = db.get('SELECT * FROM users WHERE employee_id = ?', eid);
    if (existing) {
      if (existing.role === 'admin' && req.user.role !== 'admin') fail(403, 'Only an administrator can reset an admin login');
      db.update('users', existing.id, { password_hash: hashPassword(temp), role, active: 1, must_change_password: 1 });
      db.run('DELETE FROM sessions WHERE user_id = ?', existing.id);
    } else {
      if (db.value('SELECT 1 FROM users WHERE email = ?', e.email)) fail(409, 'A login with this email already exists');
      db.insert('users', { email: e.email, password_hash: hashPassword(temp), role, employee_id: eid, must_change_password: 1 });
    }
    audit(db, req.user, existing ? 'login.reset' : 'login.create', 'employee', eid);
    res.json({ email: e.email, tempPassword: temp, role });
  });

  r.post('/employees/:id/photo', upload('photos', { maxMb: 3, exts: ['.jpg', '.jpeg', '.png', '.webp'] }).single('photo'), (req, res) => {
    const eid = id(req.params.id);
    if (!isHR(req.user) && req.user.employeeId !== eid) fail(403, 'You can only change your own photo');
    if (!req.file) fail(400, 'Choose a photo to upload');
    const old = db.value('SELECT photo FROM employees WHERE id = ?', eid);
    db.run('UPDATE employees SET photo = ? WHERE id = ?', req.file.filename, eid);
    if (old) fs.rm(path.join(uploads, 'photos', path.basename(old)), { force: true }, () => {});
    res.json({ ok: true });
  });

  // ---------- documents ----------
  r.post('/employees/:id/documents', upload('documents', { maxMb: 10, exts: ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx', '.txt'] }).single('file'), (req, res) => {
    const eid = id(req.params.id);
    if (!isHR(req.user) && req.user.employeeId !== eid) fail(403, 'You can only upload your own documents');
    if (!req.file) fail(400, 'Choose a file to upload');
    const category = oneOf(req.body.category || 'Other', DOC_CATEGORIES, { name: 'Category' });
    const did = db.insert('documents', { employee_id: eid, name: str(req.body.name, { max: 120 }) || req.file.originalname.slice(0, 120), category, file: req.file.filename, mime: req.file.mimetype, size: req.file.size, uploaded_by: req.user.id });
    res.json({ id: did });
  });
  r.get('/documents/:id/download', (req, res) => {
    const doc = db.get('SELECT * FROM documents WHERE id = ?', id(req.params.id)) || notFound('Document');
    if (!isHR(req.user) && req.user.employeeId !== doc.employee_id) fail(403, 'You cannot open this document');
    const file = path.join(uploads, 'documents', path.basename(doc.file));
    if (!fs.existsSync(file)) notFound('File');
    res.download(file, doc.name.includes('.') ? doc.name : `${doc.name}${path.extname(doc.file)}`);
  });
  // Every employee's documents (HR) or your own (everyone else).
  r.get('/documents', (req, res) => {
    const where = [];
    const params = [];
    if (!isHR(req.user)) {
      where.push('d.employee_id = ?');
      params.push(req.user.employeeId || 0);
    } else if (req.query.employee) {
      where.push('d.employee_id = ?');
      params.push(id(req.query.employee));
    }
    if (req.query.category) { where.push('d.category = ?'); params.push(String(req.query.category)); }
    if (req.query.vertical) { where.push('e.vertical_id = ?'); params.push(Number(req.query.vertical)); }
    if (req.query.department) { where.push('e.department_id = ?'); params.push(Number(req.query.department)); }
    if (req.query.search) {
      const like = `%${String(req.query.search).replace(/[%_]/g, '')}%`;
      where.push("(d.name LIKE ? OR e.first_name || ' ' || e.last_name LIKE ? OR e.code LIKE ?)");
      params.push(like, like, like);
    }
    const sql = `FROM documents d JOIN employees e ON e.id = d.employee_id LEFT JOIN departments dp ON dp.id = e.department_id
      LEFT JOIN users u ON u.id = d.uploaded_by LEFT JOIN employees ue ON ue.id = u.employee_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const items = db.all(`SELECT d.id, d.name, d.category, d.mime, d.size, d.uploaded_at, d.employee_id, e.first_name, e.last_name, e.code, e.designation, e.photo IS NOT NULL AS has_photo,
      dp.name AS department, ue.first_name AS up_first, ue.last_name AS up_last ${sql} ORDER BY d.uploaded_at DESC, d.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit)
      .map((x) => ({ ...x, employee: fullName(x), uploadedBy: x.up_first ? fullName({ first_name: x.up_first, last_name: x.up_last }) : null }));
    res.json({ items, total: db.value(`SELECT COUNT(*) ${sql}`, ...params), page, limit });
  });

  // Required documents per employee: what is on file and what is missing.
  r.get('/documents/checklist', (req, res) => {
    const required = getSettings(db).requiredDocuments || [];
    const where = ["e.status != 'Exited'"];
    const params = [];
    if (!isHR(req.user)) { where.push('e.id = ?'); params.push(req.user.employeeId || 0); }
    if (req.query.vertical) { where.push('e.vertical_id = ?'); params.push(Number(req.query.vertical)); }
    if (req.query.department) { where.push('e.department_id = ?'); params.push(Number(req.query.department)); }
    if (req.query.search) {
      const like = `%${String(req.query.search).replace(/[%_]/g, '')}%`;
      where.push("(e.first_name || ' ' || e.last_name LIKE ? OR e.code LIKE ?)");
      params.push(like, like);
    }
    const emps = db.all(`SELECT e.id, e.first_name, e.last_name, e.code, e.designation, e.join_date, e.photo IS NOT NULL AS has_photo, d.name AS department
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE ${where.join(' AND ')} ORDER BY e.first_name, e.last_name`, ...params);
    const docs = new Map();
    if (emps.length) {
      for (const d of db.all(`SELECT id, employee_id, category, name FROM documents WHERE employee_id IN (${emps.map(() => '?').join(',')}) ORDER BY uploaded_at DESC`, ...emps.map((e) => e.id))) {
        const m = docs.get(d.employee_id) || {};
        if (!m[d.category]) m[d.category] = { id: d.id, name: d.name };
        docs.set(d.employee_id, m);
      }
    }
    const rows = emps.map((e) => {
      const have = docs.get(e.id) || {};
      const missing = required.filter((c) => !have[c]);
      return { id: e.id, name: fullName(e), code: e.code, designation: e.designation, department: e.department, has_photo: Boolean(e.has_photo), join_date: e.join_date, docs: have, missing };
    });
    const onlyMissing = req.query.missing === '1';
    res.json({
      required,
      rows: onlyMissing ? rows.filter((r) => r.missing.length) : rows,
      summary: {
        employees: rows.length,
        complete: rows.filter((r) => !r.missing.length).length,
        missingDocs: rows.reduce((t, r) => t + r.missing.length, 0),
        byCategory: required.map((c) => ({ category: c, missing: rows.filter((r) => !r.docs[c]).length })),
        totalDocs: db.value(`SELECT COUNT(*) FROM documents d JOIN employees e ON e.id = d.employee_id WHERE ${where.join(' AND ')}`, ...params),
      },
    });
  });

  r.delete('/documents/:id', (req, res) => {
    requireHR(req);
    const doc = db.get('SELECT * FROM documents WHERE id = ?', id(req.params.id)) || notFound('Document');
    db.run('DELETE FROM documents WHERE id = ?', doc.id);
    fs.rm(path.join(uploads, 'documents', path.basename(doc.file)), { force: true }, () => {});
    res.json({ ok: true });
  });

  // ---------- assets ----------
  r.post('/employees/:id/assets', (req, res) => {
    requireHR(req);
    const eid = id(req.params.id);
    const aid = db.insert('assets', {
      employee_id: eid,
      type: str(req.body.type, { required: true, max: 40, name: 'Asset type' }),
      name: str(req.body.name, { required: true, max: 80, name: 'Asset name' }),
      serial: str(req.body.serial, { max: 60 }),
      issued_on: date(req.body.issued_on) || today(db),
      status: 'Issued',
    });
    res.json({ id: aid });
  });
  r.put('/assets/:id', (req, res) => {
    requireHR(req);
    const aid = id(req.params.id);
    db.get('SELECT 1 FROM assets WHERE id = ?', aid) || notFound('Asset');
    const status = oneOf(req.body.status, ['Issued', 'Returned'], { required: true, name: 'Status' });
    db.update('assets', aid, { status, returned_on: status === 'Returned' ? (date(req.body.returned_on) || today(db)) : null });
    res.json({ ok: true });
  });
  r.delete('/assets/:id', (req, res) => {
    requireHR(req);
    db.run('DELETE FROM assets WHERE id = ?', id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- onboarding ----------
  r.put('/onboarding/:id', (req, res) => {
    const tid = id(req.params.id);
    const task = db.get('SELECT * FROM onboarding_tasks WHERE id = ?', tid) || notFound('Task');
    if (!isHR(req.user)) assertCanSee(db, req.user, task.employee_id);
    if (!isHR(req.user) && req.user.employeeId === task.employee_id) fail(403, 'Onboarding tasks are completed by HR or your manager');
    const done = Boolean(req.body.done);
    db.update('onboarding_tasks', tid, { done, done_at: done ? new Date().toISOString() : null });
    res.json({ ok: true });
  });
  r.post('/employees/:id/onboarding', (req, res) => {
    requireHR(req);
    const eid = id(req.params.id);
    const sort = (db.value('SELECT MAX(sort) FROM onboarding_tasks WHERE employee_id = ?', eid) ?? -1) + 1;
    const tid = db.insert('onboarding_tasks', { employee_id: eid, title: str(req.body.title, { required: true, max: 120, name: 'Task' }), sort });
    res.json({ id: tid });
  });

  r.post('/employees/:id/notify', (req, res) => {
    requireHR(req);
    const uid = db.value('SELECT id FROM users WHERE employee_id = ?', id(req.params.id));
    if (!uid) fail(400, 'This employee has no login');
    notifyUsers(db, [uid], str(req.body.text, { required: true, max: 300, name: 'Message' }), str(req.body.link, { max: 100 }));
    res.json({ ok: true });
  });
}
