import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BILLING_CYCLES, cycleMonths, isValidISODate, todayInTimeZone } from './dates.js';
import { testEmail } from './emails.js';
import {
  buildEmail, defaultReminderDays, deliverReminder, parseReminderDays, recipientsFor, renewalInfo, runReminderCheck,
} from './reminders.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
// The browser reuses the server's date logic so renewal previews always match.
const DATES_MODULE = fileURLToPath(new URL('./dates.js', import.meta.url));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
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

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  return id;
}

function basicAuth(password) {
  const expected = Buffer.from(password);
  return (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const supplied = Buffer.from(Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':'));
      if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Subscription Manager", charset="UTF-8"');
    res.status(401).send('Password required.');
  };
}

function parseClient(body) {
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

function parseSubscription(body, { store, settings }) {
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
    if (!Number.isInteger(client_id) || !store.getClient(client_id)) errors.push('Selected client does not exist.');
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

export function createApp({ store, mailer, config, now = () => new Date() }) {
  const app = express();
  const today = () => todayInTimeZone(config.timezone, now());

  const withRenewal = (sub, day = today()) => {
    const { renewalDate, daysUntil } = renewalInfo(sub, day);
    return {
      ...sub,
      next_renewal: renewalDate,
      days_until: daysUntil,
      monthly_equivalent: Math.round((sub.amount / cycleMonths(sub.billing_cycle)) * 100) / 100,
    };
  };

  const findSubscription = (id) => {
    const sub = store.getSubscription(parseId(id));
    if (!sub) throw new HttpError(404, 'Subscription not found.');
    return sub;
  };

  app.disable('x-powered-by');
  if (config.appPassword) app.use(basicAuth(config.appPassword));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(PUBLIC_DIR));
  app.get('/js/dates.js', (req, res) => res.sendFile(DATES_MODULE));

  app.get('/api/status', (req, res) => {
    const settings = store.getSettings();
    res.json({
      emailConfigured: mailer.configured,
      mailFrom: mailer.from,
      ownerEmailSet: Boolean(settings.owner_email),
      timezone: config.timezone,
      reminderTime: config.reminderTime,
      today: today(),
    });
  });

  app.get('/api/settings', (req, res) => res.json(store.getSettings()));

  app.put('/api/settings', (req, res) => {
    const errors = [];
    const patch = {};
    if ('business_name' in req.body) {
      patch.business_name = text(req.body.business_name, 200);
      if (!patch.business_name) errors.push('Business name is required.');
    }
    if ('owner_email' in req.body) {
      patch.owner_email = text(req.body.owner_email, 254) ?? '';
      if (patch.owner_email && !EMAIL.test(patch.owner_email)) errors.push('Your email address is not valid.');
    }
    if ('default_currency' in req.body) {
      patch.default_currency = (text(req.body.default_currency, 3) ?? '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(patch.default_currency)) errors.push('Default currency must be a 3-letter code.');
    }
    if ('client_note' in req.body) patch.client_note = text(req.body.client_note, 2000) ?? '';
    requireValid(errors);
    res.json(store.updateSettings(patch));
  });

  app.get('/api/clients', (req, res) => res.json(store.listClients()));

  app.post('/api/clients', (req, res) => res.status(201).json(store.createClient(parseClient(req.body))));

  app.put('/api/clients/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!store.getClient(id)) throw new HttpError(404, 'Client not found.');
    res.json(store.updateClient(id, parseClient(req.body)));
  });

  app.delete('/api/clients/:id', (req, res) => {
    if (!store.deleteClient(parseId(req.params.id))) throw new HttpError(404, 'Client not found.');
    res.status(204).end();
  });

  app.get('/api/subscriptions', (req, res) => {
    const day = today();
    res.json(store.listSubscriptions().map((sub) => withRenewal(sub, day)));
  });

  app.post('/api/subscriptions', (req, res) => {
    const data = parseSubscription(req.body, { store, settings: store.getSettings() });
    res.status(201).json(withRenewal(store.createSubscription(data)));
  });

  app.put('/api/subscriptions/:id', (req, res) => {
    const sub = findSubscription(req.params.id);
    const data = parseSubscription(req.body, { store, settings: store.getSettings() });
    res.json(withRenewal(store.updateSubscription(sub.id, data)));
  });

  app.delete('/api/subscriptions/:id', (req, res) => {
    if (!store.deleteSubscription(parseId(req.params.id))) throw new HttpError(404, 'Subscription not found.');
    res.status(204).end();
  });

  // Shows exactly what a reminder email will look like, without sending it.
  app.get('/api/subscriptions/:id/preview', (req, res) => {
    const sub = withRenewal(findSubscription(req.params.id));
    if (!sub.next_renewal) throw new HttpError(400, 'Cancelled subscriptions do not get reminders.');
    const recipientType = req.query.recipient === 'client' ? 'client' : 'owner';
    const settings = store.getSettings();
    const email = buildEmail(recipientType, {
      sub, settings, renewalDate: sub.next_renewal, daysUntil: sub.days_until, appUrl: config.appUrl,
    });
    const to = recipientType === 'client' ? sub.client_email : settings.owner_email;
    res.json({ to: to || null, ...email });
  });

  // "Send reminder now" button.
  app.post('/api/subscriptions/:id/send', async (req, res) => {
    const sub = withRenewal(findSubscription(req.params.id));
    if (!sub.next_renewal) throw new HttpError(400, 'Cancelled subscriptions do not get reminders.');
    if (!mailer.configured) throw new HttpError(400, 'Email is not configured yet. See the Settings page.');

    const settings = store.getSettings();
    const wanted = req.body?.recipients ?? ['owner', 'client'];
    const recipients = recipientsFor({ ...sub, notify_owner: true, notify_client: true }, settings)
      .filter((r) => wanted.includes(r.type));
    if (recipients.length === 0) {
      throw new HttpError(400, 'Nobody to email: add your email in Settings and/or an email address for the client.');
    }

    const results = [];
    for (const recipient of recipients) {
      results.push(await deliverReminder({
        store, mailer, settings, sub, recipient,
        renewalDate: sub.next_renewal, daysUntil: sub.days_until, daysBefore: null, manual: true, appUrl: config.appUrl,
      }));
    }
    res.json({ results });
  });

  app.get('/api/dashboard', (req, res) => {
    const day = today();
    const subs = store.listSubscriptions({ status: 'active' }).map((sub) => withRenewal(sub, day));
    const totals = {};
    for (const sub of subs) {
      totals[sub.currency] ??= { currency: sub.currency, monthly: 0, yearly: 0 };
      totals[sub.currency].monthly += sub.amount / cycleMonths(sub.billing_cycle);
      totals[sub.currency].yearly += sub.amount * (12 / cycleMonths(sub.billing_cycle));
    }
    const round = (n) => Math.round(n * 100) / 100;
    res.json({
      today: day,
      activeCount: subs.length,
      clientCount: store.listClients().length,
      renewingIn30Days: subs.filter((s) => s.days_until <= 30).length,
      totals: Object.values(totals).map((t) => ({ ...t, monthly: round(t.monthly), yearly: round(t.yearly) })),
      upcoming: subs.filter((s) => s.days_until <= 60).sort((a, b) => a.days_until - b.days_until),
    });
  });

  app.get('/api/reminders', (req, res) => res.json(store.listReminderLog()));

  app.post('/api/reminders/run', async (req, res) => {
    if (!mailer.configured) throw new HttpError(400, 'Email is not configured yet. See the Settings page.');
    res.json(await runReminderCheck({ store, mailer, today: today(), appUrl: config.appUrl }));
  });

  app.post('/api/test-email', async (req, res) => {
    if (!mailer.configured) throw new HttpError(400, 'Email is not configured yet. Add your SMTP settings to the .env file and restart.');
    const settings = store.getSettings();
    if (!settings.owner_email) throw new HttpError(400, 'Save your email address in Settings first.');
    try {
      await mailer.send({ to: settings.owner_email, fromName: settings.business_name, ...testEmail({ settings }) });
    } catch (err) {
      throw new HttpError(502, `Could not send: ${err.message}`);
    }
    res.json({ sentTo: settings.owner_email });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error(err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'Something went wrong.' : err.message });
  });

  return app;
}
