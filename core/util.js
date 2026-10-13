export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (msg) => new HttpError(400, msg, 'bad_request');
export const notFound = (what = 'Item') => new HttpError(404, `${what} not found`, 'not_found');
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg, 'forbidden');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Optional date: '' / null -> null, invalid -> 400.
export function optDate(v, label = 'Date') {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isDate(v)) throw bad(`${label} must be a valid date`);
  return v;
}

export function text(v, { max = 2000, label = 'Value', required = false } = {}) {
  if (v === undefined) return undefined;
  const s = v === null ? '' : String(v).trim();
  if (required && !s) throw bad(`${label} is required`);
  if (s.length > max) throw bad(`${label} is too long (max ${max} characters)`);
  return s;
}

export function oneOf(v, allowed, label) {
  if (v === undefined) return undefined;
  if (!allowed.includes(v)) throw bad(`${label} must be one of: ${allowed.join(', ')}`);
  return v;
}

export function optId(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '' || v === 0) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad('Invalid id');
  return n;
}

export function toId(v, what = 'Item') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw notFound(what);
  return n;
}

export function parseJSON(s, fallback) {
  if (s == null || s === '') return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

export function todayIn(timeZone = 'Asia/Kolkata', at = new Date()) {
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export const placeholders = (arr) => arr.map(() => '?').join(',');

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
