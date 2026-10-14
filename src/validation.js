// Checks and cleans what people type into the forms. Shared by the server and the
// online preview so both accept and reject exactly the same input.
import { BILLING_CYCLES, isValidISODate } from './dates.js';
import { defaultReminderDays, parseReminderDays } from './reminders.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, max = 500) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim().slice(0, max);
  return trimmed || null;
}

function requireValid(errors) {
  if (errors.length) throw new HttpError(400, errors.join(' '));
}

export function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  return id;
}

export function parseClient(body) {
  const data = {
    name: text(body.name, 200),
    email: text(body.email, 254),
    company: text(body.company, 200),
    phone: text(body.phone, 50),
    notes: text(body.notes, 2000),
  };
  const errors = [];
  if (!data.name) errors.push('Client name is required.');
  if (data.email && !EMAIL.test(data.email)) errors.push('Client email address is not valid.');
  requireValid(errors);
  return data;
}

// `clientExists(id)` answers whether a client id is real.
export function parseSubscription(body, { settings, clientExists }) {
  const errors = [];
  const billing_cycle = body.billing_cycle;
  if (!BILLING_CYCLES.includes(billing_cycle)) errors.push('Billing cycle must be monthly, quarterly or yearly.');

  const amount = body.amount === '' || body.amount === undefined ? 0 : Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) errors.push('Amount must be a number of 0 or more.');

  const currency = (text(body.currency, 3) || settings.default_currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.push('Currency must be a 3-letter code such as USD, EUR or INR.');

  if (!isValidISODate(body.start_date)) errors.push('First billing date is required.');

  const reminderInput = text(body.reminder_days, 100);
  const reminderDays = reminderInput === null ? defaultReminderDays(billing_cycle) : parseReminderDays(reminderInput);
  if (!reminderDays) errors.push('Reminder days must be whole numbers between 0 and 365, separated by commas (e.g. 30, 7, 1).');

  let client_id = null;
  if (body.client_id !== undefined && body.client_id !== null && body.client_id !== '') {
    client_id = Number(body.client_id);
    if (!Number.isInteger(client_id) || !clientExists(client_id)) errors.push('Selected client does not exist.');
  }

  const status = body.status ?? 'active';
  if (!['active', 'cancelled'].includes(status)) errors.push('Status must be active or cancelled.');

  const name = text(body.name, 200);
  if (!name) errors.push('Software name is required.');

  requireValid(errors);
  return {
    name,
    vendor: text(body.vendor, 200),
    plan: text(body.plan, 200),
    client_id,
    billing_cycle,
    amount: Math.round(amount * 100) / 100,
    currency,
    start_date: body.start_date,
    reminder_days: reminderDays.join(','),
    notify_owner: body.notify_owner !== false,
    notify_client: body.notify_client !== false,
    status,
    notes: text(body.notes, 2000),
  };
}

// Returns only the settings that were sent, cleaned.
export function parseSettings(body) {
  const errors = [];
  const patch = {};
  if ('business_name' in body) {
    patch.business_name = text(body.business_name, 200);
    if (!patch.business_name) errors.push('Business name is required.');
  }
  if ('owner_email' in body) {
    patch.owner_email = text(body.owner_email, 254) ?? '';
    if (patch.owner_email && !EMAIL.test(patch.owner_email)) errors.push('Your email address is not valid.');
  }
  if ('default_currency' in body) {
    patch.default_currency = (text(body.default_currency, 3) ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(patch.default_currency)) errors.push('Default currency must be a 3-letter code.');
  }
  if ('client_note' in body) patch.client_note = text(body.client_note, 2000) ?? '';
  requireValid(errors);
  return patch;
}
