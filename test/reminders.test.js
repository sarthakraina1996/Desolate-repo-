import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { openDatabase } from '../src/db.js';
import { clientReminderEmail } from '../src/emails.js';
import { dueReminder, parseReminderDays, runReminderCheck } from '../src/reminders.js';
import { createStore } from '../src/store.js';

function fakeMailer({ failFor = [] } = {}) {
  const sent = [];
  return {
    configured: true,
    from: 'reminders@example.com',
    sent,
    async send(message) {
      if (failFor.includes(message.to)) throw new Error('Mailbox unavailable');
      sent.push(message);
    },
  };
}

function setup() {
  const store = createStore(openDatabase(':memory:'), {
    settingsDefaults: { business_name: 'Acme IT', owner_email: 'me@example.com' },
  });
  const client = store.createClient({ name: 'Jane Client', email: 'jane@client.com', company: 'Client Co' });
  return { store, client };
}

function subscription(overrides = {}) {
  return {
    name: 'Microsoft 365',
    billing_cycle: 'yearly',
    amount: 1200,
    currency: 'USD',
    start_date: '2025-10-21', // next renewal 2026-10-21
    reminder_days: '30,7,1',
    notify_owner: true,
    notify_client: true,
    status: 'active',
    ...overrides,
  };
}

describe('parseReminderDays', () => {
  it('parses, de-duplicates and sorts', () => {
    assert.deepEqual(parseReminderDays('7, 30,1, 7'), [30, 7, 1]);
    assert.deepEqual(parseReminderDays('0'), [0]);
  });

  it('rejects anything that is not a whole number of days', () => {
    assert.equal(parseReminderDays('7, soon'), null);
    assert.equal(parseReminderDays('1.5'), null);
    assert.equal(parseReminderDays('-1'), null);
    assert.equal(parseReminderDays('400'), null);
  });
});

describe('dueReminder', () => {
  const sub = { status: 'active', start_date: '2025-10-21', billing_cycle: 'yearly', reminder_days: '30,7,1' };

  it('picks the closest reminder that is due', () => {
    assert.equal(dueReminder(sub, '2026-09-10'), null); // 41 days out
    assert.equal(dueReminder(sub, '2026-09-21').daysBefore, 30);
    assert.equal(dueReminder(sub, '2026-10-10').daysBefore, 30); // 11 days out, still in the 30-day window
    assert.equal(dueReminder(sub, '2026-10-14').daysBefore, 7);
    assert.equal(dueReminder(sub, '2026-10-20').daysBefore, 1);
    assert.equal(dueReminder(sub, '2026-10-21').daysBefore, 1); // renewal day, no 0-day reminder configured
  });

  it('ignores cancelled subscriptions', () => {
    assert.equal(dueReminder({ ...sub, status: 'cancelled' }, '2026-10-14'), null);
  });
});

describe('runReminderCheck', () => {
  let store;
  let client;
  beforeEach(() => ({ store, client } = setup()));

  it('emails both you and the client, once per reminder', async () => {
    store.createSubscription(subscription({ client_id: client.id }));
    const mailer = fakeMailer();

    const first = await runReminderCheck({ store, mailer, today: '2026-10-14' });
    assert.equal(first.sent, 2);
    assert.deepEqual(mailer.sent.map((m) => m.to).sort(), ['jane@client.com', 'me@example.com']);
    const toClient = mailer.sent.find((m) => m.to === 'jane@client.com');
    assert.equal(toClient.replyTo, 'me@example.com');
    assert.equal(toClient.fromName, 'Acme IT');
    assert.match(toClient.subject, /Microsoft 365 subscription renews on 21 Oct 2026/);

    // Running again (same day, or the next few days) does not resend the 7-day reminder.
    assert.equal((await runReminderCheck({ store, mailer, today: '2026-10-14' })).sent, 0);
    assert.equal((await runReminderCheck({ store, mailer, today: '2026-10-17' })).sent, 0);

    // The 1-day reminder goes out the day before renewal.
    assert.equal((await runReminderCheck({ store, mailer, today: '2026-10-20' })).sent, 2);
    assert.equal(mailer.sent.length, 4);
  });

  it('starts over for the next renewal period', async () => {
    store.createSubscription(subscription({ client_id: client.id, billing_cycle: 'monthly', start_date: '2026-09-21', reminder_days: '7' }));
    const mailer = fakeMailer();
    assert.equal((await runReminderCheck({ store, mailer, today: '2026-10-14' })).sent, 2);
    assert.equal((await runReminderCheck({ store, mailer, today: '2026-11-14' })).sent, 2);
  });

  it('respects who should be notified', async () => {
    store.createSubscription(subscription({ client_id: client.id, notify_client: false }));
    const mailer = fakeMailer();
    await runReminderCheck({ store, mailer, today: '2026-10-14' });
    assert.deepEqual(mailer.sent.map((m) => m.to), ['me@example.com']);
  });

  it('retries a failed email on the next run and logs the failure', async () => {
    store.createSubscription(subscription({ client_id: client.id }));
    const failing = fakeMailer({ failFor: ['jane@client.com'] });
    const summary = await runReminderCheck({ store, mailer: failing, today: '2026-10-14' });
    assert.equal(summary.sent, 1);
    assert.equal(summary.failed, 1);
    assert.equal(store.listReminderLog().find((l) => l.status === 'failed').error, 'Mailbox unavailable');

    const working = fakeMailer();
    const retry = await runReminderCheck({ store, mailer: working, today: '2026-10-15' });
    assert.equal(retry.sent, 1);
    assert.deepEqual(working.sent.map((m) => m.to), ['jane@client.com']);
  });

  it('skips cancelled subscriptions and does nothing without email configured', async () => {
    store.createSubscription(subscription({ client_id: client.id, status: 'cancelled' }));
    const mailer = fakeMailer();
    assert.equal((await runReminderCheck({ store, mailer, today: '2026-10-14' })).sent, 0);

    store.createSubscription(subscription({ client_id: client.id }));
    const summary = await runReminderCheck({ store, mailer: { configured: false }, today: '2026-10-14' });
    assert.equal(summary.skipped, 'Email is not configured');
    assert.equal(store.listReminderLog().length, 0);
  });
});

describe('email content', () => {
  it('escapes user-entered text in HTML emails', () => {
    const { html } = clientReminderEmail({
      sub: { name: '<script>alert(1)</script>', billing_cycle: 'monthly', amount: 10, currency: 'USD', client_name: 'A & B' },
      settings: { business_name: 'Acme', client_note: '' },
      renewalDate: '2026-10-21',
      daysUntil: 7,
    });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('Hi A &amp; B,'));
  });
});
