// Formatting: money from integer minor units per currency, compact figures (₹12.4L / €1.2M),
// percentages, dates. Locale follows the currency (en-IN for INR, en-GB otherwise).
const EXP = { JPY: 0, KWD: 3, BHD: 3 };
const exp = (c) => EXP[c] ?? 2;
const localeFor = (c) => (c === 'INR' ? 'en-IN' : 'en-GB');
const cache = new Map();
function nf(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

export const toMajor = (minor, currency = 'INR') => (minor == null ? null : minor / 10 ** exp(currency));

export function money(minor, currency = 'INR', { decimals } = {}) {
  if (minor == null || Number.isNaN(minor)) return '—';
  const d = decimals ?? (Math.abs(minor) >= 100000 * 10 ** exp(currency) ? 0 : exp(currency));
  return nf(`m|${currency}|${d}`, () => new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d })).format(
    toMajor(minor, currency),
  );
}

// Full precision, for folios and invoices.
export const moneyExact = (minor, currency = 'INR') => money(minor, currency, { decimals: exp(currency) });

export function moneyCompact(minor, currency = 'INR') {
  if (minor == null || Number.isNaN(minor)) return '—';
  const v = toMajor(minor, currency);
  if (Math.abs(v) < 10000) return money(minor, currency, { decimals: 0 });
  return nf(`c|${currency}`, () => new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })).format(v);
}

export const number = (n, d = 0) =>
  n == null || Number.isNaN(n) ? '—' : nf(`n|${d}`, () => new Intl.NumberFormat('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })).format(n);

export const pct = (n, d = 1) => (n == null || Number.isNaN(n) ? '—' : `${number(n, d)}%`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (s) => s.split('-').map(Number);

export function date(s, { year = true } = {}) {
  if (!s) return '—';
  const [y, m, d] = parts(String(s).slice(0, 10));
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`;
}
export const dayName = (s) => DAYS[new Date(`${s}T00:00:00Z`).getUTCDay()];
export const monthLabel = (ym) => {
  const [y, m] = parts(ym);
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
};
export function dateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
export const plural = (n, one, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;
export const titleCase = (s = '') => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const statusLabel = (s = '') => ({ in_house: 'In house', checked_out: 'Checked out', no_show: 'No-show', quote: 'Quote' })[s] || titleCase(s);

// "1 adult", "2 adults, 1 child".
export const party = (adults, children) => `${plural(adults, 'adult')}${children ? `, ${plural(children, 'child', 'children')}` : ''}`;
