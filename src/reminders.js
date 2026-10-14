import { daysBetween, nextRenewalDate } from './dates.js';
import { clientReminderEmail, ownerReminderEmail } from './emails.js';

const DEFAULT_REMINDER_DAYS = { monthly: [7, 1], quarterly: [14, 3], yearly: [30, 7, 1] };

export function defaultReminderDays(cycle) {
  return DEFAULT_REMINDER_DAYS[cycle] ?? [7, 1];
}

// "30, 7,1" -> [30, 7, 1]. Returns null if anything in the list is not a whole number 0-365.
export function parseReminderDays(value) {
  const parts = String(value ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const days = parts.map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 365)) return null;
  return [...new Set(days)].sort((a, b) => b - a);
}

// Where a subscription stands today: its next renewal and how many days away it is.
export function renewalInfo(sub, today) {
  if (sub.status !== 'active') return { renewalDate: null, daysUntil: null };
  const renewalDate = nextRenewalDate(sub.start_date, sub.billing_cycle, today);
  return { renewalDate, daysUntil: daysBetween(today, renewalDate) };
}

// Which reminder (if any) is due today. A reminder set for N days before is "due"
// from that day until the renewal, so if the app was offline on the exact day the
// reminder still goes out on the next run. Only the closest due reminder is used,
// so adding a subscription that renews in 3 days sends one email, not three.
export function dueReminder(sub, today) {
  const { renewalDate, daysUntil } = renewalInfo(sub, today);
  if (!renewalDate) return null;
  const thresholds = parseReminderDays(sub.reminder_days) ?? [];
  const due = thresholds.filter((t) => daysUntil <= t);
  if (due.length === 0) return null;
  return { renewalDate, daysUntil, daysBefore: Math.min(...due) };
}

export function recipientsFor(sub, settings) {
  const recipients = [];
  if (sub.notify_owner && settings.owner_email) recipients.push({ type: 'owner', email: settings.owner_email });
  if (sub.notify_client && sub.client_email) recipients.push({ type: 'client', email: sub.client_email });
  return recipients;
}

export function buildEmail(recipientType, context) {
  return recipientType === 'client' ? clientReminderEmail(context) : ownerReminderEmail(context);
}

// Sends one reminder and records the outcome in the reminder log.
export async function deliverReminder({ store, mailer, settings, sub, recipient, renewalDate, daysUntil, daysBefore, manual, appUrl }) {
  const email = buildEmail(recipient.type, { sub, settings, renewalDate, daysUntil, appUrl });
  const entry = {
    subscriptionId: sub.id,
    subscriptionName: sub.name,
    renewalDate,
    daysBefore,
    recipientType: recipient.type,
    recipientEmail: recipient.email,
    manual,
  };
  try {
    await mailer.send({
      to: recipient.email,
      ...email,
      fromName: settings.business_name,
      // Client replies should reach you, not the sending mailbox.
      replyTo: recipient.type === 'client' ? settings.owner_email : undefined,
    });
    store.logReminder({ ...entry, status: 'sent' });
    return { ...entry, status: 'sent' };
  } catch (err) {
    store.logReminder({ ...entry, status: 'failed', error: err.message });
    return { ...entry, status: 'failed', error: err.message };
  }
}

let inFlight = null;

// Checks every active subscription and sends any reminders that are due today.
// Safe to run as often as you like: a reminder is never sent twice.
export function runReminderCheck(options) {
  if (!inFlight) inFlight = checkAll(options).finally(() => { inFlight = null; });
  return inFlight;
}

async function checkAll({ store, mailer, today, appUrl = '' }) {
  if (!mailer.configured) return { today, skipped: 'Email is not configured', sent: 0, failed: 0, results: [] };

  const settings = store.getSettings();
  const results = [];
  for (const sub of store.listSubscriptions({ status: 'active' })) {
    const due = dueReminder(sub, today);
    if (!due) continue;
    for (const recipient of recipientsFor(sub, settings)) {
      const alreadySent = store.hasSentReminder({
        subscriptionId: sub.id,
        renewalDate: due.renewalDate,
        daysBefore: due.daysBefore,
        recipientType: recipient.type,
      });
      if (alreadySent) continue;
      results.push(await deliverReminder({ store, mailer, settings, sub, recipient, ...due, manual: false, appUrl }));
    }
  }
  return {
    today,
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  };
}
