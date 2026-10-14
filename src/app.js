import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { todayInTimeZone } from './dates.js';
import { testEmail } from './emails.js';
import { buildEmail, deliverReminder, recipientsFor, runReminderCheck } from './reminders.js';
import { HttpError, parseClient, parseId, parseSettings, parseSubscription } from './validation.js';
import { dashboardSummary, withRenewal } from './views.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
// The browser reuses the server's date logic so renewal previews always match.
const DATES_MODULE = fileURLToPath(new URL('./dates.js', import.meta.url));

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

export function createApp({ store, mailer, config, now = () => new Date() }) {
  const app = express();
  const today = () => todayInTimeZone(config.timezone, now());

  const decorate = (sub, day = today()) => withRenewal(sub, day);
  const subscriptionInput = (body) => parseSubscription(body, {
    settings: store.getSettings(),
    clientExists: (id) => Boolean(store.getClient(id)),
  });

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

  app.put('/api/settings', (req, res) => res.json(store.updateSettings(parseSettings(req.body))));

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
    res.json(store.listSubscriptions().map((sub) => decorate(sub, day)));
  });

  app.post('/api/subscriptions', (req, res) => {
    res.status(201).json(decorate(store.createSubscription(subscriptionInput(req.body))));
  });

  app.put('/api/subscriptions/:id', (req, res) => {
    const sub = findSubscription(req.params.id);
    res.json(decorate(store.updateSubscription(sub.id, subscriptionInput(req.body))));
  });

  app.delete('/api/subscriptions/:id', (req, res) => {
    if (!store.deleteSubscription(parseId(req.params.id))) throw new HttpError(404, 'Subscription not found.');
    res.status(204).end();
  });

  // Shows exactly what a reminder email will look like, without sending it.
  app.get('/api/subscriptions/:id/preview', (req, res) => {
    const sub = decorate(findSubscription(req.params.id));
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
    const sub = decorate(findSubscription(req.params.id));
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
    const active = store.listSubscriptions({ status: 'active' }).map((sub) => decorate(sub, day));
    res.json(dashboardSummary(active, store.listClients().length, day));
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
