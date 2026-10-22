// Passkeys ("fingerprint check-in"): the phone's own fingerprint, face or screen lock proves the
// person starting the clock is the account owner. Uses the WebAuthn standard; the server only
// ever sees a public key and a signature, never the fingerprint itself.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { fail } from '../core.js';
import { deviceLabel } from './devices.js';

const CHALLENGE_MS = 5 * 60000; // time to finish the fingerprint prompt
const GRANT_MS = 2 * 60000; // a confirmed fingerprint is good for one check-in within this time

// Pending prompts and fresh confirmations, keyed by sign-in session. Kept in memory: losing them
// on a restart only means asking for the fingerprint again.
const challenges = new Map();
const grants = new Map();

// Drops expired prompts and confirmations.
function prune() {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.until < now) challenges.delete(k);
  for (const [k, v] of grants) if (v.until < now) grants.delete(k);
}

// The site identity passkeys are tied to: this host name and the page's origin.
function relyingParty(req) {
  return { rpID: req.hostname, origin: `${req.protocol}://${req.get('host')}` };
}

// Takes (and forgets) the prompt this session started for `purpose`.
function takeChallenge(req, purpose) {
  prune();
  const c = challenges.get(req.sessionKey);
  challenges.delete(req.sessionKey);
  if (!c || c.purpose !== purpose)
    fail(400, 'That fingerprint prompt has expired. Please try again.');
  return c;
}

// Marks this sign-in session as just confirmed, for the next check-in.
function grant(req) {
  grants.set(req.sessionKey, { userId: req.user.id, until: Date.now() + GRANT_MS });
}

// True once if this session confirmed the fingerprint in the last two minutes.
export function useGrant(req) {
  prune();
  const g = grants.get(req.sessionKey);
  if (!g || g.userId !== req.user.id) return false;
  grants.delete(req.sessionKey);
  return true;
}

// The user's registered passkeys.
export const passkeysOf = (db, userId) =>
  db.all('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at', userId);

// Options for setting up fingerprint check-in on this device. One passkey per person: a new
// phone needs HR to reset the old one, so someone who learns a password can't add their own.
export async function registrationOptions(db, req, companyName) {
  const existing = passkeysOf(db, req.user.id);
  if (existing.length)
    fail(
      409,
      'Fingerprint check-in is already set up on another device. Ask HR to reset it to use this one.',
    );
  const { rpID } = relyingParty(req);
  const options = await generateRegistrationOptions({
    rpName: `${companyName || 'BrainADZ'} HRMS`,
    rpID,
    userName: req.user.email,
    userDisplayName: req.user.name,
    userID: new TextEncoder().encode(`hrms-user-${req.user.id}`),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  challenges.set(req.sessionKey, {
    purpose: 'register',
    challenge: options.challenge,
    until: Date.now() + CHALLENGE_MS,
  });
  return options;
}

// Checks the new passkey, saves its public key and counts it as a confirmation.
export async function finishRegistration(db, req, response) {
  const { challenge } = takeChallenge(req, 'register');
  if (passkeysOf(db, req.user.id).length)
    fail(409, 'Fingerprint check-in is already set up on another device.');
  const { rpID, origin } = relyingParty(req);
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    fail(400, `Could not set up fingerprint check-in: ${e.message}`);
  }
  if (!result.verified) fail(400, 'Could not set up fingerprint check-in. Please try again.');
  const { credential } = result.registrationInfo;
  const label = deviceLabel(req.get('user-agent'));
  db.insert('passkeys', {
    user_id: req.user.id,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter || 0,
    transports: JSON.stringify(credential.transports || []),
    label,
    created_at: new Date().toISOString(),
  });
  grant(req);
  return { label };
}

// Options for confirming it's you, limited to your own registered passkey.
export async function authenticationOptions(db, req) {
  const keys = passkeysOf(db, req.user.id);
  if (!keys.length) fail(400, 'Set up fingerprint check-in first.');
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    allowCredentials: keys.map((k) => ({
      id: k.credential_id,
      transports: JSON.parse(k.transports || '[]'),
    })),
  });
  challenges.set(req.sessionKey, {
    purpose: 'verify',
    challenge: options.challenge,
    until: Date.now() + CHALLENGE_MS,
  });
  return options;
}

// Checks the fingerprint signature against the user's own passkey and counts it as confirmed.
export async function finishAuthentication(db, req, response) {
  const { challenge } = takeChallenge(req, 'verify');
  // The passkey must belong to the signed-in user, not just to anyone.
  const key = db.get(
    'SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ?',
    String(response?.id || ''),
    req.user.id,
  );
  if (!key) fail(403, "That isn't the passkey registered for your account.");
  const { rpID, origin } = relyingParty(req);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: key.credential_id,
        publicKey: new Uint8Array(Buffer.from(key.public_key, 'base64url')),
        counter: key.counter,
        transports: JSON.parse(key.transports || '[]'),
      },
    });
  } catch (e) {
    fail(400, `Could not confirm it's you: ${e.message}`);
  }
  if (!result.verified) fail(403, "Could not confirm it's you. Please try again.");
  db.run(
    'UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?',
    result.authenticationInfo.newCounter,
    new Date().toISOString(),
    key.id,
  );
  grant(req);
}
