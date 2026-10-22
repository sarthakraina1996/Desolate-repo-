// Shared helpers used by every route module: errors, validation, settings,
// access control, notifications and the audit log.
import { json } from './db.js';
import { DEFAULT_PAYROLL_RULES } from './lib/payroll.js';
import { isValidYmd, todayIn } from './lib/dates.js';

// Error carrying an HTTP status; the app's error handler sends it to the client as-is.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
// Throws an HttpError; used to bail out of a handler with a status and message.
export const fail = (status, message) => {
  throw new HttpError(status, message);
};
export const notFound = (what = 'Record') => fail(404, `${what} not found`);

// ---------- input validation ----------
// Trimmed string or null; enforces required and max length.
export function str(v, { max = 500, required = false, name = 'Field' } = {}) {
  if (v == null || String(v).trim() === '') {
    if (required) fail(400, `${name} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) fail(400, `${name} is too long (max ${max} characters)`);
  return s;
}
// Number or null; enforces required, range and optionally integer.
export function num(
  v,
  { min = -Infinity, max = Infinity, required = false, name = 'Value', int = false } = {},
) {
  if (v == null || v === '') {
    if (required) fail(400, `${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n)))
    fail(400, `${name} is invalid`);
  return n;
}
// YYYY-MM-DD date string or null; rejects impossible dates.
export function date(v, { required = false, name = 'Date' } = {}) {
  if (v == null || v === '') {
    if (required) fail(400, `${name} is required`);
    return null;
  }
  if (!isValidYmd(v)) fail(400, `${name} must be a valid date (YYYY-MM-DD)`);
  return v;
}
// Value that must be one of `options`, or null when blank and not required.
export function oneOf(v, options, { required = false, name = 'Value' } = {}) {
  if (v == null || v === '') {
    if (required) fail(400, `${name} is required`);
    return null;
  }
  if (!options.includes(v)) fail(400, `${name} must be one of: ${options.join(', ')}`);
  return v;
}
// Cleans an array or comma-separated string into a capped list of trimmed strings.
export function strList(v, { max = 30, itemMax = 80 } = {}) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  return arr
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, max)
    .map((s) => s.slice(0, itemMax));
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Validated, lower-cased email or null.
export function email(v, { required = false } = {}) {
  const s = str(v, { max: 200, required, name: 'Email' });
  if (s && !EMAIL_RE.test(s)) fail(400, 'Email is invalid');
  return s ? s.toLowerCase() : s;
}
// Parses a positive integer id from a route param, or responds 400.
export const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(400, 'Invalid id');
  return n;
};

// ---------- documents ----------
// Categories an employee document can be filed under.
export const DOC_CATEGORIES = [
  'Aadhaar Card',
  'PAN Card',
  'Address Proof',
  'Education',
  'Experience',
  'Offer Letter',
  'Appointment Letter',
  'Bank Proof',
  'ID Proof',
  'Payslip',
  'Other',
];

// ---------- settings ----------
// Company settings used until HR saves its own values in the settings table.
export const DEFAULT_SETTINGS = {
  companyName: 'BrainADZ',
  timezone: 'Asia/Kolkata',
  weeklyOffs: [0, 6],
  workdayStart: '09:30',
  workdayEnd: '18:30',
  lateAfter: '10:00',
  workHours: 8,
  shortHoursGraceMinutes: 15,
  requiredDocuments: [
    'Aadhaar Card',
    'PAN Card',
    'Address Proof',
    'Education',
    'Offer Letter',
    'Appointment Letter',
    'Bank Proof',
  ],
  // Sign-in location check. mode: off | login (sign in and check in only at
  // an office) | strict (also signs people out when they leave the office).
  geofence: { mode: 'off', exemptEmployeeIds: [], allowWfhAndLeave: true, maxAccuracyM: 1500 },
  employeeCodePrefix: 'BZ',
  noticePeriodDays: 30,
  noticePeriodSeniorDays: 60,
  payroll: DEFAULT_PAYROLL_RULES,
  bankName: 'HDFC Bank',
  icc: { presidingOfficerId: null, memberIds: [], externalMember: '' },
  demo: false,
};

// Saved settings layered over the defaults; payroll rules merge key by key.
export function getSettings(db) {
  const rows = db.all('SELECT key, value FROM settings');
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const { key, value } of rows) {
    const v = json(value, null);
    if (key === 'payroll') s.payroll = { ...DEFAULT_PAYROLL_RULES, ...v };
    else s[key] = v;
  }
  return s;
}
// Saves one setting as JSON, replacing any previous value.
export function setSetting(db, key, value) {
  db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    JSON.stringify(value),
  );
}
// Today's date in the company time zone.
export const today = (db) => todayIn(getSettings(db).timezone);

// ---------- access control ----------
export const isHR = (user) => user && (user.role === 'admin' || user.role === 'hr');
export const isAdmin = (user) => user && user.role === 'admin';

// All employees reporting (directly or indirectly) to the given employee.
export function reportIds(db, employeeId) {
  if (!employeeId) return [];
  return db
    .all(
      `
    WITH RECURSIVE team(id) AS (
      SELECT id FROM employees WHERE manager_id = ?
      UNION SELECT e.id FROM employees e JOIN team t ON e.manager_id = t.id
    ) SELECT id FROM team`,
      employeeId,
    )
    .map((r) => r.id);
}

// Employees whose HR records this user may see: null means everyone.
export function scopeIds(db, user) {
  if (isHR(user)) return null;
  const ids = user.role === 'manager' ? reportIds(db, user.employeeId) : [];
  if (user.employeeId) ids.push(user.employeeId);
  return ids;
}

// True when the employee is inside this user's visible scope.
export function canSeeEmployee(db, user, employeeId) {
  const scope = scopeIds(db, user);
  return scope === null || scope.includes(Number(employeeId));
}

// Responds 403 unless the user may see this employee.
export function assertCanSee(db, user, employeeId) {
  if (!canSeeEmployee(db, user, employeeId)) fail(403, 'You do not have access to this employee');
}

// Guards for route handlers: HR (or admin), admin only, and a linked employee record.
export function requireHR(req) {
  if (!isHR(req.user)) fail(403, 'Only HR can do this');
}
export function requireAdmin(req) {
  if (!isAdmin(req.user)) fail(403, 'Only an administrator can do this');
}
export function requireEmployee(req) {
  if (!req.user.employeeId) fail(400, 'Your login is not linked to an employee record');
  return req.user.employeeId;
}

// SQL fragment limiting a query on employees alias `alias` to the scope.
export function scopeSql(scope, alias = 'e') {
  if (scope === null) return { sql: '1=1', params: [] };
  if (!scope.length) return { sql: '0=1', params: [] };
  return { sql: `${alias}.id IN (${scope.map(() => '?').join(',')})`, params: scope };
}

// ---------- notifications & audit ----------
// Sends an in-app notification to each user once, skipping empty ids.
export function notifyUsers(db, userIds, text, link = null) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const uid of unique)
    db.run('INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)', uid, text, link);
}
// Active admin and HR login ids.
export function hrUserIds(db) {
  return db
    .all("SELECT id FROM users WHERE role IN ('admin','hr') AND active = 1")
    .map((r) => r.id);
}
// Active login id linked to an employee, or null.
export function userIdForEmployee(db, employeeId) {
  return employeeId
    ? db.value('SELECT id FROM users WHERE employee_id = ? AND active = 1', employeeId)
    : null;
}
// Login id of the employee's reporting manager, or null.
export function managerUserId(db, employeeId) {
  const mgr = db.value('SELECT manager_id FROM employees WHERE id = ?', employeeId);
  return userIdForEmployee(db, mgr);
}
// Records who did what to which record in the audit log.
export function audit(db, user, action, entity, entityId, detail) {
  db.run(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
    user?.id ?? null,
    action,
    entity ?? null,
    entityId ?? null,
    detail ? JSON.stringify(detail) : null,
  );
}

// "First Last" for an employee row, or '' when missing.
export const fullName = (e) => (e ? `${e.first_name}${e.last_name ? ` ${e.last_name}` : ''}` : '');

// CSV for report downloads.
export function toCsv(rows, columns) {
  const esc = (v) => {
    if (v == null) return '';
    let s = String(v);
    // Neutralise spreadsheet formula injection.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) =>
    columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(','),
  );
  return [head, ...body].join('\r\n');
}
// Sends rows as a CSV download; the leading BOM makes Excel read it as UTF-8.
export function sendCsv(res, filename, rows, columns) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`﻿${toCsv(rows, columns)}`);
}
