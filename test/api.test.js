import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

function startServer({ env = {}, mailer } = {}) {
  const config = loadConfig({ APP_TIMEZONE: 'UTC', OWNER_EMAIL: 'me@example.com', ...env });
  const store = createStore(openDatabase(':memory:'), { settingsDefaults: config.settingsDefaults });
  const app = createApp({ store, mailer, config, now: () => new Date('2026-10-14T10:00:00Z') });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

describe('API', () => {
  const sent = [];
  const mailer = { configured: true, from: 'reminders@example.com', async send(m) { sent.push(m); } };
  let server;
  let base;

  const call = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };

  before(async () => ({ server, base } = await startServer({ mailer })));
  after(() => server.close());

  it('serves the web app and the shared date module', async () => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Subscription Manager/);
    const dates = await fetch(`${base}/js/dates.js`);
    assert.equal(dates.status, 200);
    assert.match(dates.headers.get('content-type'), /javascript/);
  });

  it('manages clients and subscriptions end to end', async () => {
    const client = await call('/api/clients', { method: 'POST', body: { name: 'Jane', email: 'jane@client.com' } });
    assert.equal(client.status, 201);

    const created = await call('/api/subscriptions', {
      method: 'POST',
      body: { name: 'Adobe CC', billing_cycle: 'quarterly', amount: '150', start_date: '2026-07-21', client_id: client.body.id },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.next_renewal, '2026-10-21');
    assert.equal(created.body.days_until, 7);
    assert.equal(created.body.reminder_days, '14,3'); // quarterly default
    assert.equal(created.body.currency, 'USD');
    assert.equal(created.body.monthly_equivalent, 50);
    assert.equal(created.body.client_email, 'jane@client.com');

    const dashboard = await call('/api/dashboard');
    assert.equal(dashboard.body.activeCount, 1);
    assert.equal(dashboard.body.renewingIn30Days, 1);
    assert.deepEqual(dashboard.body.totals, [{ currency: 'USD', monthly: 50, yearly: 600 }]);

    const preview = await call(`/api/subscriptions/${created.body.id}/preview?recipient=client`);
    assert.equal(preview.body.to, 'jane@client.com');
    assert.match(preview.body.subject, /Adobe CC/);

    const send = await call(`/api/subscriptions/${created.body.id}/send`, { method: 'POST', body: { recipients: ['client'] } });
    assert.deepEqual(send.body.results.map((r) => [r.recipientEmail, r.status]), [['jane@client.com', 'sent']]);

    // Manual sends don't count as the automatic reminder, which still goes out.
    const run = await call('/api/reminders/run', { method: 'POST' });
    assert.equal(run.body.sent, 2);
    assert.equal((await call('/api/reminders')).body.length, 3);

    const updated = await call(`/api/subscriptions/${created.body.id}`, {
      method: 'PUT', body: { ...created.body, status: 'cancelled' },
    });
    assert.equal(updated.body.next_renewal, null);

    // Deleting the client keeps the subscription, just unlinked.
    assert.equal((await call(`/api/clients/${client.body.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call('/api/subscriptions')).body[0].client_id, null);

    assert.equal((await call(`/api/subscriptions/${created.body.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call('/api/subscriptions')).body.length, 0);
  });

  it('rejects invalid input with a readable message', async () => {
    const res = await call('/api/subscriptions', {
      method: 'POST', body: { name: '', billing_cycle: 'weekly', start_date: '2026-02-30', reminder_days: 'soon' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Software name is required/);
    assert.match(res.body.error, /Billing cycle/);
    assert.match(res.body.error, /First billing date/);
    assert.match(res.body.error, /Reminder days/);

    assert.equal((await call('/api/clients', { method: 'POST', body: { name: 'X', email: 'not-an-email' } })).status, 400);
    assert.equal((await call('/api/subscriptions/999', { method: 'PUT', body: {} })).status, 404);
    assert.equal((await call('/api/subscriptions/abc', { method: 'DELETE' })).status, 404);
  });

  it('saves settings', async () => {
    const res = await call('/api/settings', {
      method: 'PUT', body: { business_name: 'Acme IT', owner_email: 'boss@acme.com', default_currency: 'inr', client_note: 'Pay by card.' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.default_currency, 'INR');
    assert.equal((await call('/api/settings')).body.owner_email, 'boss@acme.com');

    const test = await call('/api/test-email', { method: 'POST' });
    assert.equal(test.body.sentTo, 'boss@acme.com');
    assert.equal(sent.at(-1).subject, 'Subscription Manager: test email');
  });
});

describe('API without email configured', () => {
  it('explains that email needs setting up', async () => {
    const { server, base } = await startServer({ mailer: { configured: false, from: '' } });
    try {
      const status = await (await fetch(`${base}/api/status`)).json();
      assert.equal(status.emailConfigured, false);
      const res = await fetch(`${base}/api/reminders/run`, { method: 'POST' });
      assert.equal(res.status, 400);
      assert.match((await res.json()).error, /not configured/);
    } finally {
      server.close();
    }
  });
});

describe('password protection', () => {
  it('requires the password when APP_PASSWORD is set', async () => {
    const { server, base } = await startServer({ env: { APP_PASSWORD: 's3cret' }, mailer: { configured: false } });
    try {
      assert.equal((await fetch(`${base}/api/status`)).status, 401);
      const wrong = Buffer.from('admin:nope').toString('base64');
      assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: `Basic ${wrong}` } })).status, 401);
      const right = Buffer.from('admin:s3cret').toString('base64');
      assert.equal((await fetch(`${base}/api/status`, { headers: { Authorization: `Basic ${right}` } })).status, 200);
    } finally {
      server.close();
    }
  });
});
