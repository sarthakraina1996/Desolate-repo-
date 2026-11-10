// Sign-in (password or one-time email code), the signed-in user's roles, and their own
// passes, bookmarks and notification settings.
import { Router } from 'express';
import {
  EXHIBITOR_ROLES,
  GATE_ROLES,
  ORG_ROLES,
  ROLE_PERMS,
  email as vEmail,
  fail,
  id,
  memberships,
  nowIso,
  oneOf,
  requireUser,
  str,
  strList,
} from '../core.js';
import { consumeOtp, createSession, destroySession, findOrCreateUser, issueOtp, loginThrottle, verifyPassword } from '../auth.js';
import { passView } from '../services/passes.js';
import { cancelRegistration, registrationState } from '../services/registrations.js';
import { orderByToken, startCheckout } from '../services/payments.js';
import { mail } from '../services/mail.js';

export default function authRoutes(ctx) {
  const { db, adapters } = ctx;
  const r = Router();
  // The demo shows one-time codes on screen because the local email adapter delivers nothing.
  const showCodes = () => adapters.email.name === 'local' && process.env.DEMO_SHOW_CODES !== 'false';

  // Marks team invitations as accepted the first time the invited person signs in.
  const acceptInvites = (userId) =>
    db.run("UPDATE team_badges SET status = 'accepted', accepted_at = ? WHERE user_id = ? AND status = 'invited'", nowIso(), userId);

  r.get('/auth/config', (_req, res) => {
    res.json({
      demo: ctx.demo,
      showCodes: showCodes(),
      adapters: {
        email: adapters.email.label,
        payments: adapters.payments.label,
        printer: adapters.printer.label,
        push: adapters.push.label,
      },
    });
  });

  r.post('/auth/login', (req, res) => {
    const email = vEmail(req.body.email, { required: true });
    const throttle = loginThrottle(`${req.ip}:${email}`);
    const user = db.get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !user.active || !user.password_hash || !verifyPassword(req.body.password, user.password_hash)) {
      throttle.failed();
      fail(401, 'Email or password is not right');
    }
    throttle.succeeded();
    acceptInvites(user.id);
    res.json({ ...createSession(db, req, res, user.id), user: { id: user.id, email: user.email, name: user.name } });
  });

  // Emails a sign-in code. The answer is the same whether or not the address has an account.
  r.post('/auth/code', (req, res) => {
    const email = vEmail(req.body.email, { required: true });
    const code = issueOtp(db, { email, purpose: 'signin' });
    mail.signinCode(ctx, email, code);
    res.json({ ok: true, ...(showCodes() ? { demoCode: code } : {}) });
  });

  r.post('/auth/code/verify', (req, res) => {
    const email = vEmail(req.body.email, { required: true });
    consumeOtp(db, { email, purpose: 'signin', code: req.body.code });
    const userId = findOrCreateUser(db, { email, name: str(req.body.name, { max: 120 }) });
    const user = db.get('SELECT * FROM users WHERE id = ?', userId);
    if (!user.active) fail(403, 'This account has been disabled');
    // Registrations made with this email before the account existed now belong to it.
    db.run("UPDATE registrations SET user_id = ? WHERE email = ? AND user_id IS NULL AND status != 'unverified'", userId, email);
    acceptInvites(userId);
    res.json({ ...createSession(db, req, res, userId), user: { id: user.id, email: user.email, name: user.name } });
  });

  r.post('/auth/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  // Who am I and what can I do: drives each app's navigation. The server still checks every call.
  r.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    const mine = memberships(db, req);
    const events = new Map();
    const eventOf = (eid) => {
      if (!events.has(eid)) events.set(eid, db.get('SELECT id, slug, name, starts_on, ends_on, status FROM events WHERE id = ?', eid));
      return events.get(eid);
    };
    const organiser = [];
    for (const m of mine.filter((x) => ORG_ROLES.includes(x.role))) {
      const list = m.event_id
        ? [eventOf(m.event_id)]
        : db.all(
            'SELECT id, slug, name, starts_on, ends_on, status FROM events WHERE organiser_id = ? ORDER BY starts_on DESC',
            m.organiser_id,
          );
      for (const e of list)
        if (e && !organiser.some((o) => o.eventId === e.id))
          organiser.push({ eventId: e.id, slug: e.slug, name: e.name, status: e.status, role: m.role, perms: ROLE_PERMS[m.role] });
    }
    const gate = mine
      .filter((x) => GATE_ROLES.includes(x.role))
      .map((m) => ({ eventId: m.event_id, name: eventOf(m.event_id)?.name, role: m.role, gateId: m.gate_id }));
    const exhibitor = mine
      .filter((x) => EXHIBITOR_ROLES.includes(x.role))
      .map((m) => {
        const ex = db.get('SELECT id, company_name, status FROM exhibitors WHERE id = ?', m.exhibitor_id);
        const e = eventOf(m.event_id);
        return {
          exhibitorId: ex.id,
          companyName: ex.company_name,
          status: ex.status,
          role: m.role,
          eventId: e.id,
          slug: e.slug,
          eventName: e.name,
          perms: ROLE_PERMS[m.role],
        };
      });
    res.json({
      user: req.user,
      organiser,
      gate,
      exhibitor,
      registrations: db.value("SELECT COUNT(*) FROM registrations WHERE user_id = ? AND status != 'unverified'", req.user.id),
    });
  });

  // The signed-in person's registrations and passes, including exhibitor team badges.
  r.get('/me/passes', (req, res) => {
    const user = requireUser(req);
    const event = (eid) => db.get('SELECT * FROM events WHERE id = ?', eid);
    const registrations = db
      .all("SELECT * FROM registrations WHERE user_id = ? AND status != 'unverified' ORDER BY id DESC", user.id)
      .map((reg) => registrationState(ctx, event(reg.event_id), reg));
    const badges = db
      .all(
        `SELECT p.* FROM team_badges t JOIN passes p ON p.team_badge_id = t.id
         WHERE t.user_id = ? AND t.status != 'revoked' AND p.status = 'active'`,
        user.id,
      )
      .map((p) => passView(db, event(p.event_id), p));
    res.json({ registrations, badges, syncedAt: nowIso() });
  });

  const ownRegistration = (req) => {
    const user = requireUser(req);
    const reg = db.get('SELECT * FROM registrations WHERE id = ? AND user_id = ?', id(req.params.id), user.id);
    if (!reg) fail(404, 'Registration not found');
    return { reg, event: db.get('SELECT * FROM events WHERE id = ?', reg.event_id) };
  };

  r.post('/me/registrations/:id/cancel', (req, res) => {
    const { reg, event } = ownRegistration(req);
    res.json(registrationState(ctx, event, cancelRegistration(ctx, req, event, reg, { by: 'visitor' })));
  });

  // Starts the hosted checkout for a registration the user owns.
  r.post('/me/registrations/:id/checkout', async (req, res) => {
    const { reg, event } = ownRegistration(req);
    const state = registrationState(ctx, event, reg);
    if (!state.order) fail(409, 'Nothing is due on this registration');
    const order = orderByToken(ctx, state.order.token);
    res.json(
      await startCheckout(ctx, event, order, {
        customer: { name: reg.name, email: reg.email, phone: reg.phone },
        returnUrl: `${ctx.baseUrl}/account`,
      }),
    );
  });

  // Bookmarked agenda sessions.
  r.get('/me/bookmarks', (req, res) => {
    const user = requireUser(req);
    res.json(db.all('SELECT session_id FROM bookmarks WHERE user_id = ?', user.id).map((b) => b.session_id));
  });
  r.put('/me/bookmarks/:sessionId', (req, res) => {
    const user = requireUser(req);
    const sid = id(req.params.sessionId);
    if (!db.value('SELECT 1 FROM agenda_sessions WHERE id = ?', sid)) fail(404, 'Session not found');
    db.run('INSERT OR IGNORE INTO bookmarks (user_id, session_id, created_at) VALUES (?, ?, ?)', user.id, sid, nowIso());
    res.json({ ok: true });
  });
  r.delete('/me/bookmarks/:sessionId', (req, res) => {
    const user = requireUser(req);
    db.run('DELETE FROM bookmarks WHERE user_id = ? AND session_id = ?', user.id, id(req.params.sessionId));
    res.json({ ok: true });
  });

  // Opt in to (or out of) schedule and gate-change notifications on this phone.
  r.put('/me/push-token', (req, res) => {
    const user = requireUser(req);
    const platform = oneOf(req.body.platform, ['apns', 'fcm'], { required: true, name: 'Platform' });
    const token = str(req.body.token, { max: 400, required: true, name: 'Token' });
    const topics = strList(req.body.topics, { max: 4 }).filter((t) => ['schedule', 'gate'].includes(t));
    db.run(
      `INSERT INTO push_tokens (user_id, platform, token, topics, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (platform, token) DO UPDATE SET user_id = excluded.user_id, topics = excluded.topics, updated_at = excluded.updated_at`,
      user.id,
      platform,
      token,
      JSON.stringify(topics),
      nowIso(),
    );
    res.json({ ok: true, topics });
  });
  r.delete('/me/push-token', (req, res) => {
    const user = requireUser(req);
    db.run('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', user.id, String(req.body.token || ''));
    res.json({ ok: true });
  });

  return r;
}
