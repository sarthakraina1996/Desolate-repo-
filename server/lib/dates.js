// Calendar helpers. Dates are plain 'YYYY-MM-DD' strings and months are
// 'YYYY-MM' strings; all arithmetic happens in UTC so it never drifts with
// the server's own timezone.

export const pad = (n) => String(n).padStart(2, '0');

// Date object -> 'YYYY-MM-DD' (UTC fields).
export function ymd(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// 'YYYY-MM-DD' -> Date at UTC midnight.
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// True for a real calendar date; the round trip rejects things like 2025-02-30.
export function isValidYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return ymd(parseYmd(s)) === s;
}

// True for a 'YYYY-MM' month string.
export function isValidMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

// Date n days later (negative n goes back).
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

// Number of days from `from` to `to`.
export function diffDays(from, to) {
  return Math.round((parseYmd(to) - parseYmd(from)) / 86400000);
}

// Day of week, 0 = Sunday.
export function dow(s) {
  return parseYmd(s).getUTCDay();
}

// Today's date in a time zone; the en-CA locale formats as YYYY-MM-DD.
export function todayIn(timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// Current 24-hour 'HH:MM' in a time zone.
export function nowTimeIn(timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

// ISO timestamp for a wall-clock time ("18:30") on a date in a time zone.
export function zonedIso(date, hm, timeZone = 'Asia/Kolkata') {
  // Treat the time as UTC, see how far the zone shows it shifted, then undo that offset.
  const guess = Date.parse(`${date}T${hm}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const shown = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return new Date(guess - (shown - guess)).toISOString();
}

export const monthOf = (s) => s.slice(0, 7);
export const yearOf = (s) => Number(s.slice(0, 4));

// Days in a 'YYYY-MM' month (day 0 of the next month is this month's last day).
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const monthStart = (month) => `${month}-01`;
export const monthEnd = (month) => `${month}-${pad(daysInMonth(month))}`;

// Month n months later, rolling over years.
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// Every date from `from` to `to`, inclusive.
export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// 'YYYY-MM' -> "March 2025".
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// 'YYYY-MM' -> "Mar".
export function shortMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
}

// Years between two dates as a fraction (e.g. 2.5), used for tenure.
export function yearsBetween(from, to) {
  return diffDays(from, to) / 365.25;
}
