// Calendar-date helpers. All dates are plain 'YYYY-MM-DD' strings so that
// renewals never drift because of time zones or daylight-saving changes.

const CYCLE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };

export const BILLING_CYCLES = Object.keys(CYCLE_MONTHS);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function format(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// m is 1-based (1 = January).
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isValidISODate(value) {
  const match = ISO_DATE.exec(value ?? '');
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

// Adds months, clamping to the end of shorter months (Jan 31 + 1 month = Feb 28/29).
export function addMonths(iso, months) {
  const { y, m, d } = parse(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return format(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function daysBetween(fromIso, toIso) {
  const a = parse(fromIso);
  const b = parse(toIso);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function cycleMonths(cycle) {
  return CYCLE_MONTHS[cycle];
}

// The first billing date on or after `todayIso`. Every renewal is computed from the
// original start date, so a subscription that started on the 31st keeps renewing on
// the 31st (or the last day of shorter months) instead of drifting earlier.
export function nextRenewalDate(startIso, cycle, todayIso) {
  if (startIso >= todayIso) return startIso;
  const step = CYCLE_MONTHS[cycle];
  const s = parse(startIso);
  const t = parse(todayIso);
  const monthsApart = (t.y - s.y) * 12 + (t.m - s.m);
  let k = Math.max(0, Math.floor(monthsApart / step));
  let candidate = addMonths(startIso, k * step);
  while (candidate < todayIso) {
    k += 1;
    candidate = addMonths(startIso, k * step);
  }
  return candidate;
}

// Today's calendar date and wall-clock time in the given IANA time zone.
export function nowInTimeZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function todayInTimeZone(timeZone, now = new Date()) {
  return nowInTimeZone(timeZone, now).date;
}

export function formatLongDate(iso) {
  const { y, m, d } = parse(iso);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function describeDaysUntil(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
