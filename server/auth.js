import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, keyHex] = stored.split('$');
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'));
  const expected = Buffer.from(keyHex, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export const newToken = () => randomBytes(32).toString('hex');

// Simple in-memory brute-force guard for the login form.
const attempts = new Map();
export const loginGuard = {
  blocked(key) {
    const a = attempts.get(key);
    return !!a && a.until > Date.now();
  },
  failed(key) {
    const a = attempts.get(key) || { n: 0, until: 0 };
    a.n += 1;
    if (a.n >= 8) {
      a.until = Date.now() + 10 * 60 * 1000;
      a.n = 0;
    }
    attempts.set(key, a);
  },
  succeeded(key) {
    attempts.delete(key);
  },
};
