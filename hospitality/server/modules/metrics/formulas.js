// Pure KPI formulas (docs/FINANCIAL_METRICS.md §3). Inputs are base measures; currency values
// are integer minor units. Division by zero returns null (shown as "—"), never 0 or Infinity.

export const ratio = (num, den) => (den ? num / den : null);
const pct = (num, den) => (den ? (num / den) * 100 : null);
const money = (num, den) => (den ? Math.round(num / den) : null);

export const occupancyPct = (sold, available) => pct(sold, available);
export const adr = (roomRevenue, sold) => money(roomRevenue, sold);
export const revpar = (roomRevenue, available) => money(roomRevenue, available);
export const trevpar = (totalRevenue, available) => money(totalRevenue, available);
export const goppar = (gop, available) => money(gop, available);
export const gopMarginPct = (gop, totalRevenue) => pct(gop, totalRevenue);
export const cpor = (roomsExpenses, sold) => money(roomsExpenses, sold);
export const alos = (stayNights, stays) => ratio(stayNights, stays);
export const cancellationRatePct = (cancelled, expected) => pct(cancelled, expected + cancelled);
export const noShowRatePct = (noShows, expected) => pct(noShows, expected);
export const directPct = (directNights, sold) => pct(directNights, sold);
export const foodCostPct = (foodCogs, foodSales) => pct(foodCogs, foodSales);
export const beverageCostPct = (bevCogs, bevSales) => pct(bevCogs, bevSales);
export const primeCost = (fnbCogs, fnbLabour) => fnbCogs + fnbLabour;
export const apc = (netSales, covers) => money(netSales, covers);
export const aov = (netOrderSales, orders) => money(netOrderSales, orders);
export const revpash = (revenue, seatHours) => money(revenue, seatHours);
export const contributionMarginPct = (revenue, variableCost) => pct(revenue - variableCost, revenue);
export const variance = (actual, plan) => ({ abs: actual - plan, pct: plan ? ((actual - plan) / Math.abs(plan)) * 100 : null });

// Change from a prior value: absolute delta and %; for percentage metrics the delta is in
// percentage points and pct is left null.
export function change(current, prior, { isPercent = false } = {}) {
  if (current == null || prior == null) return { abs: null, pct: null };
  if (isPercent) return { abs: current - prior, pct: null };
  return { abs: current - prior, pct: prior ? ((current - prior) / Math.abs(prior)) * 100 : null };
}
