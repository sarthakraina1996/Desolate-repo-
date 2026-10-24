// Globally unique, time-ordered identifiers (UUID version 7) for rows that sync between a
// property hub and HQ. Time ordering keeps indexes compact and makes logs readable.
import crypto from 'node:crypto';

// Random bytes are drawn from a pooled buffer: one system call per 256 identifiers.
let pool = Buffer.alloc(0);
let offset = 0;
function random16() {
  if (offset + 16 > pool.length) {
    pool = crypto.randomBytes(4096);
    offset = 0;
  }
  const out = Buffer.from(pool.subarray(offset, offset + 16));
  offset += 16;
  return out;
}

export function uuidv7(now = Date.now()) {
  const bytes = random16();
  // 48-bit big-endian Unix milliseconds.
  let ms = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
