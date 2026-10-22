// A software passkey for tests: does what a phone's fingerprint sensor does in WebAuthn
// (make a key pair, sign the server's challenge), so the server's checks can be tested for real.
import crypto from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha = (data) => crypto.createHash('sha256').update(data).digest();

// Minimal CBOR encoder: unsigned/negative ints, text, byte strings and Maps are all WebAuthn needs.
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  const b = Buffer.alloc(3);
  b[0] = (major << 5) | 25;
  b.writeUInt16BE(n, 1);
  return b;
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

// A passkey bound to one site. `verified: false` acts like a phone that skipped the fingerprint.
export function softPasskey({ verified = true } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = crypto.randomBytes(16);
  let counter = 0;
  const flags = (extra) => 0x01 | (verified ? 0x04 : 0) | extra; // user present (+ verified)
  const clientData = (type, challenge, origin) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    id: b64u(credId),
    // Answers navigator.credentials.create() for registration options from the server.
    register(options, origin) {
      const cose = cbor(
        new Map([
          [1, 2], // key type: EC2
          [3, -7], // algorithm: ES256
          [-1, 1], // curve: P-256
          [-2, Buffer.from(jwk.x, 'base64url')],
          [-3, Buffer.from(jwk.y, 'base64url')],
        ]),
      );
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(credId.length);
      const authData = Buffer.concat([
        sha(options.rp.id),
        Buffer.from([flags(0x40)]), // + attested credential data
        Buffer.alloc(4), // sign count 0
        Buffer.alloc(16), // AAGUID
        idLen,
        credId,
        cose,
      ]);
      const attestation = cbor(
        new Map([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      return {
        id: b64u(credId),
        rawId: b64u(credId),
        type: 'public-key',
        response: {
          clientDataJSON: b64u(clientData('webauthn.create', options.challenge, origin)),
          attestationObject: b64u(attestation),
          transports: ['internal'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
    // Answers navigator.credentials.get() for authentication options from the server.
    sign(options, origin) {
      counter += 1;
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([sha(options.rpId), Buffer.from([flags(0)]), count]);
      const data = clientData('webauthn.get', options.challenge, origin);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha(data)]), privateKey);
      return {
        id: b64u(credId),
        rawId: b64u(credId),
        type: 'public-key',
        response: {
          clientDataJSON: b64u(data),
          authenticatorData: b64u(authData),
          signature: b64u(signature),
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },
  };
}
