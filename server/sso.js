// One sign-in with the BrainADZ HRMS. People sign in there, pick Projects, and arrive here with
// a one-time pass signed with a secret both apps share. This checks the pass; the person is
// then signed in to the Projects account with the same email. (The HRMS signs passes with the
// same format, in its server/services/sso.js.)
import { createHmac, timingSafeEqual } from 'node:crypto';

const ISSUER = 'brainadz-hrms';
const AUDIENCE = 'brainadz-projects';
const MIN_SECRET = 32;

// The HRMS address and the shared secret, or null while either is missing or unusable.
export function hrmsLink(env = process.env) {
  const secret = env.SSO_SECRET || '';
  let url;
  try {
    url = new URL(env.HRMS_URL || '');
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || secret.length < MIN_SECRET) return null;
  return { url: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, secret };
}

// Why HRMS sign-in is off although HRMS_URL is set, for a start-up warning.
export function hrmsLinkProblem(env = process.env) {
  if (!env.HRMS_URL || hrmsLink(env)) return null;
  if ((env.SSO_SECRET || '').length < MIN_SECRET) return `SSO_SECRET must be set to the same value as in the HRMS, at least ${MIN_SECRET} characters`;
  return 'HRMS_URL must be a full http:// or https:// address';
}

const sign = (secret, body) => createHmac('sha256', secret).update(body).digest('base64url');

// The claims of a genuine, unexpired pass ({ email, name, jti, exp, ... }), or null.
export function readPass(secret, token, now = Date.now()) {
  const [body, sig, extra] = String(token || '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(sign(secret, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const t = Math.floor(now / 1000);
  if (claims.iss !== ISSUER || claims.aud !== AUDIENCE || !claims.email || !claims.jti) return null;
  // A few seconds' grace for the two servers' clocks.
  if (!(claims.exp >= t - 5) || !(claims.iat <= t + 30)) return null;
  return claims;
}
