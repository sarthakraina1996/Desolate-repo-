// Password hashing (scrypt) and cookie sessions stored in SQLite.
import crypto from 'node:crypto';
import { fail, fullName } from './core.js';

const COOKIE = 'hrms_session';
const SESSION_DAYS = 7;

// Hashes a password with a random salt as "scrypt$salt$hash".
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Checks a password against a stored hash in constant time.
export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Rejects passwords shorter than 8 characters or without both letters and digits.
export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) fail(400, 'Password must be at least 8 characters');
  if (pw.length > 200) fail(400, 'Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw))
    fail(400, 'Password must contain letters and numbers');
}

// Random temporary password that always passes the strength check.
export function tempPassword() {
  return `Hr${crypto.randomBytes(6).toString('base64url')}9`;
}

// Session tokens are stored hashed so a leaked database can't be used to sign in.
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Parses a Cookie header into a name -> value map.
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Cookie attributes; adds Secure on HTTPS or when COOKIE_SECURE=true.
export function cookieOptions(req) {
  const secure = process.env.COOKIE_SECURE === 'true' || req.secure;
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

// Adds a cookie to the response without replacing ones already set (session + device).
export function addCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
}

// Starts a session, sets its cookie and prunes expired ones. expiresAt (ISO) shortens it,
// e.g. to midnight for people whose sign-in depends on being in the office that day.
export function createSession(db, req, res, userId, { expiresAt = null } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const max = Date.now() + SESSION_DAYS * 86400000;
  const until = expiresAt && Date.parse(expiresAt) < max ? Date.parse(expiresAt) : max;
  db.run(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    sha256(token),
    userId,
    new Date(until).toISOString(),
  );
  db.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
  addCookie(
    res,
    `${COOKIE}=${token}; ${cookieOptions(req)}; Max-Age=${Math.max(60, Math.round((until - Date.now()) / 1000))}`,
  );
}

// Signs out: deletes the session row and clears the cookie.
export function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  addCookie(res, `${COOKIE}=; ${cookieOptions(req)}; Max-Age=0`);
}

// Builds the req.user object for an active login, joined with its employee record.
export function loadUser(db, userId) {
  const row = db.get(
    `
    SELECT u.id, u.email, u.role, u.employee_id, u.must_change_password, u.active,
           e.first_name, e.last_name, e.designation, e.photo, e.code, e.gender
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = ?`,
    userId,
  );
  if (!row || !row.active) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    employeeId: row.employee_id,
    name: row.first_name ? fullName(row) : row.email,
    firstName: row.first_name || row.email.split('@')[0],
    designation:
      row.designation ||
      { admin: 'Administrator', hr: 'HR', manager: 'Manager', employee: 'Employee' }[row.role],
    hasPhoto: Boolean(row.photo),
    code: row.code,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

// Attaches req.user when a valid session cookie is present, and req.sessionKey (the token's
// hash) so short-lived approvals like a fingerprint check can be tied to this one sign-in.
export function sessionMiddleware(db) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const key = sha256(token);
      const s = db.get('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', key);
      if (s && s.expires_at > new Date().toISOString()) {
        req.user = loadUser(db, s.user_id);
        if (req.user) req.sessionKey = key;
      }
    }
    next();
  };
}

// Simple in-memory brute-force guard for the login endpoint.
// Allows 8 failures per key in a 15-minute window; returns callbacks to record the outcome.
const attempts = new Map();
export function loginThrottle(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, first: now };
  if (now - rec.first > 15 * 60000) {
    rec.count = 0;
    rec.first = now;
  }
  if (rec.count >= 8) fail(429, 'Too many login attempts. Try again in 15 minutes.');
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
