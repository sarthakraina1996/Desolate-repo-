// Reporting period presets and comparisons (docs/FINANCIAL_METRICS.md §4). Presets resolve
// against the last closed business date; `today` is the open (provisional) business date.
import { fail } from '../../core/errors.js';
import { addDays, addYears, diffDays, fiscalYear, isYmd, monthStart } from '../../core/dates.js';

export const PRESETS = ['today', 'yesterday', 'last7', 'last30', 'mtd', 'qtd', 'ytd', 'fy', 'custom'];

export function resolvePeriod({ preset = 'mtd', from, to, businessDate, fyStartMonth = 4 }) {
  const closed = addDays(businessDate, -1);
  switch (preset) {
    case 'today':
      return { preset, from: businessDate, to: businessDate, provisional: true };
    case 'yesterday':
      return { preset, from: closed, to: closed };
    case 'last7':
      return { preset, from: addDays(closed, -6), to: closed };
    case 'last30':
      return { preset, from: addDays(closed, -29), to: closed };
    case 'mtd':
      return { preset, from: monthStart(closed), to: closed };
    case 'qtd': {
      const [y, m] = closed.split('-').map(Number);
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { preset, from: `${y}-${String(qm).padStart(2, '0')}-01`, to: closed };
    }
    case 'ytd':
      return { preset, from: `${closed.slice(0, 4)}-01-01`, to: closed };
    case 'fy': {
      const fy = fiscalYear(closed, fyStartMonth);
      return { preset, from: fy.start, to: closed, label: fy.label };
    }
    case 'custom':
      if (!isYmd(from) || !isYmd(to) || to < from) fail(400, 'Choose a valid custom date range');
      if (diffDays(from, to) > 3 * 366) fail(400, 'Custom ranges are limited to three years');
      return { preset, from, to, provisional: to >= businessDate };
    default:
      fail(400, `Unknown period ${preset}`);
  }
}

// Comparison range: `previous` = same length immediately before; `last_year` = same dates a
// year earlier (29 Feb → 28 Feb).
export function comparePeriod(period, mode = 'previous') {
  if (!mode || mode === 'none') return null;
  if (mode === 'last_year') return { mode, from: addYears(period.from, -1), to: addYears(period.to, -1) };
  if (mode === 'previous') {
    const len = diffDays(period.from, period.to) + 1;
    return { mode, from: addDays(period.from, -len), to: addDays(period.from, -1) };
  }
  fail(400, `Unknown comparison ${mode}`);
}
