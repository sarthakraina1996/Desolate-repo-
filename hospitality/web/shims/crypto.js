// The node:crypto functions the server uses, for the browser: Web Crypto for randomness and
// pure-JS hashes (@noble/hashes) for the synchronous scrypt, SHA-256 and HMAC-SHA1 calls.
import { Buffer } from 'buffer';
import { scrypt } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';
import { sha1 } from '@noble/hashes/sha1';
import { hmac } from '@noble/hashes/hmac';

const bytes = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : v);

export function randomBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return Buffer.from(out);
}

// Same defaults as Node (N = 16384, r = 8, p = 1), so hashes from the server verify here.
export const scryptSync = (password, salt, keylen, o = {}) =>
  Buffer.from(scrypt(bytes(password), bytes(salt), { N: o.N ?? o.cost ?? 16384, r: o.r ?? o.blockSize ?? 8, p: o.p ?? o.parallelization ?? 1, dkLen: keylen }));

function hasher(make) {
  const parts = [];
  return {
    update(v) {
      parts.push(bytes(v));
      return this;
    },
    digest(enc) {
      const out = Buffer.from(make(Buffer.concat(parts)));
      return enc ? out.toString(enc) : out;
    },
  };
}

export function createHash(alg) {
  if (alg !== 'sha256') throw new Error(`Unsupported hash ${alg}`);
  return hasher((m) => sha256(m));
}

export function createHmac(alg, key) {
  const fn = { sha1, sha256 }[alg];
  if (!fn) throw new Error(`Unsupported HMAC ${alg}`);
  return hasher((m) => hmac(fn, bytes(key), m));
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length');
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export default { randomBytes, scryptSync, createHash, createHmac, timingSafeEqual };
