// Shared helpers used by every route module: errors, validation, time, money,
// access control and the audit log.
import crypto from 'node:crypto';
import { json } from './db.js';

// Error carrying an HTTP status; the app's error handler sends it to the client as-is.
export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
// Throws an HttpError; used to bail out of a handler with a status and message.
export const fail = (status, message, code) => {
  throw new HttpError(status, message, code);
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
export function num(v, { min = -Infinity, max = Infinity, required = false, name = 'Value', int = false } = {}) {
  if (v == null || v === '') {
    if (required) fail(400, `${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) fail(400, `${name} is invalid`);
  return n;
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const isYmd = (v) => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
// YYYY-MM-DD date string or null; rejects impossible dates.
export function date(v, { required = false, name = 'Date' } = {}) {
  if (v == null || v === '') {
    if (required) fail(400, `${name} is required`);
    return null;
  }
  if (!isYmd(v)) fail(400, `${name} must be a valid date (YYYY-MM-DD)`);
  return v;
}
// HH:MM 24-hour time or null.
export function time(v, { required = false, name = 'Time' } = {}) {
  if (v == null || v === '') {
    if (required) fail(400, `${name} is required`);
    return null;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(400, `${name} must be a time like 14:30`);
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
export function email(v, { required = false, name = 'Email' } = {}) {
  const s = str(v, { max: 200, required, name });
  if (s && !EMAIL_RE.test(s)) fail(400, `${name} is not a valid email address`);
  return s ? s.toLowerCase() : s;
}
// Indian mobile numbers and international numbers, kept as typed apart from spacing.
export function phone(v, { required = false, name = 'Phone' } = {}) {
  const s = str(v, { max: 20, required, name });
  if (s && !/^\+?[0-9 ()-]{7,20}$/.test(s)) fail(400, `${name} is not a valid phone number`);
  return s;
}
// http(s) URL or null.
export function url(v, { name = 'Link' } = {}) {
  const s = str(v, { max: 300, name });
  if (s && !/^https?:\/\/[^\s]+$/i.test(s)) fail(400, `${name} must start with http:// or https://`);
  return s;
}
// Parses a positive integer id from a route param, or responds 400.
export const id = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(400, 'Invalid id');
  return n;
};
export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

// ---------- time ----------
export const nowIso = () => new Date().toISOString();
// The calendar date (YYYY-MM-DD) of an instant in a timezone; events default to Asia/Kolkata.
export function ymdIn(timezone, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at instanceof Date ? at : new Date(at));
  const pick = (t) => parts.find((p) => p.type === t).value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
// Wall-clock HH:MM of an instant in a timezone.
export function hmIn(timezone, at = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone || 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at instanceof Date ? at : new Date(at));
}
// Adds days to a YYYY-MM-DD date.
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Every date from `from` to `to`, inclusive.
export function daysBetween(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 60; d = addDays(d, 1)) out.push(d);
  return out;
}
// Offset of a timezone from UTC, in minutes, at a given instant.
function tzOffsetMinutes(timezone, at) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}
// The UTC instant for a local date and time in a timezone (e.g. a session start).
export function zonedToUtc(ymd, hm, timezone) {
  const guess = new Date(`${ymd}T${hm}:00Z`);
  return new Date(guess.getTime() - tzOffsetMinutes(timezone || 'Asia/Kolkata', guess) * 60000);
}

// ---------- money ----------
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
// Formats integer paise as rupees with Indian digit grouping, e.g. 4800000 -> ₹48,000.
export const inr = (paise) => INR.format((paise || 0) / 100);
// GST on an amount in paise, rounded to the nearest paisa.
export const gstOn = (paise, percent) => Math.round((paise * percent) / 100);

// ---------- ids and tokens ----------
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
// Short reference people can read out at a help desk; no look-alike characters.
export function randomRef(prefix, length = 6) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${out}`;
}
// Constant-time comparison of two strings.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// Next value of a per-event counter (order numbers, invoice numbers). Call inside db.tx.
export function nextCounter(db, eventId, name) {
  db.run(
    `INSERT INTO counters (event_id, name, value) VALUES (?, ?, 1)
     ON CONFLICT (event_id, name) DO UPDATE SET value = value + 1`,
    eventId,
    name,
  );
  return db.value('SELECT value FROM counters WHERE event_id = ? AND name = ?', eventId, name);
}

// ---------- events ----------
// Settings every event starts with; organisers change them in the console.
export const DEFAULT_EVENT_SETTINGS = {
  // Fields an exhibitor receives when a visitor lets them scan a badge. Disclosed at registration.
  leadSharing: {
    fields: ['name', 'company', 'jobTitle', 'email'],
    notice: 'When you let an exhibitor scan your badge, we share your name, company, job title and work email with that exhibitor only.',
  },
  // Days after the event ends before personal data is purged or anonymised.
  retentionDays: 180,
  // Seconds within which a second scan of the same pass counts as a repeat scan.
  repeatWindowSeconds: 90,
  // How long a preloaded offline eligibility set stays valid on a device.
  bundleHours: 12,
  // How long a booth hold lasts before it lapses.
  boothHoldHours: 72,
  // Share of a booth order collected as deposit, in percent.
  boothDepositPercent: 50,
  defaultBadgeQuota: 4,
  interestTags: [],
  features: {
    registration: true,
    exhibitors: true,
    leads: true,
    agenda: true,
    displays: true,
    services: true,
  },
  gateInstructions: 'Show this pass at the gate. Carry a government photo ID.',
};
export function eventSettings(row) {
  const saved = json(row.settings, {});
  return {
    ...DEFAULT_EVENT_SETTINGS,
    ...saved,
    leadSharing: { ...DEFAULT_EVENT_SETTINGS.leadSharing, ...(saved.leadSharing || {}) },
    features: { ...DEFAULT_EVENT_SETTINGS.features, ...(saved.features || {}) },
  };
}
// Marks published data as changed so apps and kiosks know to refresh their cached guide.
export function touchGuide(db, eventId) {
  db.run('UPDATE events SET guide_version = guide_version + 1, updated_at = ? WHERE id = ?', nowIso(), eventId);
}

// ---------- access control ----------
// What each role may do. Routes ask for one permission; the server is the only judge.
export const ROLE_PERMS = {
  organiser_admin: ['*'],
  organiser_staff: [
    'event.view',
    'event.manage',
    'reg.view',
    'reg.manage',
    'exh.view',
    'exh.review',
    'exh.allocate',
    'floor.manage',
    'agenda.manage',
    'comms.manage',
    'gate.view',
    'gate.scan',
    'gate.lookup',
    'gate.print',
    'gate.reprint',
    'reports.view',
  ],
  finance: ['event.view', 'reg.view', 'exh.view', 'finance.view', 'finance.manage', 'reports.view', 'reports.finance'],
  gate_supervisor: ['gate.view', 'gate.scan', 'gate.lookup', 'gate.print', 'gate.reprint', 'gate.override'],
  gate_staff: ['gate.scan', 'gate.lookup', 'gate.print'],
  exhibitor_admin: ['x.view', 'x.manage', 'x.team', 'x.orders', 'x.leads.view', 'x.leads.capture', 'x.leads.export'],
  booth_staff: ['x.view', 'x.leads.view', 'x.leads.capture'],
};
export const ORG_ROLES = ['organiser_admin', 'organiser_staff', 'finance'];
export const GATE_ROLES = ['gate_supervisor', 'gate_staff'];
export const EXHIBITOR_ROLES = ['exhibitor_admin', 'booth_staff'];
export const roleCan = (role, perm) => {
  const perms = ROLE_PERMS[role] || [];
  return perms.includes('*') || perms.includes(perm);
};

// Rejects requests without a signed-in user.
export function requireUser(req) {
  if (!req.user) fail(401, 'Sign in to continue', 'signin_required');
  return req.user;
}
// Active memberships of the signed-in user (cached on the request).
export function memberships(db, req) {
  if (!req.user) return [];
  if (!req._memberships) req._memberships = db.all("SELECT * FROM memberships WHERE user_id = ? AND status = 'active'", req.user.id);
  return req._memberships;
}
// Loads an event the user may act on with `perm` as organiser staff. A missing event and an
// event that belongs to another organiser both answer 404, so tenants cannot probe each other.
export function orgEvent(db, req, eventId, perm) {
  requireUser(req);
  const event = db.get('SELECT * FROM events WHERE id = ?', eventId);
  const mine = event
    ? memberships(db, req).filter(
        (m) => m.organiser_id === event.organiser_id && ORG_ROLES.includes(m.role) && (m.event_id == null || m.event_id === event.id),
      )
    : [];
  if (!mine.length) notFound('Event');
  if (!mine.some((m) => roleCan(m.role, perm))) fail(403, 'Your role does not allow this action');
  req.event = event;
  req.orgRole = mine.find((m) => roleCan(m.role, perm)).role;
  return event;
}
// True when the user holds `perm` on the event as organiser staff (no throw).
export function hasOrgPerm(db, req, event, perm) {
  return memberships(db, req).some(
    (m) =>
      m.organiser_id === event.organiser_id &&
      ORG_ROLES.includes(m.role) &&
      (m.event_id == null || m.event_id === event.id) &&
      roleCan(m.role, perm),
  );
}
// Loads an exhibitor the user may act on with `perm`. Company boundaries are enforced here:
// a membership for another company (or none) answers 404.
export function exhibitorAccess(db, req, exhibitorId, perm) {
  requireUser(req);
  const exhibitor = db.get('SELECT * FROM exhibitors WHERE id = ?', exhibitorId);
  const mine = exhibitor ? memberships(db, req).filter((m) => EXHIBITOR_ROLES.includes(m.role) && m.exhibitor_id === exhibitor.id) : [];
  if (!mine.length) notFound('Exhibitor');
  if (!mine.some((m) => roleCan(m.role, perm))) fail(403, 'Your role does not allow this action');
  req.exhibitor = exhibitor;
  req.exhibitorRole = mine.some((m) => m.role === 'exhibitor_admin') ? 'exhibitor_admin' : 'booth_staff';
  return exhibitor;
}
// Gates of an event the user may operate with `perm`. Gate staff see only their own gate;
// supervisors and organiser staff see every gate of the event.
export function gatesFor(db, req, eventId, perm) {
  requireUser(req);
  const event = db.get('SELECT * FROM events WHERE id = ?', eventId);
  if (!event) return [];
  const all = db.all('SELECT * FROM gates WHERE event_id = ? AND active = 1 ORDER BY code', eventId);
  if (hasOrgPerm(db, req, event, perm)) return all;
  const mine = memberships(db, req).filter((m) => GATE_ROLES.includes(m.role) && m.event_id === eventId && roleCan(m.role, perm));
  if (!mine.length) return [];
  if (mine.some((m) => m.gate_id == null)) return all;
  const ids = new Set(mine.map((m) => m.gate_id));
  return all.filter((g) => ids.has(g.id));
}
// Loads a gate the user may operate with `perm`, or answers 404/403.
export function gateAccess(db, req, gateId, perm) {
  requireUser(req);
  const gate = db.get('SELECT * FROM gates WHERE id = ? AND active = 1', gateId);
  if (!gate) notFound('Gate');
  const allowed = gatesFor(db, req, gate.event_id, perm);
  if (!allowed.some((g) => g.id === gate.id)) {
    // Staff of this event who lack the permission get 403; everyone else cannot see the gate.
    const anyRole = memberships(db, req).some((m) => m.event_id === gate.event_id || m.event_id == null);
    if (anyRole && gatesFor(db, req, gate.event_id, 'gate.scan').some((g) => g.id === gate.id))
      fail(403, 'Your role does not allow this action');
    if (anyRole) fail(403, 'This gate is outside your assignment', 'wrong_gate');
    notFound('Gate');
  }
  req.gate = gate;
  return gate;
}

// ---------- audit ----------
// Records an action in the audit log, tagged with who did it and from where.
export function audit(db, req, action, { event, entity, entityId, detail } = {}) {
  const ev = event || req?.event || null;
  db.insert('audit_log', {
    organiser_id: ev?.organiser_id ?? null,
    event_id: ev?.id ?? null,
    user_id: req?.user?.id ?? null,
    actor: req?.user ? `${req.user.name || req.user.email}` : 'system',
    action,
    entity: entity ?? null,
    entity_id: entityId != null ? String(entityId) : null,
    detail: detail ? JSON.stringify(detail) : null,
    ip: req?.ip ?? null,
    created_at: nowIso(),
  });
}

// ---------- CSV ----------
// Builds CSV text. Cells starting with = + - @ are prefixed so spreadsheets do not run them.
export function toCsv(headers, rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
// Sends CSV as a download; the BOM makes Excel read UTF-8 (₹, Indian names) correctly.
export function sendCsv(res, filename, headers, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + toCsv(headers, rows));
}

// Reads page and page size from a query string.
export function paging(q, { size = 50, maxSize = 200 } = {}) {
  const page = Math.max(1, Number.parseInt(q.page, 10) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(q.pageSize, 10) || size));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
