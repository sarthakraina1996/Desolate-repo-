// Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s) for MFA, compatible
// with Google Authenticator, Microsoft Authenticator, 1Password and similar apps.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

// HOTP value for a counter (RFC 4226).
export function hotp(secretBuf, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

export function totp(secret, { time = Date.now(), step = 30, digits = 6 } = {}) {
  return hotp(base32Decode(secret), Math.floor(time / 1000 / step), digits);
}

// Accepts the current code or one step either side (clock drift), in constant time.
export function verifyTotp(secret, code, { time = Date.now(), window = 1 } = {}) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return false;
  const key = base32Decode(secret);
  const counter = Math.floor(time / 1000 / 30);
  let ok = false;
  for (let w = -window; w <= window; w++) {
    const expected = hotp(key, counter + w);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) ok = true;
  }
  return ok;
}

export const otpauthUri = ({ secret, account, issuer = 'BrainADZ Hospitality OS' }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
