// Money is stored and computed as integer minor units (paise, cents) with an ISO 4217 code.
// Rates are basis points (1 bp = 0.01 %). Rounding happens once per computed amount.

// Minor units per major unit for the currencies we format; ISO 4217 exponents.
const EXPONENT = { INR: 2, EUR: 2, GBP: 2, USD: 2, AED: 2, JPY: 0, KWD: 3, BHD: 3 };
export const exponent = (currency) => EXPONENT[currency] ?? 2;

// Rounds half away from zero to an integer (no floating-point bias in either direction).
export function roundHalfUp(x) {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

// Integer division a / b rounded half away from zero, exact for any size (BigInt).
function divRound(a, b) {
  const A = BigInt(a);
  const B = BigInt(b);
  const neg = A < 0n !== B < 0n;
  const absA = A < 0n ? -A : A;
  const absB = B < 0n ? -B : B;
  const q = (absA * 2n + absB) / (absB * 2n);
  return Number(neg ? -q : q);
}

// amount × basis points, rounded once: e.g. bpOf(10000, 1800) = 1800 (18 % of 100.00).
export function bpOf(amountMinor, bp) {
  return divRound(BigInt(amountMinor) * BigInt(bp), 10000);
}

// amount × numerator / denominator, rounded once (used for tax-inclusive extraction).
export function mulDiv(amountMinor, numerator, denominator) {
  return divRound(BigInt(amountMinor) * BigInt(numerator), denominator);
}

// Splits an amount into parts proportional to `weights`, with the remainder distributed by
// the largest-remainder method so the parts always add up exactly.
export function allocate(amountMinor, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return weights.map(() => 0);
  const sign = amountMinor < 0 ? -1 : 1;
  const abs = Math.abs(amountMinor);
  const raw = weights.map((w) => (abs * w) / total);
  const parts = raw.map(Math.floor);
  let rest = abs - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) parts[order[k][1]]++;
  return parts.map((p) => p * sign);
}

// Parses a major-unit amount from user input ("1,250.50" or 1250.5) into minor units.
export function toMinor(value, currency = 'INR') {
  if (value == null || value === '') return null;
  const s = String(value).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  const e = exponent(currency);
  const [whole, frac = ''] = s.replace('-', '').split('.');
  if (frac.length > e) return NaN;
  const minor = Number(whole) * 10 ** e + Number((frac + '0'.repeat(e)).slice(0, e) || 0);
  return s.startsWith('-') ? -minor : minor;
}

export const toMajor = (minor, currency = 'INR') => minor / 10 ** exponent(currency);

// Converts between currencies with a rate held as an integer × 1e6.
export function convert(amountMinor, rateMicros, fromCurrency, toCurrency) {
  const shift = exponent(toCurrency) - exponent(fromCurrency);
  const num = BigInt(amountMinor) * BigInt(rateMicros) * 10n ** BigInt(Math.max(shift, 0));
  const den = 1000000n * 10n ** BigInt(Math.max(-shift, 0));
  return divRound(num, den);
}

// Display string, e.g. format(1234500, 'INR') -> "₹12,345.00".
export function format(minor, currency = 'INR', locale = currency === 'INR' ? 'en-IN' : 'en-GB') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    toMajor(minor, currency),
  );
}
