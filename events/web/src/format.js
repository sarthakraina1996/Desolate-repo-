// Formatting for money, dates and operational states. Every state has words, never colour alone.
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const inr = (paise) => INR.format((paise || 0) / 100);
export const count = (n) => new Intl.NumberFormat('en-IN').format(n || 0);

const TZ = 'Asia/Kolkata';
const fmt = (opts) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...opts });
const asDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00+05:30`) : new Date(v));
export const day = (v) => (v ? fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(asDate(v)) : '');
export const weekday = (v) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(asDate(v));
export const clock = (v) => (v ? fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)) : '');
// "Thu 12" for day pickers; today's date and the time now at the venue, for "on now" labels.
export const shortDay = (v) => fmt({ weekday: 'short', day: 'numeric' }).format(asDate(v));
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const nowHM = () =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
export const dayTime = (v) => (v ? `${day(v)}, ${clock(v)}` : '');
export function dateRange(from, to) {
  if (!from) return '';
  if (from === to) return day(from);
  const a = asDate(from);
  const b = asDate(to);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return `${fmt(sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' }).format(a)}–${day(to)}`;
}
export function ago(v) {
  if (!v) return 'never';
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return day(v);
}

// [tone, label] for each state. Tones: ok, pending, error, or '' for neutral.
export const STATES = {
  registration: {
    confirmed: ['ok', 'Confirmed'],
    pending_review: ['pending', 'Awaiting review'],
    unverified: ['pending', 'Email not confirmed'],
    rejected: ['error', 'Not approved'],
    cancelled: ['error', 'Cancelled'],
  },
  payment: {
    not_required: ['', 'No payment'],
    pending: ['pending', 'Payment pending'],
    paid: ['ok', 'Paid'],
    failed: ['error', 'Payment failed'],
    refunded: ['', 'Refunded'],
    created: ['pending', 'Started'],
    captured: ['ok', 'Captured'],
  },
  order: {
    open: ['pending', 'Unpaid'],
    part_paid: ['pending', 'Part paid'],
    paid: ['ok', 'Paid'],
    cancelled: ['', 'Cancelled'],
    refunded: ['', 'Refunded'],
  },
  exhibitor: {
    draft: ['', 'Draft'],
    submitted: ['pending', 'Awaiting review'],
    changes_requested: ['pending', 'Changes requested'],
    approved: ['ok', 'Approved'],
    rejected: ['error', 'Not approved'],
  },
  booth: { confirmed: ['ok', 'Confirmed'], held: ['pending', 'Held'], available: ['', 'Available'], blocked: ['', 'Blocked'] },
  checklist: {
    todo: ['', 'To do'],
    awaiting_review: ['pending', 'Awaiting review'],
    changes_requested: ['error', 'Changes requested'],
    complete: ['ok', 'Complete'],
  },
  gate: { online: ['ok', 'Online'], pending: ['pending', 'Scans pending'], offline: ['error', 'Offline'], none: ['', 'No device'] },
  print: {
    queued: ['pending', 'Queued'],
    printing: ['pending', 'Printing'],
    printed: ['ok', 'Printed'],
    failed: ['error', 'Failed'],
    cancelled: ['', 'Cancelled'],
  },
  device: { active: ['ok', 'Active'], revoked: ['error', 'Removed'] },
  team: { invited: ['pending', 'Invited'], accepted: ['ok', 'Signed in'] },
  outbox: { sent: ['ok', 'Sent'], queued: ['pending', 'Queued'], failed: ['error', 'Failed'] },
};
export const ROLE_LABELS = {
  organiser_admin: 'Organiser admin',
  organiser_staff: 'Operations',
  finance: 'Finance',
  gate_supervisor: 'Gate supervisor',
  gate_staff: 'Gate staff',
  exhibitor_admin: 'Exhibitor admin',
  booth_staff: 'Booth staff',
};
