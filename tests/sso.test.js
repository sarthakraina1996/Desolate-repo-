import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, as } from './helpers.js';
import { projectsLink, projectsLinkProblem, signPass, readPass } from '../server/services/sso.js';

const SECRET = 'a-shared-secret-that-is-long-enough-123';
const ENV = { PROJECTS_URL: 'https://projects.brainadz.com/', SSO_SECRET: SECRET };

let ctx;
before(async () => {
  ctx = await boot();
});
after(async () => {
  await ctx.close();
});

// Runs fn with the Projects settings in process.env, restoring them afterwards.
async function withProjects(env, fn) {
  const saved = { PROJECTS_URL: process.env.PROJECTS_URL, SSO_SECRET: process.env.SSO_SECRET };
  Object.assign(process.env, env);
  for (const k of Object.keys(saved)) if (!(k in env)) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}

test('the Projects link needs a full address and a long shared secret', () => {
  assert.equal(projectsLink({}), null);
  assert.equal(projectsLink({ ...ENV, SSO_SECRET: 'short' }), null);
  assert.equal(projectsLink({ ...ENV, PROJECTS_URL: 'projects.brainadz.com' }), null);
  assert.equal(projectsLink({ ...ENV, PROJECTS_URL: 'javascript:alert(1)' }), null);
  assert.deepEqual(projectsLink(ENV), { url: 'https://projects.brainadz.com', secret: SECRET });
  assert.match(projectsLinkProblem({ ...ENV, SSO_SECRET: '' }), /SSO_SECRET/);
  assert.equal(projectsLinkProblem({}), null);
});

test('passes: genuine ones read back; tampered, foreign or expired ones do not', () => {
  const now = Date.now();
  const pass = signPass(SECRET, { email: 'priya.sharma@brainadz.com', name: 'Priya Sharma' }, now);
  const claims = readPass(SECRET, pass, now + 5000);
  assert.equal(claims.email, 'priya.sharma@brainadz.com');
  assert.equal(claims.aud, 'brainadz-projects');
  assert.equal(readPass('another-secret-that-is-also-long-enough', pass, now), null);
  assert.equal(readPass(SECRET, pass, now + 120_000), null, 'expired after a minute');
  // Changing who the pass is for breaks the signature.
  const [body, sig] = pass.split('.');
  const forged = Buffer.from(
    JSON.stringify({ ...claims, email: 'rajiv.malhotra@brainadz.com' }),
  ).toString('base64url');
  assert.equal(readPass(SECRET, `${forged}.${sig}`, now), null);
  assert.equal(readPass(SECRET, `${body}.${sig}.x`, now), null);
  assert.equal(readPass(SECRET, '', now), null);
  // Two passes for the same person are still different (each can be used once).
  assert.notEqual(
    signPass(SECRET, { email: 'a@b.c' }, now),
    signPass(SECRET, { email: 'a@b.c' }, now),
  );
});

test('the HRMS hands a signed-in person a pass to Projects, only when connected', async () => {
  // Not connected: nothing on the sign-in page, and no pass.
  assert.equal((await client(ctx.base).get('/auth/config')).body.projectsUrl, null);
  const hr = await as(ctx.base, 'priya.sharma@brainadz.com');
  assert.equal((await hr.post('/apps/projects/pass')).status, 404);

  await withProjects(ENV, async () => {
    assert.equal(
      (await client(ctx.base).get('/auth/config')).body.projectsUrl,
      'https://projects.brainadz.com',
    );
    assert.equal((await hr.get('/meta')).body.projectsUrl, 'https://projects.brainadz.com');
    // Signed out: no pass.
    assert.equal((await client(ctx.base).post('/apps/projects/pass')).status, 401);
    const r = await hr.post('/apps/projects/pass');
    assert.equal(r.status, 200);
    const m = /^https:\/\/projects\.brainadz\.com\/#sso=([\w-]+\.[\w-]+)$/.exec(r.body.url);
    assert.ok(m, r.body.url);
    const claims = readPass(SECRET, m[1]);
    assert.equal(claims.email, 'priya.sharma@brainadz.com');
    assert.equal(claims.name, 'Priya Sharma');
    // Each switch is in the audit log.
    const log = ctx.db.get(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'Opened BrainADZ Projects'",
    );
    assert.equal(log.n, 1);
  });
});
