// Rupee amount with Indian digit grouping (₹1,23,456); '—' for missing values.
export const inr = (n, digits = 0) =>
  n == null || Number.isNaN(Number(n))
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;

// Compact rupee amount in crore / lakh / thousand (₹1.25 Cr, ₹4.5 L, ₹12.3K).
export function inrShort(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return inr(v);
}

// Annual salary in lakhs per annum, e.g. ₹12.5 LPA.
export const lpa = (n) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} LPA`;
// Plain number with Indian digit grouping.
export const num = (n, d = 0) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d });

// Dates ('YYYY-MM-DD') are calendar days and render as-is; timestamps render
// in the company's time zone (set from settings) so every viewer sees IST.
let TZ;
export const setTimeZone = (tz) => {
  TZ = tz;
};
const isDay = (s) => typeof s === 'string' && s.length === 10;
// Day strings parse as UTC midnight so they never shift a day in the viewer's zone.
const asDate = (s) => (s instanceof Date ? s : new Date(isDay(s) ? `${s}T00:00:00Z` : s));

// Formats a day or timestamp as a date (default 'Jan 5, 2026'); '—' when empty or invalid.
export function fmtDate(s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!s) return '—';
  const d = asDate(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { ...opts, timeZone: isDay(s) ? 'UTC' : TZ });
}
export const fmtShort = (s) => fmtDate(s, { month: 'short', day: 'numeric' });
export const fmtDay = (s) => fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
// Month keys ('YYYY-MM') as 'January 2026' / 'Jan 2026'.
export const fmtMonth = (m) => (m ? fmtDate(`${m}-01`, { month: 'long', year: 'numeric' }) : '—');
export const fmtMonthShort = (m) =>
  m ? fmtDate(`${m}-01`, { month: 'short', year: 'numeric' }) : '—';

// 12-hour time from a timestamp or a plain 'HH:MM' shift time.
export function fmtTime(s) {
  if (!s) return '—';
  if (/^\d{2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  return asDate(s).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}
export const fmtDateTime = (s) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—');

// Relative time ('just now', '5m ago', '3d ago'), falling back to a short date after a month.
export function ago(s) {
  if (!s) return '';
  const d = asDate(s);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  // A bare day has no time of day, so hours-ago would be meaningless.
  if (diff < 86400) return String(s).length === 10 ? 'Today' : `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 2) return '1d ago';
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return fmtShort(s);
}

// Up to two initials for avatars; '?' when there is no name.
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

// Avatar background colours, picked per name by colorFor.
const PALETTE = [
  '#E5243B',
  '#1A6DF0',
  '#1FA855',
  '#F2A600',
  '#7C5CFC',
  '#EF4778',
  '#1FB2D6',
  '#F06A2A',
  '#0F9D8F',
  '#5B6BD6',
];
// Stable palette colour for a name, so a person always gets the same avatar colour.
export function colorFor(name = '') {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// '1 day' / '3 days'; pass `many` for irregular plurals.
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
// Whole-number percentage of a over b; 0 when b is 0.
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Time-of-day greeting for the dashboard header.
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// Calendar helpers on 'YYYY-MM-DD' days and 'YYYY-MM' months, all in UTC to avoid DST shifts.
export const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const addMonths = (m, n) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
// Day of week, 0 = Sunday.
export const dowOf = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
// Number of days in a month.
export const daysIn = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
};
