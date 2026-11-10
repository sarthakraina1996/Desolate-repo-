// Provider adapters: email, WhatsApp, push, payments and badge printing.
//
// Each has a clearly labelled LOCAL adapter used by the demo (nothing leaves this server) and a
// production adapter chosen with environment variables. Provider credentials are only ever
// read from server-side environment variables.
import crypto from 'node:crypto';
import http2 from 'node:http2';
import fs from 'node:fs';
import { nowIso, safeEqual } from '../core.js';

const b64url = (v) => Buffer.from(v).toString('base64url');

// ---------- outbox ----------
// Every message is recorded, whichever adapter sends it, so staff can see what went out.
function record(db, row) {
  return db.insert('outbox', { status: 'sent', created_at: nowIso(), ...row });
}

// ---------- email ----------
function localEmail(db) {
  return {
    name: 'local',
    label: 'Local demo email adapter (messages are stored, not delivered)',
    async send({ eventId, to, subject, text, template }) {
      record(db, {
        event_id: eventId ?? null,
        channel: 'email',
        adapter: 'local',
        recipient: to,
        subject,
        body: text,
        template,
      });
    },
  };
}
function smtpEmail(db, env) {
  let transport;
  return {
    name: 'smtp',
    label: `SMTP via ${env.SMTP_HOST}`,
    async send({ eventId, to, subject, text, template }) {
      const id = record(db, {
        event_id: eventId ?? null,
        channel: 'email',
        adapter: 'smtp',
        recipient: to,
        subject,
        body: text,
        template,
        status: 'queued',
      });
      try {
        if (!transport) {
          const nodemailer = (await import('nodemailer')).default;
          transport = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: Number(env.SMTP_PORT) || 587,
            secure: env.SMTP_SECURE === 'true',
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
          });
        }
        await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text });
        db.update('outbox', id, { status: 'sent' });
      } catch (e) {
        db.update('outbox', id, { status: 'failed', error: String(e.message).slice(0, 300) });
      }
    },
  };
}

// ---------- WhatsApp (optional integration) ----------
// Off unless WHATSAPP_ADAPTER is set. Only people who opted in are messaged, and only with
// templates the business has had approved by the provider.
function whatsapp(db, env) {
  const enabled = env.WHATSAPP_ADAPTER === 'local' || env.WHATSAPP_ADAPTER === 'cloud';
  return {
    name: enabled ? env.WHATSAPP_ADAPTER : 'off',
    enabled,
    async send({ eventId, to, text, template }) {
      if (!enabled || !to) return;
      const id = record(db, {
        event_id: eventId ?? null,
        channel: 'whatsapp',
        adapter: env.WHATSAPP_ADAPTER,
        recipient: to,
        body: text,
        template,
        status: env.WHATSAPP_ADAPTER === 'local' ? 'sent' : 'queued',
      });
      if (env.WHATSAPP_ADAPTER !== 'cloud') return;
      try {
        const res = await fetch(
          `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: to.replace(/[^0-9]/g, ''),
              type: 'template',
              template: {
                name: template,
                language: { code: 'en' },
                components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
              },
            }),
          },
        );
        if (!res.ok) throw new Error(`WhatsApp API answered ${res.status}`);
        db.update('outbox', id, { status: 'sent' });
      } catch (e) {
        db.update('outbox', id, { status: 'failed', error: String(e.message).slice(0, 300) });
      }
    },
  };
}

// ---------- push (APNs for iOS, FCM for Android) ----------
function jwt(header, claims, sign) {
  const head = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${head}.${sign(head).toString('base64url')}`;
}
function apnsSender(env) {
  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_KEY_FILE || !env.APNS_BUNDLE_ID)
    return null;
  let cached = { token: null, at: 0 };
  const bearer = () => {
    // Apple accepts a provider token for up to an hour; refresh after 40 minutes.
    if (!cached.token || Date.now() - cached.at > 40 * 60000) {
      const key = fs.readFileSync(env.APNS_KEY_FILE, 'utf8');
      cached = {
        at: Date.now(),
        token: jwt(
          { alg: 'ES256', kid: env.APNS_KEY_ID },
          { iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) },
          (data) => crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }),
        ),
      };
    }
    return cached.token;
  };
  const host =
    env.APNS_ENV === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
  return (token, { title, body, data }) =>
    new Promise((resolve, reject) => {
      const client = http2.connect(host);
      client.on('error', reject);
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${bearer()}`,
        'apns-topic': env.APNS_BUNDLE_ID,
        'apns-push-type': 'alert',
      });
      let status = 0;
      req.on('response', (h) => (status = h[':status']));
      req.on('end', () => {
        client.close();
        if (status === 200) resolve();
        else reject(new Error(`APNs answered ${status}`));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...data }));
      req.resume();
    });
}
function fcmSender(env) {
  if (!env.FCM_SERVICE_ACCOUNT_FILE) return null;
  let cached = { token: null, until: 0 };
  let account;
  const accessToken = async () => {
    if (cached.token && Date.now() < cached.until) return cached.token;
    account ||= JSON.parse(fs.readFileSync(env.FCM_SERVICE_ACCOUNT_FILE, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt(
      { alg: 'RS256', typ: 'JWT' },
      {
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      (data) => crypto.sign('RSA-SHA256', Buffer.from(data), account.private_key),
    );
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`Google token endpoint answered ${res.status}`);
    const out = await res.json();
    cached = { token: out.access_token, until: Date.now() + 50 * 60000 };
    return cached.token;
  };
  return async (token, { title, body, data }) => {
    const bearer = await accessToken();
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title, body }, data } }),
      },
    );
    if (!res.ok) throw new Error(`FCM answered ${res.status}`);
  };
}
function push(db, env) {
  const senders = { apns: apnsSender(env), fcm: fcmSender(env) };
  return {
    name: senders.apns || senders.fcm ? 'providers' : 'local',
    label:
      senders.apns || senders.fcm
        ? `Push via ${[senders.apns && 'APNs', senders.fcm && 'FCM'].filter(Boolean).join(' and ')}`
        : 'Local demo push adapter (notifications are stored, not delivered)',
    // Sends to every opted-in device of the audience. Failures are recorded, never thrown.
    async send({ eventId, tokens, title, body, data = {} }) {
      for (const t of tokens) {
        const send = senders[t.platform];
        const id = record(db, {
          event_id: eventId ?? null,
          channel: 'push',
          adapter: send ? t.platform : 'local',
          recipient: `${t.platform}:${t.token.slice(0, 12)}…`,
          subject: title,
          body,
          status: send ? 'queued' : 'sent',
        });
        if (!send) continue;
        try {
          await send(t.token, { title, body, data });
          db.update('outbox', id, { status: 'sent' });
        } catch (e) {
          db.update('outbox', id, { status: 'failed', error: String(e.message).slice(0, 300) });
        }
      }
    },
  };
}

// ---------- payments ----------
// A payment adapter creates a hosted checkout and turns provider callbacks into one shape:
//   { eventId, type, intentId, providerRef, amountPaise, method, occurredAt }
// type is one of payment.pending, payment.captured, payment.failed, refund.processed.
// parseWebhook must verify the provider's signature over the raw body and throw if it is wrong.
const hmacHex = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('hex');

function localPayments(env) {
  // The demo secret only signs callbacks this server sends to itself.
  const secret = env.PAYMENT_WEBHOOK_SECRET || 'local-demo-webhook-secret';
  return {
    name: 'local',
    label: 'Local demo payment adapter (no money moves)',
    async createCheckout({ payment }) {
      return { url: `/pay/${payment.intent_id}`, providerRef: null };
    },
    sign: (rawBody) => hmacHex(secret, rawBody),
    parseWebhook(rawBody, headers) {
      const given = String(headers['x-signature'] || '');
      if (!given || !safeEqual(given, hmacHex(secret, rawBody)))
        throw Object.assign(new Error('Bad webhook signature'), { status: 401 });
      const e = JSON.parse(rawBody.toString('utf8'));
      return {
        eventId: String(e.id),
        type: e.type,
        intentId: e.intentId,
        providerRef: e.providerRef || null,
        amountPaise: Number(e.amountPaise) || 0,
        method: e.method || null,
        occurredAt: e.occurredAt,
      };
    },
    async fetchStatus() {
      return null;
    },
  };
}

// Razorpay Payment Links (UPI, cards, net banking) with hosted checkout.
// Written against Razorpay's documented API; validate in Razorpay test mode before going live.
function razorpayPayments(env) {
  const auth = `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
  const api = async (method, path, body) => {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Razorpay answered ${res.status}`);
    return res.json();
  };
  const iso = (seconds) => new Date((seconds || Date.now() / 1000) * 1000).toISOString();
  return {
    name: 'razorpay',
    label: 'Razorpay hosted checkout',
    async createCheckout({ payment, description, customer, returnUrl }) {
      const link = await api('POST', '/payment_links', {
        amount: payment.amount_paise,
        currency: 'INR',
        reference_id: payment.intent_id,
        description,
        customer: { name: customer.name, email: customer.email, contact: customer.phone },
        notify: { sms: false, email: false },
        callback_url: returnUrl,
        callback_method: 'get',
        notes: { intent_id: payment.intent_id },
      });
      return { url: link.short_url, providerRef: link.id };
    },
    parseWebhook(rawBody, headers) {
      const given = String(headers['x-razorpay-signature'] || '');
      if (!given || !safeEqual(given, hmacHex(env.RAZORPAY_WEBHOOK_SECRET, rawBody)))
        throw Object.assign(new Error('Bad webhook signature'), { status: 401 });
      const e = JSON.parse(rawBody.toString('utf8'));
      const pay = e.payload?.payment?.entity;
      const link = e.payload?.payment_link?.entity;
      const refund = e.payload?.refund?.entity;
      const type = {
        'payment_link.paid': 'payment.captured',
        'payment.captured': 'payment.captured',
        'payment.authorized': 'payment.pending',
        'payment.failed': 'payment.failed',
        'refund.processed': 'refund.processed',
      }[e.event];
      return {
        eventId: String(headers['x-razorpay-event-id'] || `${e.event}:${pay?.id || refund?.id}`),
        type: type || 'ignored',
        intentId: link?.reference_id || pay?.notes?.intent_id || refund?.notes?.intent_id || null,
        providerRef: link?.id || null,
        amountPaise: Number(refund?.amount ?? pay?.amount ?? link?.amount_paid ?? 0),
        method: pay?.method || null,
        occurredAt: iso(e.created_at),
      };
    },
    // Asks Razorpay for the authoritative state of a payment link during reconciliation.
    async fetchStatus(payment) {
      if (!payment.provider_ref) return null;
      const link = await api('GET', `/payment_links/${payment.provider_ref}`);
      return {
        status: link.status === 'paid' ? 'captured' : link.status === 'expired' ? 'failed' : 'pending',
        amountPaise: Number(link.amount_paid) || 0,
      };
    },
  };
}

// ---------- badge printing ----------
// "local" pretends to print: a job succeeds unless its printer is in an error state, which is
// how the demo shows a failed job. "station" leaves jobs queued for a BrainADZ Events print
// station (the Windows desktop app) that is attached to a real badge printer.
function printer(env) {
  const mode = env.PRINTER_ADAPTER === 'station' ? 'station' : 'local';
  return {
    name: mode,
    label:
      mode === 'station'
        ? 'Print stations (Windows desktop app with a badge printer)'
        : 'Local demo printer adapter (nothing is printed)',
    // Returns the state a new job should move to straight away, if any.
    submit(job, target) {
      if (mode === 'station') return { status: 'queued' };
      if (!target) return { status: 'failed', error: 'No printer is set up for this gate' };
      if (target.status !== 'ready')
        return { status: 'failed', error: target.last_error || `Printer is ${target.status}` };
      return { status: 'printed' };
    },
  };
}

// Builds the adapter set from environment variables.
export function createAdapters(db, env = process.env) {
  return {
    email: env.EMAIL_ADAPTER === 'smtp' && env.SMTP_HOST ? smtpEmail(db, env) : localEmail(db),
    whatsapp: whatsapp(db, env),
    push: push(db, env),
    payments:
      env.PAYMENT_ADAPTER === 'razorpay' && env.RAZORPAY_KEY_ID
        ? razorpayPayments(env)
        : localPayments(env),
    printer: printer(env),
  };
}
