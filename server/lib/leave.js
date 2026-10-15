// Leave arithmetic: working-day counting and entitlement. Pure functions.
import { dow, eachDay, yearOf } from './dates.js';

// ctx: { weeklyOffs: number[] (0 = Sunday), holidays: Set<'YYYY-MM-DD'> }
export function isWorkingDay(date, ctx) {
  return !ctx.weeklyOffs.includes(dow(date)) && !ctx.holidays.has(date);
}

// Returns a Map of year -> days for a request, so a leave spanning
// 31 Dec - 2 Jan is charged to the right year's balance.
export function leaveDaysByYear({ from, to, halfDay, calendarDays }, ctx) {
  const out = new Map();
  if (halfDay) {
    if (calendarDays || isWorkingDay(from, ctx)) out.set(yearOf(from), 0.5);
    return out;
  }
  for (const d of eachDay(from, to)) {
    if (calendarDays || isWorkingDay(d, ctx)) out.set(yearOf(d), (out.get(yearOf(d)) || 0) + 1);
  }
  return out;
}

export function countLeaveDays(req, ctx) {
  let total = 0;
  for (const v of leaveDaysByYear(req, ctx).values()) total += v;
  return total;
}

export const roundHalf = (x) => Math.round(x * 2) / 2;

// Leave credited for `year` as of `asOf`. Annual types are credited up front,
// pro-rated from the joining month; monthly types accrue at the start of each
// month of service. A null quota means unlimited (e.g. Loss of Pay).
export function entitlement(type, joinDate, year, asOf) {
  if (type.annual_quota == null) return null;
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  if (joinDate > yEnd) return 0;
  const start = joinDate > yStart ? joinDate : yStart;
  const startMonth = Number(start.slice(5, 7));
  if (type.accrual === 'monthly') {
    const until = asOf < yEnd ? asOf : yEnd;
    if (until < start) return 0;
    const endMonth = yearOf(until) === year ? Number(until.slice(5, 7)) : 12;
    return roundHalf((type.annual_quota * (endMonth - startMonth + 1)) / 12);
  }
  return roundHalf((type.annual_quota * (12 - startMonth + 1)) / 12);
}
