// One sign-in for BrainADZ HRMS and BrainADZ Projects. People sign in here and pick an app;
// choosing Projects hands it a one-time pass, signed with a secret both apps share, that
// Projects checks before signing the same person (matched by email) in on its side.
import crypto from 'node:crypto';

// How long a pass can be used for, and who it is for.
const PASS_SECONDS = 60;
const ISSUER = 'brainadz-hrms';
const AUDIENCE = 'brainadz-projects';
// Shorter secrets are refused: they could be guessed.
const MIN_SECRET = 32;

// The Projects address and shared secret from the environment, or null while either is
// missing or unusable (the Projects option then stays hidden).
export function projectsLink(env = process.env) {
  const secret = env.SSO_SECRET || '';
  let url;
  try {
    url = new URL(env.PROJECTS_URL || '');
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || secret.length < MIN_SECRET) return null;
  return { url: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, secret };
}

// The BrainADZ CRM's address, offered beside HRMS and Projects in the app picker, or null. The
// CRM keeps its own sign-in, so this is only a link.
export function crmLink(env = process.env) {
  try {
    const url = new URL(env.CRM_URL || '');
    if (!/^https?:$/.test(url.protocol)) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

// Why the Projects option is off despite PROJECTS_URL being set, for a start-up warning.
export function projectsLinkProblem(env = process.env) {
  if (!env.PROJECTS_URL || projectsLink(env)) return null;
  if ((env.SSO_SECRET || '').length < MIN_SECRET)
    return `SSO_SECRET must be set to the same value as in BrainADZ Projects, at least ${MIN_SECRET} characters`;
  return 'PROJECTS_URL must be a full http:// or https:// address';
}

// base64url by hand, so the browser demo (whose Buffer lacks that encoding) signs passes too.
const b64 = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const mac = (secret, body) => b64(crypto.createHmac('sha256', secret).update(body).digest());

// A signed pass for one person: "<claims>.<signature>", both base64url.
export function signPass(secret, { email, name }, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const body = b64(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      email,
      name,
      iat,
      exp: iat + PASS_SECONDS,
      jti: crypto.randomBytes(16).toString('hex'),
    }),
  );
  return `${body}.${mac(secret, body)}`;
}

// The claims of a genuine, unexpired pass, or null. Projects runs the same check.
export function readPass(secret, token, now = Date.now()) {
  const [body, sig, extra] = String(token || '').split('.');
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(secret, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
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
