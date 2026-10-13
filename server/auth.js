// Password hashing (scrypt) and cookie sessions stored in SQLite.
import crypto from 'node:crypto';
import { fail, fullName } from './core.js';

const COOKIE = 'hrms_session';
const SESSION_DAYS = 7;

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
  if (typeof pw !== 'string' || pw.length < 8) fail(400, 'Password must be at least 8 characters');
  if (pw.length > 200) fail(400, 'Password is too long');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) fail(400, 'Password must contain letters and numbers');
}

export function tempPassword() {
  return `Hr${crypto.randomBytes(6).toString('base64url')}9`;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieOptions(req) {
  const secure = process.env.COOKIE_SECURE === 'true' || req.secure;
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

// expiresAt (ISO) shortens the session, e.g. to midnight for people whose
// sign-in depends on being in the office that day.
export function createSession(db, req, res, userId, { expiresAt = null } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const max = Date.now() + SESSION_DAYS * 86400000;
  const until = expiresAt && Date.parse(expiresAt) < max ? Date.parse(expiresAt) : max;
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, new Date(until).toISOString());
  db.run("DELETE FROM sessions WHERE expires_at < ?", new Date().toISOString());
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieOptions(req)}; Max-Age=${Math.max(60, Math.round((until - Date.now()) / 1000))}`);
}

export function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieOptions(req)}; Max-Age=0`);
}

export function loadUser(db, userId) {
  const row = db.get(`
    SELECT u.id, u.email, u.role, u.employee_id, u.must_change_password, u.active,
           e.first_name, e.last_name, e.designation, e.photo, e.code, e.gender
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = ?`, userId);
  if (!row || !row.active) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    employeeId: row.employee_id,
    name: row.first_name ? fullName(row) : row.email,
    firstName: row.first_name || row.email.split('@')[0],
    designation: row.designation || ({ admin: 'Administrator', hr: 'HR', manager: 'Manager', employee: 'Employee' })[row.role],
    hasPhoto: Boolean(row.photo),
    code: row.code,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

// Attaches req.user when a valid session cookie is present.
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

// Simple in-memory brute-force guard for the login endpoint.
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
