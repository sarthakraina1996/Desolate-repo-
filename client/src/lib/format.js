export const inr = (n, digits = 0) =>
  n == null || Number.isNaN(Number(n))
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;

export function inrShort(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  if (Math.abs(v) >= 1e3) return `₹${(v / 1e3).toFixed(1)}K`;
  return inr(v);
}

export const lpa = (n) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 })} LPA`;
export const num = (n, d = 0) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d });

// Dates ('YYYY-MM-DD') are calendar days and render as-is; timestamps render
// in the company's time zone (set from settings) so every viewer sees IST.
let TZ;
export const setTimeZone = (tz) => {
  TZ = tz;
};
const isDay = (s) => typeof s === 'string' && s.length === 10;
const asDate = (s) => (s instanceof Date ? s : new Date(isDay(s) ? `${s}T00:00:00Z` : s));

export function fmtDate(s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!s) return '—';
  const d = asDate(s);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { ...opts, timeZone: isDay(s) ? 'UTC' : TZ });
}
export const fmtShort = (s) => fmtDate(s, { month: 'short', day: 'numeric' });
export const fmtDay = (s) => fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtMonth = (m) => (m ? fmtDate(`${m}-01`, { month: 'long', year: 'numeric' }) : '—');
export const fmtMonthShort = (m) =>
  m ? fmtDate(`${m}-01`, { month: 'short', year: 'numeric' }) : '—';

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

export function ago(s) {
  if (!s) return '';
  const d = asDate(s);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return String(s).length === 10 ? 'Today' : `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 2) return '1d ago';
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return fmtShort(s);
}

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';

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
export function colorFor(name = '') {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

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
export const dowOf = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
export const daysIn = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
};
