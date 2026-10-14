// Turns stored subscriptions into what the screens show. Shared by the server and
// the online preview.
import { cycleMonths } from './dates.js';
import { renewalInfo } from './reminders.js';

const round = (n) => Math.round(n * 100) / 100;

export function withRenewal(sub, today) {
  const { renewalDate, daysUntil } = renewalInfo(sub, today);
  return {
    ...sub,
    next_renewal: renewalDate,
    days_until: daysUntil,
    monthly_equivalent: round(sub.amount / cycleMonths(sub.billing_cycle)),
  };
}

// `activeSubs` must already have gone through withRenewal.
export function dashboardSummary(activeSubs, clientCount, today) {
  const totals = {};
  for (const sub of activeSubs) {
    totals[sub.currency] ??= { currency: sub.currency, monthly: 0, yearly: 0 };
    totals[sub.currency].monthly += sub.amount / cycleMonths(sub.billing_cycle);
    totals[sub.currency].yearly += sub.amount * (12 / cycleMonths(sub.billing_cycle));
  }
  return {
    today,
    activeCount: activeSubs.length,
    clientCount,
    renewingIn30Days: activeSubs.filter((s) => s.days_until <= 30).length,
    totals: Object.values(totals).map((t) => ({ ...t, monthly: round(t.monthly), yearly: round(t.yearly) })),
    upcoming: activeSubs.filter((s) => s.days_until <= 60).sort((a, b) => a.days_until - b.days_until),
  };
}
