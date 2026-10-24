// Input validation helpers: each returns a clean value or throws a 400 with a clear message.
import { fail } from './errors.js';
import { isYmd } from './dates.js';
import { toMinor } from './money.js';

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

export function str(v, { max = 500, required = false, name = 'Field' } = {}) {
  if (blank(v)) {
    if (required) fail(400, `${name} is required`, { code: 'validation' });
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) fail(400, `${name} is too long (max ${max} characters)`, { code: 'validation' });
  return s;
}

export function int(v, { min = -Infinity, max = Infinity, required = false, name = 'Value' } = {}) {
  if (blank(v)) {
    if (required) fail(400, `${name} is required`, { code: 'validation' });
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${name} is invalid`, { code: 'validation' });
  return n;
}

export function num(v, { min = -Infinity, max = Infinity, required = false, name = 'Value' } = {}) {
  if (blank(v)) {
    if (required) fail(400, `${name} is required`, { code: 'validation' });
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) fail(400, `${name} is invalid`, { code: 'validation' });
  return n;
}

export function date(v, { required = false, name = 'Date' } = {}) {
  if (blank(v)) {
    if (required) fail(400, `${name} is required`, { code: 'validation' });
    return null;
  }
  if (!isYmd(v)) fail(400, `${name} must be a valid date (YYYY-MM-DD)`, { code: 'validation' });
  return v;
}

export function oneOf(v, options, { required = false, name = 'Value' } = {}) {
  if (blank(v)) {
    if (required) fail(400, `${name} is required`, { code: 'validation' });
    return null;
  }
  if (!options.includes(v))
    fail(400, `${name} must be one of: ${options.join(', ')}`, { code: 'validation' });
  return v;
}

export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function email(v, { required = false } = {}) {
  const s = str(v, { max: 200, required, name: 'Email' });
  if (s && !EMAIL_RE.test(s)) fail(400, 'Email is invalid', { code: 'validation' });
  return s ? s.toLowerCase() : s;
}

// Money given in major units ("1250.50") or as minor units ({ minor: 125050 }).
export function money(v, currency, { required = false, name = 'Amount', min = 0 } = {}) {
  if (v && typeof v === 'object' && Number.isInteger(v.minor)) return v.minor;
  if (blank(v)) {
    if (required) fail(400, `${name} is required`, { code: 'validation' });
    return null;
  }
  const m = toMinor(v, currency);
  if (!Number.isInteger(m) || m < min) fail(400, `${name} is invalid`, { code: 'validation' });
  return m;
}

// Positive integer id from a route param or body.
export function id(v, name = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(400, `Invalid ${name}`, { code: 'validation' });
  return n;
}
