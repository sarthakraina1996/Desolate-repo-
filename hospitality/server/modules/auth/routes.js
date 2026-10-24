// Sign-in, MFA (TOTP), sign-out, password change and the current-user profile.
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { fail } from '../../core/errors.js';
import { email as vEmail, str } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { newSecret, otpauthUri, verifyTotp } from '../../core/totp.js';
import { propertyIds } from '../../core/access.js';
import { ROLES } from '../../core/permissions.js';
import {
  checkPasswordStrength,
  createSession,
  destroySession,
  hashPassword,
  loadUser,
  loginThrottle,
  sha256,
  verifyPassword,
} from './service.js';

// Properties the user can open, for the top-bar property selector.
export function userProperties(db, user) {
  const ids = propertyIds(db, user);
  if (!ids.length) return [];
  return db.all(
    `SELECT id, code, name, city, country, currency, timezone, business_date, category, locale
     FROM properties WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    ...ids,
  );
}

const profile = (db, user) => ({ user, properties: userProperties(db, user) });

// Public routes (no session needed).
export function publicAuthRoutes(r, { db }) {
  // Demo logins are listed only while the organisation is a demo.
  r.get('/auth/config', (_req, res) => {
    const demo = db.value('SELECT COUNT(*) FROM organizations WHERE is_demo = 1') > 0;
    res.json({
      demo,
      demoAccounts: demo
        ? db.all(
            `SELECT u.email, u.name, u.title, u.role FROM users u JOIN organizations o ON o.id = u.org_id
             WHERE o.is_demo = 1 AND u.active = 1 ORDER BY u.id`,
          )
        : [],
    });
  });

  r.post('/auth/login', (req, res) => {
    const email = vEmail(req.body?.email, { required: true });
    const password = String(req.body?.password || '');
    const throttle = loginThrottle(email);
    const u = db.get('SELECT * FROM users WHERE email = ? AND active = 1', email);
    if (!u || !verifyPassword(password, u.password_hash)) {
      throttle.failed();
      fail(401, 'Email or password is incorrect', { code: 'bad_credentials' });
    }
    throttle.succeeded();
    if (u.mfa_enabled) {
      // Password is right; the session starts only after the authenticator code.
      const token = crypto.randomBytes(24).toString('hex');
      db.run(
        'INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
        sha256(token),
        u.id,
        new Date(Date.now() + 5 * 60000).toISOString(),
      );
      return res.json({ mfaRequired: true, challenge: token });
    }
    createSession(db, req, res, u.id);
    db.run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), u.id);
    const user = loadUser(db, u.id);
    audit(db, user, 'auth.login', { entity: 'user', entityId: u.id });
    res.json(profile(db, user));
  });

  r.post('/auth/mfa/verify', (req, res) => {
    const token = String(req.body?.challenge || '');
    const ch = db.get('SELECT * FROM mfa_challenges WHERE token_hash = ?', sha256(token));
    if (!ch || ch.expires_at < new Date().toISOString() || ch.attempts >= 5)
      fail(401, 'Sign-in expired. Enter your password again.', { code: 'mfa_expired' });
    const u = db.get('SELECT * FROM users WHERE id = ? AND active = 1', ch.user_id);
    if (!u || !verifyTotp(u.mfa_secret, req.body?.code)) {
      db.run('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = ?', ch.token_hash);
      fail(401, 'That code is not valid. Check the time on your phone and try again.', {
        code: 'mfa_invalid',
      });
    }
    db.run('DELETE FROM mfa_challenges WHERE token_hash = ?', ch.token_hash);
    createSession(db, req, res, u.id);
    db.run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), u.id);
    const user = loadUser(db, u.id);
    audit(db, user, 'auth.login', { entity: 'user', entityId: u.id, after: { mfa: true } });
    res.json(profile(db, user));
  });

  r.post('/auth/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });
}

// Routes for a signed-in user (still allowed while MFA enrolment is pending).
export function authRoutes(r, { db }) {
  r.get('/auth/me', (req, res) => res.json(profile(db, req.user)));

  r.post('/auth/password', (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(String(req.body?.current || ''), u.password_hash))
      fail(400, 'Current password is incorrect');
    checkPasswordStrength(req.body?.next);
    db.run(
      'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
      hashPassword(req.body.next),
      u.id,
    );
    audit(db, req.user, 'auth.password_changed', { entity: 'user', entityId: u.id });
    res.json({ ok: true });
  });

  // Starts MFA enrolment: a new secret (not active until confirmed) and its QR code.
  r.post('/auth/mfa/setup', async (req, res, next) => {
    try {
      const secret = newSecret();
      db.run('UPDATE users SET mfa_secret = ? WHERE id = ? AND mfa_enabled = 0', secret, req.user.id);
      if (req.user.mfaEnabled) fail(400, 'Two-step sign-in is already on');
      const uri = otpauthUri({ secret, account: req.user.email });
      res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/auth/mfa/enable', (req, res) => {
    const u = db.get('SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?', req.user.id);
    if (u.mfa_enabled) fail(400, 'Two-step sign-in is already on');
    if (!u.mfa_secret || !verifyTotp(u.mfa_secret, req.body?.code))
      fail(400, 'That code is not valid. Scan the QR code again and enter the new code.', {
        code: 'mfa_invalid',
      });
    db.run('UPDATE users SET mfa_enabled = 1 WHERE id = ?', req.user.id);
    audit(db, req.user, 'auth.mfa_enabled', { entity: 'user', entityId: req.user.id });
    res.json(profile(db, loadUser(db, req.user.id)));
  });

  r.post('/auth/mfa/disable', (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!u.mfa_enabled) fail(400, 'Two-step sign-in is not on');
    if (!verifyTotp(u.mfa_secret, req.body?.code)) fail(400, 'That code is not valid', { code: 'mfa_invalid' });
    const required = db.value('SELECT mfa_required_privileged FROM organizations WHERE id = ?', u.org_id);
    if (required && ROLES[u.role]?.privileged)
      fail(400, 'Your organisation requires two-step sign-in for your role');
    db.run('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?', u.id);
    audit(db, req.user, 'auth.mfa_disabled', { entity: 'user', entityId: u.id });
    res.json(profile(db, loadUser(db, u.id)));
  });

  r.put('/auth/profile', (req, res) => {
    const name = str(req.body?.name, { required: true, max: 120, name: 'Name' });
    db.run('UPDATE users SET name = ? WHERE id = ?', name, req.user.id);
    res.json(profile(db, loadUser(db, req.user.id)));
  });
}
