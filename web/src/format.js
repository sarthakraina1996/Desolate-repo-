const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parse = (d) => new Date(d + 'T00:00:00Z');

export function fmtDate(d, { year = 'auto', today } = {}) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  const showYear = year === true || (year === 'auto' && (!today || String(y) !== today.slice(0, 4)));
  return `${day} ${MONTHS[m - 1]}${showYear ? ' ' + y : ''}`;
}

export function fmtDow(d) {
  return DOW[parse(d).getUTCDay()];
}

export function daysFrom(today, d) {
  return Math.round((parse(d) - parse(today)) / 86400000);
}

export function addDays(d, n) {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

export function relDay(today, d) {
  if (!d) return '';
  const n = daysFrom(today, d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return `In ${n} days`;
  if (n < 0) return `${-n} days ago`;
  if (n < 60) return `In ${Math.round(n / 7) === 1 ? '1 week' : Math.round(n / 7) + ' weeks'}`;
  return fmtDate(d, { today });
}

export function dueText(today, d, done = false) {
  if (!d) return 'No date';
  const n = daysFrom(today, d);
  if (!done && n < 0) return n === -1 ? '1 day late' : `${-n} days late`;
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  return fmtDate(d, { today });
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtTime(iso);
}

// Indian number formatting: 18,50,000 and compact 18.5 L / 1.2 Cr
export function inr(n) {
  if (n == null || n === '') return '';
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function inrShort(n) {
  if (n == null || n === '') return '';
  const v = Number(n);
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(v >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(v >= 1e6 ? 1 : 2).replace(/\.?0+$/, '')} L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(0)}K`;
  return `₹${v}`;
}

export function bytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function initials(name = '') {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export { MONTHS, DOW };
