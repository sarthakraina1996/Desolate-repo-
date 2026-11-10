// Identity: password hashing (scrypt), one-time email codes, and sessions stored in SQLite.
// Browsers carry the session in an HttpOnly cookie; the native apps send it as a bearer token
// that they keep in the iOS Keychain or Android Keystore.
import crypto from 'node:crypto';
import { fail, nowIso, sha256 } from './core.js';

const COOKIE = 'bae_session';
const SESSION_DAYS = { web: 7, windows: 7, ios: 30, android: 30 };
const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

// Hashes a password with a random salt as "scrypt$salt$hash".
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Checks a password against a stored hash in constant time.
export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
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

// Parses a Cookie header into a name -> value map.
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // A malformed cookie value is ignored rather than failing the request.
      }
    }
  }
  return out;
}

// Cookie attributes; adds Secure on HTTPS or when COOKIE_SECURE=true.
function cookieOptions(req) {
  const secure = process.env.COOKIE_SECURE === 'true' || req.secure;
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

const CLIENTS = ['web', 'windows', 'ios', 'android'];
export const clientOf = (req) => {
  const c = String(req.body?.client || req.headers['x-client'] || 'web').toLowerCase();
  return CLIENTS.includes(c) ? c : 'web';
};

// Starts a session. Native clients get the token back to store securely; browsers get a
// cookie and never see the token.
export function createSession(db, req, res, userId) {
  const client = clientOf(req);
  const token = crypto.randomBytes(32).toString('hex');
  const days = SESSION_DAYS[client];
  const until = new Date(Date.now() + days * 86400000).toISOString();
  db.run(
    'INSERT INTO sessions (token_hash, user_id, client, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    sha256(token),
    userId,
    client,
    until,
    nowIso(),
  );
  db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
  db.run('UPDATE users SET last_login = ? WHERE id = ?', nowIso(), userId);
  if (client === 'ios' || client === 'android') return { token, expiresAt: until };
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieOptions(req)}; Max-Age=${days * 86400}`);
  return { expiresAt: until };
}

// Reads the session token from the Authorization header or the cookie.
function tokenOf(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return { token: auth.slice(7).trim(), via: 'bearer' };
  const cookie = parseCookies(req.headers.cookie)[COOKIE];
  return cookie ? { token: cookie, via: 'cookie' } : null;
}

// Signs out: deletes the session row and clears the cookie.
export function destroySession(db, req, res) {
  const t = tokenOf(req);
  if (t) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(t.token));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieOptions(req)}; Max-Age=0`);
}

// Ends every session of a user, e.g. when their access is revoked.
export function destroyUserSessions(db, userId) {
  db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

// Attaches req.user when a valid session is presented. Cookie sessions must also send the
// X-Requested-With header on anything that changes data, which blocks cross-site form posts.
export function sessionMiddleware(db) {
  return (req, _res, next) => {
    const t = tokenOf(req);
    if (t) {
      const s = db.get(
        'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
        sha256(t.token),
      );
      if (s && s.expires_at > nowIso()) {
        const u = db.get(
          'SELECT id, email, name, phone, active FROM users WHERE id = ?',
          s.user_id,
        );
        if (u && u.active) {
          req.user = { id: u.id, email: u.email, name: u.name, phone: u.phone };
          req.sessionVia = t.via;
        }
      }
    }
    next();
  };
}
export function csrfGuard(req, _res, next) {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe && req.sessionVia === 'cookie' && req.headers['x-requested-with'] !== 'brainadz-events')
    return next(Object.assign(new Error('Missing request header'), { status: 403 }));
  next();
}

// Finds a user by email or creates a passwordless one. Email ownership must already be proven.
export function findOrCreateUser(db, { email, name, phone }) {
  const existing = db.get('SELECT * FROM users WHERE email = ?', email);
  if (existing) {
    if (!existing.name && name) db.update('users', existing.id, { name });
    if (!existing.phone && phone) db.update('users', existing.id, { phone });
    return existing.id;
  }
  return db.insert('users', {
    email,
    name: name || '',
    phone: phone || null,
    created_at: nowIso(),
  });
}

// ---------- one-time codes ----------
// Creates a 6-digit code for an email, replacing earlier unused codes of the same purpose.
export function issueOtp(db, { email, purpose, ref = null }) {
  const recent = db.value(
    'SELECT COUNT(*) FROM otp_codes WHERE email = ? AND created_at > ?',
    email,
    new Date(Date.now() - 15 * 60000).toISOString(),
  );
  if (recent >= 6) fail(429, 'Too many codes requested. Try again in 15 minutes.');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.run(
    'UPDATE otp_codes SET used_at = ? WHERE email = ? AND purpose = ? AND used_at IS NULL AND COALESCE(ref, \'\') = ?',
    nowIso(),
    email,
    purpose,
    ref || '',
  );
  db.insert('otp_codes', {
    email,
    code_hash: sha256(`${email}:${code}`),
    purpose,
    ref,
    expires_at: new Date(Date.now() + OTP_MINUTES * 60000).toISOString(),
    created_at: nowIso(),
  });
  return code;
}

// Checks a code. Wrong guesses count against the code; after five it is dead.
export function consumeOtp(db, { email, purpose, ref = null, code }) {
  const row = db.get(
    `SELECT * FROM otp_codes WHERE email = ? AND purpose = ? AND used_at IS NULL
       AND COALESCE(ref, '') = ? ORDER BY id DESC LIMIT 1`,
    email,
    purpose,
    ref || '',
  );
  if (!row || row.expires_at < nowIso())
    fail(400, 'That code has expired. Request a new one.', 'code_expired');
  if (row.attempts >= OTP_MAX_ATTEMPTS)
    fail(429, 'Too many wrong attempts. Request a new code.', 'code_locked');
  if (row.code_hash !== sha256(`${email}:${String(code || '').trim()}`)) {
    db.run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    fail(400, 'That code is not right. Check the email and try again.', 'code_wrong');
  }
  db.run('UPDATE otp_codes SET used_at = ? WHERE id = ?', nowIso(), row.id);
}

// Simple in-memory brute-force guard for password sign-in.
// Allows 8 failures per key in a 15-minute window; returns callbacks to record the outcome.
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
