// Orders and payments. Amounts are integer paise. Provider callbacks are deduplicated on the
// provider's event id and applied through one state machine, so a replayed or out-of-order
// callback can never create a second entitlement or move a payment backwards.
import crypto from 'node:crypto';
import { isUniqueViolation, json } from '../db.js';
import {
  audit,
  eventSettings,
  fail,
  gstOn,
  inr,
  nextCounter,
  nowIso,
  randomToken,
  safeEqual,
} from '../core.js';
import { advance } from './registrations.js';
import { confirmAssignment } from './exhibitors.js';
import { revokePass } from './passes.js';
import { mail } from './mail.js';

// ---------- orders ----------
export function createOrder(
  ctx,
  event,
  { kind, registrationId, exhibitorId, boothAssignmentId, items, dueOn },
) {
  const { db } = ctx;
  return db.tx(() => {
    const lines = items.map((i) => ({
      description: i.description,
      qty: i.qty,
      unit_paise: i.unitPaise,
      gst_percent: i.gstPercent ?? 18,
      amount_paise: i.qty * i.unitPaise,
    }));
    const subtotal = lines.reduce((a, l) => a + l.amount_paise, 0);
    const gst = lines.reduce((a, l) => a + gstOn(l.amount_paise, l.gst_percent), 0);
    const prefix = eventSettings(event).orderPrefix || 'ORD';
    const id = db.insert('orders', {
      event_id: event.id,
      number: `${prefix}-${String(nextCounter(db, event.id, 'order')).padStart(4, '0')}`,
      kind,
      registration_id: registrationId ?? null,
      exhibitor_id: exhibitorId ?? null,
      booth_assignment_id: boothAssignmentId ?? null,
      subtotal_paise: subtotal,
      gst_paise: gst,
      total_paise: subtotal + gst,
      due_on: dueOn ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    for (const l of lines) db.insert('order_items', { order_id: id, ...l });
    return db.get('SELECT * FROM orders WHERE id = ?', id);
  });
}

export function orderView(db, order) {
  return {
    id: order.id,
    number: order.number,
    kind: order.kind,
    status: order.status,
    items: db
      .all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id)
      .map((i) => ({
        description: i.description,
        qty: i.qty,
        unitPaise: i.unit_paise,
        gstPercent: i.gst_percent,
        amountPaise: i.amount_paise,
      })),
    subtotalPaise: order.subtotal_paise,
    gstPaise: order.gst_paise,
    totalPaise: order.total_paise,
    paidPaise: order.paid_paise,
    refundedPaise: order.refunded_paise,
    balancePaise: Math.max(0, order.total_paise - order.paid_paise),
    invoiceNo: order.invoice_no,
    dueOn: order.due_on,
    createdAt: order.created_at,
  };
}

// A stable link token for an order's hosted checkout: the order number signed with the
// server secret. Nothing is stored and the token cannot be guessed from the number.
const signOrder = (ctx, number) =>
  crypto.createHmac('sha256', ctx.secret).update(`order:${number}`).digest('base64url').slice(0, 24);
export const orderToken = (ctx, order) => `${order.number}.${signOrder(ctx, order.number)}`;
export function orderByToken(ctx, token) {
  const i = String(token || '').lastIndexOf('.');
  if (i < 1) return null;
  const number = token.slice(0, i);
  if (!safeEqual(token.slice(i + 1), signOrder(ctx, number))) return null;
  return ctx.db.get('SELECT * FROM orders WHERE number = ?', number) || null;
}

// Starts a hosted checkout for the balance (or a part of it) and returns where to send the payer.
export async function startCheckout(ctx, event, order, { amountPaise, customer, returnUrl }) {
  const { db, adapters } = ctx;
  const balance = order.total_paise - order.paid_paise;
  if (['cancelled', 'refunded'].includes(order.status)) fail(409, 'This order is closed');
  if (balance <= 0) fail(409, 'This order is already paid');
  const amount = Math.min(balance, amountPaise || balance);
  if (!Number.isInteger(amount) || amount <= 0) fail(400, 'Amount is invalid');
  const id = db.insert('payments', {
    event_id: event.id,
    order_id: order.id,
    provider: adapters.payments.name,
    intent_id: `pi_${randomToken(18)}`,
    amount_paise: amount,
    status: 'created',
    status_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  const payment = db.get('SELECT * FROM payments WHERE id = ?', id);
  const out = await adapters.payments.createCheckout({
    payment,
    order,
    description: `${event.name} order ${order.number}`,
    customer,
    returnUrl,
  });
  if (out.providerRef) db.update('payments', id, { provider_ref: out.providerRef });
  return { url: out.url, intentId: payment.intent_id, amountPaise: amount };
}

// ---------- applying provider events ----------
// A payment only ever moves up this ladder. "failed" and "pending" share a rung: either can
// follow the other, decided by the provider's own timestamp.
const RANK = { created: 0, pending: 1, failed: 1, captured: 2, refunded: 3 };
const TYPE_TO_STATUS = {
  'payment.pending': 'pending',
  'payment.captured': 'captured',
  'payment.failed': 'failed',
};

// Assigns the GST invoice number the first time money is captured against an order.
function ensureInvoice(db, event, order) {
  if (order.invoice_no) return;
  const profile = json(
    db.value('SELECT invoice_profile FROM organisers WHERE id = ?', event.organiser_id),
    {},
  );
  const n = nextCounter(db, event.id, 'invoice');
  db.update('orders', order.id, {
    invoice_no: `${profile.invoicePrefix || 'INV'}/${String(n).padStart(4, '0')}`,
    invoiced_at: nowIso(),
  });
}

// Applies the effects of captured money to whatever the order was for.
function onCaptured(ctx, event, order, amountPaise) {
  const { db } = ctx;
  const paid = order.paid_paise + amountPaise;
  db.update('orders', order.id, {
    paid_paise: paid,
    status: paid >= order.total_paise ? 'paid' : 'part_paid',
    updated_at: nowIso(),
  });
  ensureInvoice(db, event, order);
  const fresh = db.get('SELECT * FROM orders WHERE id = ?', order.id);
  if (order.registration_id && fresh.status === 'paid') {
    db.run(
      "UPDATE registrations SET payment_status = 'paid', updated_at = ? WHERE id = ? AND payment_status != 'refunded'",
      nowIso(),
      order.registration_id,
    );
    advance(ctx, event, order.registration_id);
  }
  // Any payment on a booth order (the deposit) turns a held booth into a confirmed one.
  if (order.booth_assignment_id) confirmAssignment(ctx, null, event, order.booth_assignment_id, { quiet: true });
  const to = order.registration_id
    ? db.value('SELECT email FROM registrations WHERE id = ?', order.registration_id)
    : db.value('SELECT contact_email FROM exhibitors WHERE id = ?', order.exhibitor_id);
  if (to) mail.receipt(ctx, event, to, fresh, amountPaise);
}

function onRefunded(ctx, event, order, payment, amountPaise) {
  const { db } = ctx;
  const refunded = payment.refunded_paise + amountPaise;
  db.update('payments', payment.id, {
    refunded_paise: refunded,
    status: refunded >= payment.amount_paise ? 'refunded' : 'captured',
    status_at: nowIso(),
    updated_at: nowIso(),
  });
  const orderRefunded = order.refunded_paise + amountPaise;
  const full = orderRefunded >= order.paid_paise;
  db.update('orders', order.id, {
    refunded_paise: orderRefunded,
    status: full ? 'refunded' : order.status,
    updated_at: nowIso(),
  });
  if (order.registration_id && full) {
    db.run(
      "UPDATE registrations SET payment_status = 'refunded', updated_at = ? WHERE id = ?",
      nowIso(),
      order.registration_id,
    );
    const pass = db.get('SELECT id FROM passes WHERE registration_id = ?', order.registration_id);
    if (pass) revokePass(db, pass.id, 'Payment refunded');
  }
}

// Applies one normalised provider event. Returns { outcome, payment } where outcome is
//   applied   - the payment changed
//   duplicate - this provider event id was seen before; nothing changed
//   stale     - an older or lower state than the payment already has; nothing changed
//   ignored   - unknown payment, unknown type, or an amount that does not match
export function applyPaymentEvent(ctx, provider, evt) {
  const { db } = ctx;
  return db.tx(() => {
    const payment = evt.intentId
      ? db.get('SELECT * FROM payments WHERE intent_id = ?', evt.intentId)
      : null;
    const log = (outcome) => {
      db.insert('payment_events', {
        provider,
        provider_event_id: evt.eventId,
        payment_id: payment?.id ?? null,
        type: evt.type,
        occurred_at: evt.occurredAt,
        outcome,
        payload: JSON.stringify(evt),
        received_at: nowIso(),
      });
      return { outcome, payment: payment ? db.get('SELECT * FROM payments WHERE id = ?', payment.id) : null };
    };
    if (db.value('SELECT 1 FROM payment_events WHERE provider = ? AND provider_event_id = ?', provider, evt.eventId))
      return { outcome: 'duplicate', payment };
    if (!payment || payment.provider !== provider) return log('ignored');
    const event = db.get('SELECT * FROM events WHERE id = ?', payment.event_id);
    const order = db.get('SELECT * FROM orders WHERE id = ?', payment.order_id);

    if (evt.type === 'refund.processed') {
      const room = payment.amount_paise - payment.refunded_paise;
      if (!['captured', 'refunded'].includes(payment.status) || evt.amountPaise <= 0 || evt.amountPaise > room)
        return log('ignored');
      onRefunded(ctx, event, order, payment, evt.amountPaise);
      return log('applied');
    }
    const next = TYPE_TO_STATUS[evt.type];
    if (!next) return log('ignored');
    const older = payment.status_at && evt.occurredAt < payment.status_at;
    if (RANK[next] < RANK[payment.status] || next === payment.status || (RANK[next] === RANK[payment.status] && older))
      return log('stale');
    // Money that does not match the intent is never applied automatically; finance reviews it.
    if (next === 'captured' && evt.amountPaise !== payment.amount_paise) {
      db.update('payments', payment.id, {
        note: `Provider reported ${inr(evt.amountPaise)}, expected ${inr(payment.amount_paise)}. Needs manual reconciliation.`,
        updated_at: nowIso(),
      });
      return log('ignored');
    }
    db.update('payments', payment.id, {
      status: next,
      status_at: evt.occurredAt,
      method: evt.method || payment.method,
      updated_at: nowIso(),
    });
    if (next === 'captured') onCaptured(ctx, event, order, payment.amount_paise);
    else if (order.registration_id && order.status === 'open')
      db.run(
        "UPDATE registrations SET payment_status = ?, updated_at = ? WHERE id = ? AND payment_status IN ('pending','failed')",
        next === 'failed' ? 'failed' : 'pending',
        nowIso(),
        order.registration_id,
      );
    return log('applied');
  });
}

// Handles a raw provider callback: verify the signature, normalise, apply.
export function handleWebhook(ctx, provider, rawBody, headers) {
  const adapter = ctx.adapters.payments;
  if (adapter.name !== provider) fail(404, 'Unknown payment provider');
  const evt = adapter.parseWebhook(rawBody, headers);
  if (!evt.eventId || !evt.occurredAt) fail(400, 'Malformed payment event');
  try {
    return applyPaymentEvent(ctx, provider, evt);
  } catch (e) {
    // Two deliveries of one event racing each other: the loser is a duplicate.
    if (isUniqueViolation(e)) return { outcome: 'duplicate', payment: null };
    throw e;
  }
}

// ---------- finance actions ----------
// Records money received outside the gateway (bank transfer, cheque) against an order.
export function recordManualPayment(ctx, req, event, order, { amountPaise, method, note }) {
  const { db } = ctx;
  return db.tx(() => {
    const fresh = db.get('SELECT * FROM orders WHERE id = ?', order.id);
    const balance = fresh.total_paise - fresh.paid_paise;
    if (['cancelled', 'refunded'].includes(fresh.status)) fail(409, 'This order is closed');
    if (amountPaise <= 0 || amountPaise > balance) fail(400, `Amount must be between ₹1 and ${inr(balance)}`);
    const id = db.insert('payments', {
      event_id: event.id,
      order_id: order.id,
      provider: 'manual',
      intent_id: `manual_${randomToken(12)}`,
      amount_paise: amountPaise,
      method,
      status: 'captured',
      status_at: nowIso(),
      note,
      reconciled_by: req.user.id,
      reconciled_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    onCaptured(ctx, event, fresh, amountPaise);
    audit(db, req, 'finance.manual_payment', {
      event,
      entity: 'order',
      entityId: order.id,
      detail: { order: order.number, amount: inr(amountPaise), method, note },
    });
    return db.get('SELECT * FROM payments WHERE id = ?', id);
  });
}

// Finance settles a payment the gateway left pending, after checking the provider's own
// record. Goes through the same state machine, with a synthetic event id, and is audited.
export function reconcilePayment(ctx, req, event, payment, { status, note }) {
  const { db } = ctx;
  if (!['created', 'pending', 'failed'].includes(payment.status))
    fail(409, 'Only an unsettled payment can be reconciled by hand');
  const out = applyPaymentEvent(ctx, payment.provider, {
    eventId: `manual:${payment.id}:${status}:${Date.now()}`,
    type: status === 'captured' ? 'payment.captured' : 'payment.failed',
    intentId: payment.intent_id,
    amountPaise: payment.amount_paise,
    method: payment.method,
    occurredAt: nowIso(),
  });
  db.update('payments', payment.id, { reconciled_by: req.user.id, reconciled_at: nowIso(), note });
  audit(db, req, 'finance.reconcile', {
    event,
    entity: 'payment',
    entityId: payment.id,
    detail: { intent: payment.intent_id, status, note, outcome: out.outcome },
  });
  return out;
}

export function recordRefund(ctx, req, event, payment, { amountPaise, note }) {
  const { db } = ctx;
  const out = applyPaymentEvent(ctx, payment.provider, {
    eventId: `manual-refund:${payment.id}:${Date.now()}`,
    type: 'refund.processed',
    intentId: payment.intent_id,
    amountPaise,
    occurredAt: nowIso(),
  });
  if (out.outcome !== 'applied') fail(400, 'Refund amount is more than was captured on this payment');
  audit(db, req, 'finance.refund', {
    event,
    entity: 'payment',
    entityId: payment.id,
    detail: { intent: payment.intent_id, amount: inr(amountPaise), note },
  });
  return out;
}

// The reconciliation report: what was billed, what was captured, and every record where the
// money state and the entitlement state disagree.
export function reconciliation(db, event) {
  const one = (sql, ...p) => db.value(sql, event.id, ...p) || 0;
  const issues = [];
  for (const o of db.all(
    `SELECT o.id, o.number, o.paid_paise,
            COALESCE((SELECT SUM(amount_paise) FROM payments WHERE order_id = o.id AND status IN ('captured','refunded')), 0) AS captured
     FROM orders o WHERE o.event_id = ?`,
    event.id,
  ))
    if (o.paid_paise !== o.captured)
      issues.push({ kind: 'order_mismatch', orderId: o.id, text: `Order ${o.number} shows ${inr(o.paid_paise)} paid but payments total ${inr(o.captured)}` });
  for (const r of db.all(
    `SELECT r.id, r.ref FROM registrations r WHERE r.event_id = ? AND r.status = 'confirmed' AND r.payment_status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM passes p WHERE p.registration_id = r.id AND p.status = 'active')`,
    event.id,
  ))
    issues.push({ kind: 'paid_no_pass', registrationId: r.id, text: `${r.ref} is paid but has no active pass` });
  for (const r of db.all(
    `SELECT r.id, r.ref FROM registrations r JOIN passes p ON p.registration_id = r.id AND p.status = 'active'
     WHERE r.event_id = ? AND r.payment_status IN ('pending','failed','refunded')`,
    event.id,
  ))
    issues.push({ kind: 'pass_unpaid', registrationId: r.id, text: `${r.ref} has an active pass but payment is not settled` });
  for (const r of db.all(
    "SELECT id, ref FROM registrations WHERE event_id = ? AND status = 'cancelled' AND payment_status = 'paid'",
    event.id,
  ))
    issues.push({ kind: 'refund_due', registrationId: r.id, text: `${r.ref} was cancelled after paying; refund due` });
  const stuck = new Date(Date.now() - 30 * 60000).toISOString();
  for (const p of db.all(
    "SELECT p.id, p.intent_id, o.number FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.event_id = ? AND p.status IN ('created','pending') AND p.created_at < ? AND o.status IN ('open','part_paid')",
    event.id,
    stuck,
  ))
    issues.push({ kind: 'payment_pending', paymentId: p.id, text: `Payment for order ${p.number} has been pending for over 30 minutes` });
  for (const p of db.all(
    "SELECT id, note FROM payments WHERE event_id = ? AND note LIKE '%Needs manual reconciliation%' AND status != 'captured'",
    event.id,
  ))
    issues.push({ kind: 'amount_mismatch', paymentId: p.id, text: p.note });
  return {
    billedPaise: one("SELECT SUM(total_paise) FROM orders WHERE event_id = ? AND status != 'cancelled'"),
    capturedPaise: one("SELECT SUM(amount_paise) FROM payments WHERE event_id = ? AND status IN ('captured','refunded')"),
    refundedPaise: one('SELECT SUM(refunded_paise) FROM payments WHERE event_id = ?'),
    outstandingPaise: one("SELECT SUM(total_paise - paid_paise) FROM orders WHERE event_id = ? AND status IN ('open','part_paid')"),
    pendingPaise: one("SELECT SUM(amount_paise) FROM payments WHERE event_id = ? AND status = 'pending'"),
    gstPaise: one("SELECT SUM(gst_paise) FROM orders WHERE event_id = ? AND status IN ('paid','part_paid')"),
    callbacks: Object.fromEntries(
      db
        .all(
          `SELECT e.outcome, COUNT(*) AS n FROM payment_events e JOIN payments p ON p.id = e.payment_id
           WHERE p.event_id = ? GROUP BY e.outcome`,
          event.id,
        )
        .map((r) => [r.outcome, r.n]),
    ),
    issues,
  };
}

// Data for a GST tax invoice: seller profile, buyer, lines and the tax split. Supplies within
// the seller's state carry CGST + SGST; other supplies carry IGST. The profile itself is set
// by finance in the console.
export function invoiceData(db, event, order) {
  const profile = json(db.value('SELECT invoice_profile FROM organisers WHERE id = ?', event.organiser_id), {});
  const ex = order.exhibitor_id ? db.get('SELECT * FROM exhibitors WHERE id = ?', order.exhibitor_id) : null;
  const reg = order.registration_id ? db.get('SELECT * FROM registrations WHERE id = ?', order.registration_id) : null;
  const buyerState = ex?.gstin ? ex.gstin.slice(0, 2) : profile.stateCode;
  const intraState = !profile.stateCode || buyerState === profile.stateCode;
  return {
    order: orderView(db, order),
    invoiceNo: order.invoice_no,
    invoicedAt: order.invoiced_at,
    seller: profile,
    buyer: ex
      ? { name: ex.billing_name || ex.company_name, gstin: ex.gstin, address: ex.billing_address }
      : { name: reg?.name, company: reg?.company, gstin: null, address: null },
    event: { name: event.name, venue: event.venue_name, city: event.city },
    tax: intraState
      ? { cgstPaise: Math.floor(order.gst_paise / 2), sgstPaise: order.gst_paise - Math.floor(order.gst_paise / 2), igstPaise: 0 }
      : { cgstPaise: 0, sgstPaise: 0, igstPaise: order.gst_paise },
  };
}
