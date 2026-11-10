// Routes that need no sign-in: the published event, registration, pass retrieval, hosted
// checkout, payment callbacks and venue displays.
import express, { Router } from 'express';
import { email as vEmail, fail, nowIso, oneOf, str } from '../core.js';
import { createSession, issueOtp } from '../auth.js';
import { agenda, directory, displayData, eventSummary, guide, landing, mapData } from '../services/guide.js';
import {
  cancelRegistration,
  createRegistration,
  registrationByToken,
  registrationState,
  rotateAccess,
  verifyRegistration,
} from '../services/registrations.js';
import { handleWebhook, orderByToken, orderView, startCheckout } from '../services/payments.js';
import { mail } from '../services/mail.js';

export default function publicRoutes(ctx) {
  const { db, adapters } = ctx;
  const r = Router();
  const showCodes = () => adapters.email.name === 'local' && process.env.DEMO_SHOW_CODES !== 'false';

  // Only published events exist as far as the public is concerned.
  const published = (req) => {
    const event = db.get("SELECT * FROM events WHERE slug = ? AND status = 'published'", req.params.slug);
    if (!event) fail(404, 'Event not found');
    return event;
  };

  r.get('/public/events', (_req, res) => {
    res.json(
      db
        .all("SELECT * FROM events WHERE status = 'published' ORDER BY starts_on")
        .map(eventSummary),
    );
  });
  r.get('/public/events/:slug', (req, res) => res.json(landing(db, published(req))));
  r.get('/public/events/:slug/guide', (req, res) => {
    const event = published(req);
    // Apps send the version they hold; an unchanged guide costs one small response.
    if (Number(req.query.have) === event.guide_version)
      return res.json({ version: event.guide_version, unchanged: true });
    res.json(guide(db, event));
  });
  r.get('/public/events/:slug/exhibitors', (req, res) => res.json(directory(db, published(req))));
  r.get('/public/events/:slug/map', (req, res) => res.json(mapData(db, published(req))));
  r.get('/public/events/:slug/agenda', (req, res) => res.json(agenda(db, published(req))));

  // ---------- registration ----------
  r.post('/public/events/:slug/registrations', (req, res) => {
    const event = published(req);
    const source = oneOf(req.body.client, ['ios', 'android']) || 'web';
    const out = createRegistration(ctx, event, req.body, { source });
    res.status(201).json({ ref: out.ref, email: out.email, ...(showCodes() ? { demoCode: out.code } : {}) });
  });

  r.post('/public/events/:slug/registrations/:ref/resend-code', (req, res) => {
    const event = published(req);
    const reg = db.get('SELECT * FROM registrations WHERE ref = ? AND event_id = ?', req.params.ref, event.id);
    if (!reg) fail(404, 'Registration not found');
    const code = issueOtp(db, { email: reg.email, purpose: 'registration', ref: reg.ref });
    mail.registrationCode(ctx, event, reg, code);
    res.json({ ok: true, ...(showCodes() ? { demoCode: code } : {}) });
  });

  // Confirms the email, signs the visitor in and says what happens next.
  r.post('/public/events/:slug/registrations/:ref/verify', (req, res) => {
    const event = published(req);
    const out = verifyRegistration(ctx, event, { ref: req.params.ref, code: req.body.code });
    const session = createSession(db, req, res, out.userId);
    res.json({ ...session, accessToken: out.token, registration: registrationState(ctx, event, out.registration) });
  });

  // "Find my pass": emails a fresh link for each registration under this address.
  // Always answers the same, so it cannot be used to check who is registered.
  r.post('/public/events/:slug/pass-link', (req, res) => {
    const event = published(req);
    const email = vEmail(req.body.email, { required: true });
    const regs = db.all(
      "SELECT * FROM registrations WHERE event_id = ? AND email = ? AND status NOT IN ('unverified','cancelled')",
      event.id,
      email,
    );
    for (const reg of regs) mail.passLink(ctx, event, reg, rotateAccess(db, reg));
    res.json({ ok: true });
  });

  // ---------- pass retrieval link ----------
  const byToken = (req) => {
    const reg = registrationByToken(db, req.params.token);
    if (!reg) fail(404, 'This link is no longer valid. Use "Find my pass" to get a new one.', 'link_invalid');
    return { reg, event: db.get('SELECT * FROM events WHERE id = ?', reg.event_id) };
  };
  r.get('/public/pass/:token', (req, res) => {
    const { reg, event } = byToken(req);
    res.json(registrationState(ctx, event, reg));
  });
  r.post('/public/pass/:token/cancel', (req, res) => {
    const { reg, event } = byToken(req);
    res.json(registrationState(ctx, event, cancelRegistration(ctx, req, event, reg, { by: 'visitor' })));
  });

  // ---------- hosted checkout ----------
  r.post('/public/orders/:token/checkout', async (req, res) => {
    const order = orderByToken(ctx, req.params.token);
    if (!order) fail(404, 'Order not found');
    const event = db.get('SELECT * FROM events WHERE id = ?', order.event_id);
    const reg = order.registration_id
      ? db.get('SELECT * FROM registrations WHERE id = ?', order.registration_id)
      : null;
    // Only same-site paths are accepted as a return address.
    const back = str(req.body.returnPath, { max: 300 });
    const returnUrl = `${ctx.baseUrl}${back && /^\/[^/\\]/.test(back) ? back : '/'}`;
    res.json(
      await startCheckout(ctx, event, order, {
        customer: { name: reg?.name || '', email: reg?.email || '', phone: reg?.phone || '' },
        returnUrl,
      }),
    );
  });

  // The local demo adapter's own "bank page". It exists only while that adapter is active.
  const localIntent = (req) => {
    if (adapters.payments.name !== 'local') fail(404, 'Not found');
    const payment = db.get('SELECT * FROM payments WHERE intent_id = ?', req.params.intent);
    if (!payment) fail(404, 'Payment not found');
    return payment;
  };
  r.get('/public/pay/:intent', (req, res) => {
    const payment = localIntent(req);
    const order = db.get('SELECT * FROM orders WHERE id = ?', payment.order_id);
    const event = db.get('SELECT * FROM events WHERE id = ?', payment.event_id);
    res.json({
      adapter: adapters.payments.label,
      status: payment.status,
      amountPaise: payment.amount_paise,
      order: orderView(db, order),
      event: { name: event.name, slug: event.slug },
    });
  });
  // Plays the provider's part: builds a signed callback and delivers it through the same
  // handler real callbacks use.
  r.post('/public/pay/:intent/simulate', (req, res) => {
    const payment = localIntent(req);
    const outcome = oneOf(req.body.outcome, ['captured', 'failed', 'pending'], { required: true, name: 'Outcome' });
    const body = Buffer.from(
      JSON.stringify({
        id: `evt_${payment.intent_id}_${outcome}_${Date.now()}`,
        type: `payment.${outcome}`,
        intentId: payment.intent_id,
        amountPaise: payment.amount_paise,
        method: oneOf(req.body.method, ['upi', 'card', 'netbanking']) || 'upi',
        occurredAt: nowIso(),
      }),
    );
    const out = handleWebhook(ctx, 'local', body, { 'x-signature': adapters.payments.sign(body) });
    res.json({ outcome: out.outcome, status: out.payment?.status });
  });

  // Provider callbacks. The raw body is kept so the signature can be verified byte for byte.
  r.post('/webhooks/payments/:provider', express.raw({ type: '*/*', limit: '256kb' }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const out = handleWebhook(ctx, req.params.provider, raw, req.headers);
    res.json({ ok: true, outcome: out.outcome });
  });

  // ---------- venue displays ----------
  r.get('/public/display/:slug/:kiosk', (req, res) => {
    const event = published(req);
    const kiosk = db.get('SELECT * FROM kiosks WHERE event_id = ? AND code = ?', event.id, req.params.kiosk);
    if (!kiosk) fail(404, 'Display not found');
    res.json(displayData(db, event, kiosk));
  });

  return r;
}
