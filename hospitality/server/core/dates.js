// Date helpers for 'YYYY-MM-DD' strings (business dates and nights). All arithmetic is done
// in UTC on the calendar date, so time zones and daylight saving never shift a night.
const DAY = 86400000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s) {
  if (typeof s !== 'string' || !YMD_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const toMs = (s) => Date.parse(`${s}T00:00:00Z`);
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (s, n) => fromMs(toMs(s) + n * DAY);
export const diffDays = (from, to) => Math.round((toMs(to) - toMs(from)) / DAY);
// 0 = Sunday ... 6 = Saturday.
export const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();

// Every night from `from` (inclusive) to `to` (exclusive): the nights of a stay.
export function nights(from, to) {
  const out = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

// Same day n months later, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb).
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export const addYears = (s, n) => addMonths(s, n * 12);
export const monthStart = (s) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s) => addDays(addMonths(monthStart(s), 1), -1);
export const daysInMonth = (s) => Number(monthEnd(s).slice(8));

// Today's date in an IANA time zone, e.g. todayIn('Asia/Kolkata').
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// Local wall-clock time (HH:MM) in a time zone.
export function timeIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

// Financial year label and start for a date, e.g. ('2026-05-10', 4) -> FY2026-27 from 2026-04-01.
export function fiscalYear(s, startMonth = 4) {
  const [y, m] = s.split('-').map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const label =
    startMonth === 1 ? `FY${startYear}` : `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  return { label, start, end: addDays(addYears(start, 1), -1) };
}

export const nowIso = () => new Date().toISOString();
