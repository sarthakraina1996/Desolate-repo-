// Calendar helpers. Dates are plain 'YYYY-MM-DD' strings and months are
// 'YYYY-MM' strings; all arithmetic happens in UTC so it never drifts with
// the server's own timezone.

export const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isValidYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return ymd(parseYmd(s)) === s;
}

export function isValidMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

export function diffDays(from, to) {
  return Math.round((parseYmd(to) - parseYmd(from)) / 86400000);
}

export function dow(s) {
  return parseYmd(s).getUTCDay();
}

export function todayIn(timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function nowTimeIn(timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// ISO timestamp for a wall-clock time ("18:30") on a date in a time zone.
export function zonedIso(date, hm, timeZone = 'Asia/Kolkata') {
  const guess = Date.parse(`${date}T${hm}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (shown - guess)).toISOString();
}

export const monthOf = (s) => s.slice(0, 7);
export const yearOf = (s) => Number(s.slice(0, 4));

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const monthStart = (month) => `${month}-01`;
export const monthEnd = (month) => `${month}-${pad(daysInMonth(month))}`;

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shortMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

// Whole years and months between two dates, used for tenure.
export function yearsBetween(from, to) {
  return diffDays(from, to) / 365.25;
}
