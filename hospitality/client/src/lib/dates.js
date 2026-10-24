// Calendar arithmetic on YYYY-MM-DD strings (UTC, so time zones never shift a night).
const DAY = 86400000;
const ms = (s) => Date.parse(`${s}T00:00:00Z`);
export const addDays = (s, n) => new Date(ms(s) + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
export const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
export function range(from, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}
