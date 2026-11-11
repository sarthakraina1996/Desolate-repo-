// The parts of node:crypto the Events server uses, for the in-browser demo. Builds on the
// HRMS demo's SHA-256 shim and adds HMAC, random integers and UUIDs.
import { Buffer } from 'buffer';
import { createHash as baseHash, randomBytes, scryptSync, timingSafeEqual } from '../../../demo/shims/crypto.js';

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const out = (buf, enc) => (!enc ? buf : enc === 'base64url' ? b64url(buf) : buf.toString(enc));
const bytes = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v));
const sha = (...parts) => {
  const h = baseHash();
  parts.forEach((p) => h.update(p));
  return h.digest();
};

export function createHash() {
  const parts = [];
  return {
    update(v) {
      parts.push(bytes(v));
      return this;
    },
    digest: (enc) => out(sha(...parts), enc),
  };
}
export function createHmac(_alg, key) {
  let k = bytes(key);
  if (k.length > 64) k = sha(k);
  const pad = (x) => Buffer.from(Array.from({ length: 64 }, (_, i) => (k[i] || 0) ^ x));
  const parts = [];
  return {
    update(v) {
      parts.push(bytes(v));
      return this;
    },
    digest: (enc) => out(sha(pad(0x5c), sha(pad(0x36), ...parts)), enc),
  };
}
export function randomInt(min, max) {
  const n = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  return min + (n % (max - min));
}
export const randomUUID = () => globalThis.crypto.randomUUID();
export { randomBytes, scryptSync, timingSafeEqual };
export default { createHash, createHmac, randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual };
