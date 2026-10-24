// Passwords (scrypt), cookie sessions stored hashed, login throttling and the req.user shape.
import crypto from 'node:crypto';
import { fail } from '../../core/errors.js';
import { ROLES, permissionsOf } from '../../core/permissions.js';

export const COOKIE = 'bhos_session';
const SESSION_HOURS = 12;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) fail(400, 'Password must be at least 10 characters');
  if (pw.length > 200) fail(400, 'Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) fail(400, 'Password must contain letters and numbers');
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieOptions(req) {
  const secure = process.env.COOKIE_SECURE === 'true' || req.secure;
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function createSession(db, req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const until = Date.now() + SESSION_HOURS * 3600000;
  db.run(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    sha256(token),
    userId,
    new Date(until).toISOString(),
  );
  db.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; ${cookieOptions(req)}; Max-Age=${SESSION_HOURS * 3600}`,
  );
}

export function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieOptions(req)}; Max-Age=0`);
}

// The signed-in user as every route sees it.
export function loadUser(db, userId) {
  const u = db.get(
    `SELECT u.*, o.name AS org_name, o.is_demo, o.mfa_required_privileged, o.reporting_currency,
            o.fy_start_month
     FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.id = ?`,
    userId,
  );
  if (!u || !u.active) return null;
  const role = ROLES[u.role];
  if (!role) return null;
  return {
    id: u.id,
    uid: u.uid,
    orgId: u.org_id,
    orgName: u.org_name,
    isDemo: Boolean(u.is_demo),
    reportingCurrency: u.reporting_currency,
    fyStartMonth: u.fy_start_month,
    email: u.email,
    name: u.name,
    title: u.title || role.label,
    role: u.role,
    roleLabel: role.label,
    allProperties: Boolean(u.all_properties),
    mfaEnabled: Boolean(u.mfa_enabled),
    // Organisation policy: privileged roles must enrol in MFA before using the system.
    mfaSetupRequired: Boolean(u.mfa_required_privileged && role.privileged && !u.mfa_enabled),
    mustChangePassword: Boolean(u.must_change_password),
    permissions: permissionsOf(u.role),
  };
}

export function sessionMiddleware(db) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const s = db.get('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', sha256(token));
      if (s && s.expires_at > new Date().toISOString()) req.user = loadUser(db, s.user_id);
    }
    next();
  };
}

// In-memory brute-force guard: 8 failures per key per 15 minutes.
const attempts = new Map();
export function loginThrottle(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, first: now };
  if (now - rec.first > 15 * 60000) {
    rec.count = 0;
    rec.first = now;
  }
  if (rec.count >= 8) fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  return {
    failed() {
      rec.count++;
      attempts.set(key, rec);
    },
    succeeded() {
      attempts.delete(key);
    },
  };
}
