// Visitor registration: free, paid, invited and approval-based passes.
// Review state (status), money state (payment_status) and admission are kept independent;
// a pass is issued only when the registration is confirmed AND nothing is owed.
import { json } from '../db.js';
import {
  audit,
  bool,
  email as vEmail,
  eventSettings,
  fail,
  gstOn,
  inr,
  nowIso,
  oneOf,
  phone as vPhone,
  randomRef,
  randomToken,
  sha256,
  str,
} from '../core.js';
import { consumeOtp, findOrCreateUser, issueOtp } from '../auth.js';
import { issuePass, passView, revokePass } from './passes.js';
import { createOrder, orderToken, orderView } from './payments.js';
import { mail } from './mail.js';

const PUBLIC_MODES = ['free', 'paid', 'invited', 'approval'];

// Pass types a member of the public can register for, with live availability.
export function publicPassClasses(db, event) {
  return db
    .all(
      `SELECT * FROM pass_classes WHERE event_id = ? AND active = 1 AND mode != 'internal' ORDER BY sort, id`,
      event.id,
    )
    .map((c) => {
      const taken = c.capacity
        ? db.value(
            "SELECT COUNT(*) FROM registrations WHERE pass_class_id = ? AND status NOT IN ('cancelled','rejected')",
            c.id,
          )
        : 0;
      const gst = gstOn(c.price_paise, c.gst_percent);
      return {
        code: c.code,
        name: c.name,
        kind: c.kind,
        mode: c.mode,
        description: c.description,
        pricePaise: c.price_paise,
        gstPaise: gst,
        totalPaise: c.price_paise + gst,
        priceLabel: c.price_paise ? `${inr(c.price_paise + gst)} incl. GST` : 'Free',
        validFrom: c.valid_from,
        validTo: c.valid_to,
        soldOut: Boolean(c.capacity) && taken >= c.capacity,
      };
    });
}

export const formFields = (db, eventId) =>
  db
    .all('SELECT * FROM form_fields WHERE event_id = ? AND active = 1 ORDER BY sort, id', eventId)
    .map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      options: json(f.options, []),
      required: Boolean(f.required),
    }));

// Validates the organiser's configurable questions and returns the cleaned answers.
function readAnswers(db, eventId, input = {}) {
  const out = {};
  for (const f of formFields(db, eventId)) {
    const raw = input[f.key];
    if (f.type === 'checkbox') {
      out[f.key] = bool(raw);
      if (f.required && !out[f.key]) fail(400, `Tick "${f.label}" to continue`);
    } else if (f.type === 'select') {
      const v = oneOf(raw, f.options, { required: f.required, name: f.label });
      if (v) out[f.key] = v;
    } else {
      const v = str(raw, { max: 300, required: f.required, name: f.label });
      if (v) out[f.key] = v;
    }
  }
  return out;
}

// Step 1 of registering: store the details and email a code that proves the address is theirs.
// If this email already has a live registration for the pass type, nothing new is created and
// the answer looks the same; the code then leads the real owner back to that registration.
export function createRegistration(ctx, event, body, { source = 'web' } = {}) {
  const { db } = ctx;
  if (event.status !== 'published') fail(409, 'Registration is not open for this event');
  const cls = db.get(
    'SELECT * FROM pass_classes WHERE event_id = ? AND code = ? AND active = 1',
    event.id,
    str(body.passClass, { required: true, name: 'Pass type' }),
  );
  if (!cls || !PUBLIC_MODES.includes(cls.mode)) fail(400, 'That pass type is not available');
  const row = {
    name: str(body.name, { max: 120, required: true, name: 'Full name' }),
    email: vEmail(body.email, { required: true, name: 'Work email' }),
    phone: vPhone(body.phone, { name: 'Mobile number' }),
    company: str(body.company, { max: 160, name: 'Company' }),
    job_title: str(body.jobTitle, { max: 120, name: 'Job title' }),
  };
  if (!bool(body.consent)) fail(400, 'Accept the privacy notice to register');
  const answers = readAnswers(db, event.id, body.answers);

  return db.tx(() => {
    const existing = db.get(
      "SELECT * FROM registrations WHERE event_id = ? AND email = ? AND pass_class_id = ? AND status NOT IN ('cancelled','rejected')",
      event.id,
      row.email,
      cls.id,
    );
    let reg = existing;
    if (existing && existing.status === 'unverified') {
      // Never verified: let the person correct their details and try again.
      db.update('registrations', existing.id, {
        ...row,
        answers: JSON.stringify(answers),
        updated_at: nowIso(),
      });
      reg = db.get('SELECT * FROM registrations WHERE id = ?', existing.id);
    } else if (!existing) {
      let invite = null;
      if (cls.mode === 'invited') {
        invite = db.get(
          'SELECT * FROM invites WHERE event_id = ? AND pass_class_id = ? AND code = ?',
          event.id,
          cls.id,
          str(body.inviteCode, { required: true, name: 'Invitation code' }).toUpperCase(),
        );
        const dead =
          !invite ||
          invite.used_count >= invite.max_uses ||
          (invite.expires_at && invite.expires_at < nowIso()) ||
          (invite.email && invite.email.toLowerCase() !== row.email);
        if (dead) fail(400, 'That invitation code is not valid for this email address');
      }
      if (cls.capacity) {
        const taken = db.value(
          "SELECT COUNT(*) FROM registrations WHERE pass_class_id = ? AND status NOT IN ('cancelled','rejected')",
          cls.id,
        );
        if (taken >= cls.capacity) fail(409, `${cls.name} passes are fully booked`, 'sold_out');
      }
      const id = db.insert('registrations', {
        event_id: event.id,
        pass_class_id: cls.id,
        ref: randomRef(eventSettings(event).refPrefix || 'REG'),
        ...row,
        answers: JSON.stringify(answers),
        source,
        invite_id: invite?.id ?? null,
        consent_at: nowIso(),
        lead_opt_out: bool(body.leadOptOut),
        whatsapp_opt_in: bool(body.whatsappOptIn),
        updated_at: nowIso(),
        created_at: nowIso(),
      });
      reg = db.get('SELECT * FROM registrations WHERE id = ?', id);
    }
    const code = issueOtp(db, { email: reg.email, purpose: 'registration', ref: reg.ref });
    mail.registrationCode(ctx, event, reg, code);
    return { ref: reg.ref, email: reg.email, code };
  });
}

// Moves a registration forward as far as its states allow and issues the pass when it is both
// confirmed and settled. Safe to call any number of times. Returns the pass, if one exists.
export function advance(ctx, event, regId, { notify = true } = {}) {
  const { db } = ctx;
  return db.tx(() => {
    const reg = db.get('SELECT * FROM registrations WHERE id = ?', regId);
    const settled = reg.payment_status === 'not_required' || reg.payment_status === 'paid';
    if (reg.status !== 'confirmed' || !settled) return null;
    const had = db.get(
      "SELECT id FROM passes WHERE registration_id = ? AND status = 'active'",
      reg.id,
    );
    const pass = issuePass(db, {
      event,
      passClassId: reg.pass_class_id,
      registrationId: reg.id,
      name: reg.name,
      company: reg.company,
    });
    if (!had && notify) mail.passReady(ctx, event, reg, rotateAccess(db, reg));
    return pass;
  });
}

// Replaces the pass retrieval token. Only its hash is stored; earlier links stop working.
export function rotateAccess(db, reg) {
  const token = randomToken(24);
  db.update('registrations', reg.id, { access_hash: sha256(token), updated_at: nowIso() });
  return token;
}

// Step 2: the code proves the email. The registration then moves to review, payment or pass.
export function verifyRegistration(ctx, event, { ref, code }) {
  const { db } = ctx;
  return db.tx(() => {
    const reg = db.get('SELECT * FROM registrations WHERE ref = ? AND event_id = ?', ref, event.id);
    if (!reg) fail(404, 'Registration not found');
    consumeOtp(db, { email: reg.email, purpose: 'registration', ref: reg.ref, code });
    const userId = findOrCreateUser(db, { email: reg.email, name: reg.name, phone: reg.phone });
    const patch = { user_id: userId, updated_at: nowIso() };
    let fresh = false;
    if (reg.status === 'unverified') {
      fresh = true;
      const cls = db.get('SELECT * FROM pass_classes WHERE id = ?', reg.pass_class_id);
      patch.contact_verified_at = nowIso();
      patch.status = cls.mode === 'approval' ? 'pending_review' : 'confirmed';
      // Approval-based paid passes are charged only once approved.
      patch.payment_status = cls.price_paise > 0 && cls.mode !== 'approval' ? 'pending' : 'not_required';
      if (reg.invite_id)
        db.run('UPDATE invites SET used_count = used_count + 1 WHERE id = ?', reg.invite_id);
    }
    db.update('registrations', reg.id, patch);
    let current = db.get('SELECT * FROM registrations WHERE id = ?', reg.id);
    const token = rotateAccess(db, current);
    if (fresh) {
      if (current.payment_status === 'pending') {
        const order = ensureRegistrationOrder(ctx, event, current);
        mail.paymentDue(ctx, event, current, order, token);
      } else if (current.status === 'pending_review') mail.underReview(ctx, event, current);
      else {
        advance(ctx, event, current.id, { notify: false });
        mail.passReady(ctx, event, current, token);
      }
    }
    current = db.get('SELECT * FROM registrations WHERE id = ?', reg.id);
    return { userId, token, registration: current };
  });
}

// The order for a paid registration; created once and reused.
export function ensureRegistrationOrder(ctx, event, reg) {
  const { db } = ctx;
  const existing = db.get(
    "SELECT * FROM orders WHERE registration_id = ? AND status != 'cancelled' ORDER BY id LIMIT 1",
    reg.id,
  );
  if (existing) return existing;
  const cls = db.get('SELECT * FROM pass_classes WHERE id = ?', reg.pass_class_id);
  return createOrder(ctx, event, {
    kind: 'registration',
    registrationId: reg.id,
    items: [
      {
        description: `${cls.name} pass, ${event.name}`,
        qty: 1,
        unitPaise: cls.price_paise,
        gstPercent: cls.gst_percent,
      },
    ],
  });
}

// What the owner of a registration sees: where it stands and the one thing to do next.
export function registrationState(ctx, event, reg) {
  const { db } = ctx;
  const cls = db.get('SELECT * FROM pass_classes WHERE id = ?', reg.pass_class_id);
  const pass = db.get('SELECT * FROM passes WHERE registration_id = ?', reg.id);
  const order = db.get(
    "SELECT * FROM orders WHERE registration_id = ? AND status != 'cancelled' ORDER BY id LIMIT 1",
    reg.id,
  );
  let step = 'pass';
  if (reg.status === 'cancelled') step = 'cancelled';
  else if (reg.status === 'rejected') step = 'rejected';
  else if (reg.status === 'unverified') step = 'verify';
  else if (reg.status === 'pending_review') step = 'review';
  else if (reg.payment_status === 'pending' || reg.payment_status === 'failed') step = 'payment';
  else if (reg.payment_status === 'refunded') step = 'cancelled';
  return {
    id: reg.id,
    ref: reg.ref,
    name: reg.name,
    email: reg.email,
    company: reg.company,
    jobTitle: reg.job_title,
    status: reg.status,
    paymentStatus: reg.payment_status,
    step,
    reviewNote: reg.review_note,
    passClass: { code: cls.code, name: cls.name, kind: cls.kind, mode: cls.mode },
    pass: pass && step === 'pass' ? passView(db, event, pass) : null,
    order:
      order && step === 'payment'
        ? { ...orderView(db, order), token: orderToken(ctx, order) }
        : null,
    createdAt: reg.created_at,
    event: { slug: event.slug, name: event.name },
  };
}

// Organiser decision on an approval-based registration.
export function decideRegistration(ctx, req, event, reg, decision, note) {
  const { db } = ctx;
  if (reg.status !== 'pending_review') fail(409, 'This registration is not waiting for review');
  return db.tx(() => {
    const cls = db.get('SELECT * FROM pass_classes WHERE id = ?', reg.pass_class_id);
    const approved = decision === 'approve';
    db.update('registrations', reg.id, {
      status: approved ? 'confirmed' : 'rejected',
      payment_status: approved && cls.price_paise > 0 ? 'pending' : reg.payment_status,
      review_note: note || null,
      decided_by: req.user.id,
      decided_at: nowIso(),
      updated_at: nowIso(),
    });
    const current = db.get('SELECT * FROM registrations WHERE id = ?', reg.id);
    audit(db, req, approved ? 'registration.approve' : 'registration.reject', {
      event,
      entity: 'registration',
      entityId: reg.id,
      detail: { ref: reg.ref, note: note || undefined },
    });
    if (!approved) mail.rejected(ctx, event, current);
    else if (current.payment_status === 'pending') {
      const order = ensureRegistrationOrder(ctx, event, current);
      mail.paymentDue(ctx, event, current, order, rotateAccess(db, current));
    } else advance(ctx, event, current.id);
    return db.get('SELECT * FROM registrations WHERE id = ?', reg.id);
  });
}

// Cancels a registration and revokes its pass. Money already paid stays "paid" until finance
// records the refund, so the refund queue shows it.
export function cancelRegistration(ctx, req, event, reg, { by }) {
  const { db } = ctx;
  if (reg.status === 'cancelled') return reg;
  return db.tx(() => {
    db.update('registrations', reg.id, {
      status: 'cancelled',
      cancelled_at: nowIso(),
      updated_at: nowIso(),
    });
    const pass = db.get('SELECT * FROM passes WHERE registration_id = ?', reg.id);
    if (pass) revokePass(db, pass.id, 'Registration cancelled');
    db.run(
      "UPDATE orders SET status = 'cancelled', updated_at = ? WHERE registration_id = ? AND status = 'open'",
      nowIso(),
      reg.id,
    );
    audit(db, req, 'registration.cancel', {
      event,
      entity: 'registration',
      entityId: reg.id,
      detail: { ref: reg.ref, by },
    });
    const current = db.get('SELECT * FROM registrations WHERE id = ?', reg.id);
    mail.cancelled(ctx, event, current);
    return current;
  });
}

// Finds a registration from a pass retrieval token.
export function registrationByToken(db, token) {
  if (!token || String(token).length < 20) return null;
  return db.get('SELECT * FROM registrations WHERE access_hash = ?', sha256(token)) || null;
}
