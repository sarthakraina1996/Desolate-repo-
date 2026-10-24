// Security over the HTTP API on the seeded demo: authentication, CSRF, RBAC per role,
// property scoping, tenant isolation, financial redaction, PII masking, MFA and idempotent
// replays of state-changing requests.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, as, client, ok, U } from './helpers.js';
import { totp } from '../server/core/totp.js';
import { createOrganization, createProperty } from '../server/modules/properties/service.js';
import { hashPassword, loadUser } from '../server/modules/auth/service.js';

let ctx;
let ids;
before(async () => {
  ctx = await boot();
  const db = ctx.db;
  const prop = (code) => db.get('SELECT id FROM properties WHERE code = ?', code).id;
  ids = { delhi: prop('LGD'), lisbon: prop('LLX') };
  ids.lisbonRes = db.value("SELECT id FROM reservations WHERE property_id = ? AND status = 'closed' LIMIT 1", ids.lisbon);
  ids.delhiRes = db.value("SELECT id FROM reservations WHERE property_id = ? AND status = 'in_house' LIMIT 1", ids.delhi);
  ids.delhiFolio = db.value("SELECT id FROM folios WHERE reservation_id = ? AND status = 'open' LIMIT 1", ids.delhiRes);
  ids.guest = db.value('SELECT guest_id FROM reservations WHERE id = ?', ids.delhiRes);
});
after(async () => ctx?.close());

test('unauthenticated requests are refused and bad passwords do not sign in', async () => {
  const c = client(ctx.base);
  assert.equal((await c.get('/dashboard')).status, 401);
  assert.equal((await c.get('/reservations')).status, 401);
  assert.equal((await c.post('/auth/login', { email: U.gmDelhi, password: 'wrong-password' })).status, 401);
  assert.equal((await c.post('/auth/login', { email: 'nobody@example.com', password: 'x' })).status, 401);
  assert.equal((await c.get('/system/health')).status, 200, 'health is public');
});

test('session cookie is HttpOnly and SameSite; responses carry security headers', async () => {
  const r = await client(ctx.base).post('/auth/login', { email: U.desk, password: 'Hospitality@2026' });
  const cookie = r.headers.getSetCookie().join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=(Lax|Strict)/i);
  assert.ok(r.headers.get('content-security-policy'), 'CSP header');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('state-changing requests without the CSRF header are rejected', async () => {
  const c = await as(ctx.base, U.desk);
  const r = await c.raw('POST', '/guest-requests', { propertyId: ids.delhi, kind: 'request', description: 'Towels' }, { headers: { 'X-Requested-With': '' } });
  assert.equal(r.status, 403);
});

test('roles only reach what their permissions allow', async () => {
  const attendant = await as(ctx.base, U.attendant);
  const desk = await as(ctx.base, U.desk);
  const banquet = await as(ctx.base, U.banquet);
  const hk = await as(ctx.base, U.hkManager);
  const pid = ids.delhi;
  assert.equal((await attendant.get(`/finance/trial-balance?property=${pid}`)).status, 403);
  assert.equal((await attendant.post('/reservations', { propertyId: pid, rooms: [{}] })).status, 403);
  assert.equal((await attendant.get(`/folios/${ids.delhiFolio}`)).status, 403);
  assert.equal((await desk.post('/night-audit', { propertyId: pid })).status, 403);
  assert.equal((await desk.get('/users')).status, 403);
  assert.equal((await desk.get(`/finance/reconciliation?property=${pid}`)).status, 403);
  assert.equal((await hk.post(`/folios/${ids.delhiFolio}/charges`, { chargeCode: 'MINIBAR', amount: 100 })).status, 403);
  // Manager-only overrides.
  const types = ok(await desk.get(`/room-types?property=${pid}`));
  const line = { roomTypeId: (types.rows ?? types)[0].id, arrival: '2027-03-01', departure: '2027-03-02', rate: 1 };
  const r = await desk.post('/reservations', { propertyId: pid, guest: { first_name: 'Rate', last_name: 'Override' }, rooms: [line] });
  assert.equal(r.status, 403);
  // Banquets may see reservations but not their money.
  const d = ok(await banquet.get(`/reservations/${ids.delhiRes}`));
  assert.equal(d.total_minor, null);
  assert.equal(d.folios, undefined);
  assert.ok(d.nights.every((n) => n.rate_minor === undefined));
});

test('users only see the properties they are assigned to', async () => {
  const gm = await as(ctx.base, U.gmDelhi);
  assert.deepEqual(gm.me.properties.map((p) => p.id), [ids.delhi]);
  assert.equal((await gm.get(`/reservations/${ids.lisbonRes}`)).status, 404);
  assert.equal((await gm.get(`/calendar?property=${ids.lisbon}`)).status, 404);
  assert.equal((await gm.get(`/dashboard?property=${ids.lisbon}`)).status, 404);
  const list = ok(await gm.get('/reservations?limit=200'));
  assert.ok(list.rows.every((r) => r.property_id === ids.delhi));
  const lisbonFolio = ctx.db.value('SELECT id FROM folios WHERE property_id = ? LIMIT 1', ids.lisbon);
  assert.equal((await gm.post(`/folios/${lisbonFolio}/charges`, { chargeCode: 'MISC', amount: 10 })).status, 404);
});

test('organisations are isolated from each other', async () => {
  const db = ctx.db;
  const orgId = createOrganization(db, { name: 'Other Group', reportingCurrency: 'INR' });
  const uid = db.insert('users', { org_id: orgId, email: 'owner@other.test', name: 'Other Owner', role: 'owner', all_properties: 1, password_hash: hashPassword('Other@2026x') });
  createProperty(db, loadUser(db, uid), orgId, { code: 'OTH', name: 'Other Hotel', country: 'IN', timezone: 'Asia/Kolkata', currency: 'INR', tax_regime: 'IN_GST', business_date: '2026-10-24' });
  const other = await as(ctx.base, 'owner@other.test', 'Other@2026x');
  const props = ok(await other.get('/properties'));
  assert.deepEqual((props.rows ?? props).map((p) => p.code), ['OTH']);
  assert.equal((await other.get(`/reservations/${ids.delhiRes}`)).status, 404);
  assert.equal((await other.get(`/guests/${ids.guest}`)).status, 404);
  assert.equal((await other.get(`/folios/${ids.delhiFolio}`)).status, 404);
  assert.equal((await other.get(`/properties/${ids.delhi}`)).status, 404);
  const g = ok(await other.get('/guests?q=a'));
  assert.equal(g.rows.length, 0, 'guest search never crosses organisations');
  const dash = ok(await other.get('/dashboard'));
  assert.equal(dash.properties.length, 1);
  // A property created today has no records for the month so far: "no data", not zero.
  assert.equal(dash.coverage, null);
  assert.equal(dash.kpis.sold_room_nights, null);
  assert.equal(dash.kpis.total_operating_revenue, null);
});

test('financial figures are hidden from roles without financial visibility', async () => {
  const hk = await as(ctx.base, U.hkManager);
  const d = ok(await hk.get('/dashboard'));
  for (const k of ['adr', 'revpar', 'room_revenue', 'total_operating_revenue']) assert.ok(d.kpis[k] == null, `${k} is redacted`);
  assert.ok(d.kpis.occupancy_pct != null, 'operational measures stay visible');
  assert.equal(d.breakdowns, null);
  assert.equal((await hk.get('/metrics/drilldown?metric=room_revenue')).status, 403);
  const gm = await as(ctx.base, U.gmDelhi);
  assert.ok(ok(await gm.get('/dashboard')).kpis.adr > 0);
});

test('identity documents and contact details are masked; export and erasure need permission', async () => {
  const desk = await as(ctx.base, U.desk);
  const g = ok(await desk.get(`/guests/${ids.guest}`));
  // Only a masked document number is ever stored (at most the last four digits).
  const cols = ctx.db.all('PRAGMA table_info(guests)').map((c) => c.name);
  assert.ok(!cols.includes('id_number'), 'no column holds a full identity number');
  for (const { m } of ctx.db.all('SELECT id_number_masked AS m FROM guests WHERE id_number_masked IS NOT NULL LIMIT 500'))
    assert.ok((m.match(/[0-9A-Za-z]/g) || []).length <= 4, `masked: ${m}`);
  assert.ok(!g.id_number_masked || g.id_number_masked.includes('•'));
  assert.equal((await desk.get(`/guests/${ids.guest}/export`)).status, 403);
  assert.equal((await desk.post(`/guests/${ids.guest}/erase`, { reason: 'Request' })).status, 403);
  // The general manager handles data-subject requests for their property's guests.
  const gm = await as(ctx.base, U.gmDelhi);
  const exp = await gm.get(`/guests/${ids.guest}/export`);
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition'), /attachment/);
});

test('two-step sign-in: enrol, then a password alone is not enough', async () => {
  const c = await as(ctx.base, U.fom);
  const setup = ok(await c.post('/auth/mfa/setup'));
  assert.equal((await c.post('/auth/mfa/enable', { code: '000000' })).body.code, 'mfa_invalid');
  ok(await c.post('/auth/mfa/enable', { code: totp(setup.secret) }));
  ok(await c.post('/auth/logout'));
  const fresh = client(ctx.base);
  const step1 = ok(await fresh.post('/auth/login', { email: U.fom, password: 'Hospitality@2026' }));
  assert.equal(step1.mfaRequired, true);
  assert.equal((await fresh.get('/dashboard')).status, 401, 'no session before the second factor');
  assert.equal((await fresh.post('/auth/mfa/verify', { challenge: step1.challenge, code: '123456' })).status, 401);
  ok(await fresh.post('/auth/mfa/verify', { challenge: step1.challenge, code: totp(setup.secret) }));
  assert.equal((await fresh.get('/dashboard')).status, 200);
});

test('a retried payment with the same Idempotency-Key posts once', async () => {
  const desk = await as(ctx.base, U.desk);
  const before = ctx.db.value('SELECT COUNT(*) FROM folio_postings WHERE folio_id = ?', ids.delhiFolio);
  const send = (body) => desk.post(`/folios/${ids.delhiFolio}/payments`, body, { headers: { 'Idempotency-Key': 'pay-retry-42' } });
  const a = await send({ method: 'CASH', amount: 1000 });
  const b = await send({ method: 'CASH', amount: 1000 });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get('idempotent-replay'), 'true');
  assert.equal(b.body.id, a.body.id);
  assert.equal(ctx.db.value('SELECT COUNT(*) FROM folio_postings WHERE folio_id = ?', ids.delhiFolio), before + 1);
  const c = await send({ method: 'CASH', amount: 2000 });
  assert.equal(c.status, 422, 'a reused key with a different body is refused');
});

test('erasure anonymises the profile but keeps the financial record', async () => {
  const gm = await as(ctx.base, U.gmDelhi);
  const guest = ctx.db.value(
    `SELECT g.id FROM guests g WHERE g.anonymized_at IS NULL
       AND EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = g.id AND r.property_id = ? AND r.status = 'closed')
       AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('confirmed','in_house')) LIMIT 1`,
    ids.delhi,
  );
  const postings = ctx.db.value('SELECT COUNT(*) FROM folio_postings WHERE guest_id = ?', guest);
  assert.equal((await gm.post(`/guests/${guest}/erase`, {})).status, 400, 'a reason is required');
  ok(await gm.post(`/guests/${guest}/erase`, { reason: 'Data-subject request' }));
  const g = ctx.db.get('SELECT first_name, email, phone, id_number_masked, anonymized_at FROM guests WHERE id = ?', guest);
  assert.deepEqual([g.first_name, g.email, g.phone, g.id_number_masked], ['Erased', null, null, null]);
  assert.ok(g.anonymized_at);
  assert.equal(ctx.db.value('SELECT COUNT(*) FROM folio_postings WHERE guest_id = ?', guest), postings, 'postings are retained');
  assert.equal(ctx.db.value("SELECT COUNT(*) FROM audit_log WHERE action = 'guest.erased' AND entity_id = ?", guest), 1);
  // A guest with a current stay cannot be erased.
  assert.equal((await gm.post(`/guests/${ids.guest}/erase`, { reason: 'x' })).status, 409);
});
