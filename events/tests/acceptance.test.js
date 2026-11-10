// The brief's acceptance checks, exercised through the real API against the seeded demo.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { boot, client, as } from './helpers.js';
import { qrFor } from '../server/services/passes.js';
import { decideOffline } from '../shared/scanRules.js';

const uuid = () => crypto.randomUUID();
let t;
let E; // FutureWorks Expo row
let gates; // { G1, G2, G3 } ids
test.before(async () => {
  t = await boot();
  E = t.db.get("SELECT * FROM events WHERE slug = 'futureworks-expo'");
  gates = Object.fromEntries(t.db.all('SELECT code, id FROM gates WHERE event_id = ?', E.id).map((g) => [g.code, g.id]));
});
test.after(() => t.close());

// Registers a visitor and confirms the emailed code. Returns the client (signed in) and state.
async function register(passClass, email, extra = {}) {
  const c = client(t.base);
  const made = await c.post('/public/events/futureworks-expo/registrations', {
    passClass,
    name: 'Test Visitor',
    email,
    company: 'Test Co',
    jobTitle: 'Buyer',
    consent: true,
    answers: { interest: 'Digital signage' },
    client: 'android',
    ...extra,
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const v = await c.post(`/public/events/futureworks-expo/registrations/${made.body.ref}/verify`, {
    code: made.body.demoCode,
    client: 'android',
  });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  c.setToken(v.body.token);
  return { c, state: v.body.registration, accessToken: v.body.accessToken };
}

test('visitor to entry: free pass, allowed gate, wrong zone, repeat and expired scans', async () => {
  const { state, accessToken } = await register('VISITOR', 'free.visitor@example.org');
  assert.equal(state.step, 'pass');
  assert.match(state.pass.qr, /^BAE1\.[\w-]+\.[\w-]+$/);
  assert.ok(!state.pass.qr.includes('Test'), 'QR holds no personal data');

  // The browser pass link works without signing in.
  const browser = await client(t.base).get(`/public/pass/${accessToken}`);
  assert.equal(browser.body.pass.holderName, 'Test Visitor');

  const gate = await as(t.base, 'gate1@futureworks.example');
  const first = await gate.post('/gate/scans', { gateId: gates.G1, id: uuid(), qr: state.pass.qr });
  assert.equal(first.body.result, 'admitted');
  const again = await gate.post('/gate/scans', { gateId: gates.G1, id: uuid(), qr: state.pass.qr });
  assert.equal(again.body.result, 'repeat');

  // A trade visitor pass does not open the conference theatre.
  const gate3 = await as(t.base, 'gate3@futureworks.example');
  const wrong = await gate3.post('/gate/scans', { gateId: gates.G3, id: uuid(), qr: state.pass.qr });
  assert.equal(wrong.body.result, 'denied_wrong_zone');

  // A Day 1 pass has expired by day two.
  const expired = t.db.get("SELECT p.* FROM passes p JOIN pass_classes c ON c.id = p.pass_class_id WHERE c.code = 'DAY1' LIMIT 1");
  const exp = await gate.post('/gate/scans', { gateId: gates.G1, id: uuid(), qr: qrFor(E, expired.token_id) });
  assert.equal(exp.body.result, 'denied_expired');

  // A tampered signature is not a pass.
  const forged = await gate.post('/gate/scans', { gateId: gates.G1, id: uuid(), qr: state.pass.qr.slice(0, -3) + 'AAA' });
  assert.equal(forged.body.result, 'denied_unknown');
});

test('visitor to entry: paid pass is issued only after hosted checkout succeeds', async () => {
  const { c, state } = await register('DELEGATE', 'paid.delegate@example.org');
  assert.equal(state.step, 'payment');
  assert.equal(state.pass, null);
  assert.equal(state.order.totalPaise, 295000); // ₹2,500 + 18% GST, in paise
  const checkout = await c.post(`/public/orders/${state.order.token}/checkout`, {});
  assert.match(checkout.body.url, /^\/pay\//);
  const paid = await c.post(`/public/pay/${checkout.body.intentId}/simulate`, { outcome: 'captured', method: 'upi' });
  assert.equal(paid.body.outcome, 'applied');
  const mine = await c.get('/me/passes');
  const reg = mine.body.registrations.find((r) => r.email === 'paid.delegate@example.org');
  assert.equal(reg.step, 'pass');
  assert.equal(reg.paymentStatus, 'paid');
});

test('approval-based and invited registration, resend and cancellation', async () => {
  const media = await register('MEDIA', 'press@example.org');
  assert.equal(media.state.step, 'review');
  const org = await as(t.base, 'organiser@futureworks.example');
  const ok = await org.post(`/org/events/${E.id}/registrations/${media.state.id}/decision`, { decision: 'approve' });
  assert.equal(ok.body.status, 'confirmed');
  assert.equal((await media.c.get('/me/passes')).body.registrations[0].step, 'pass');

  const noCode = await client(t.base).post('/public/events/futureworks-expo/registrations', {
    passClass: 'VIP',
    name: 'A',
    email: 'vip@example.org',
    consent: true,
    answers: { interest: 'Digital signage' },
  });
  assert.equal(noCode.status, 400);
  const vip = await register('VIP', 'vip@example.org', { inviteCode: 'INV-FWVIP001' });
  assert.equal(vip.state.step, 'pass');

  // Resend rotates the link; cancelling revokes the pass.
  const link = await client(t.base).post('/public/events/futureworks-expo/pass-link', { email: 'vip@example.org' });
  assert.equal(link.status, 200);
  assert.equal((await client(t.base).get(`/public/pass/${vip.accessToken}`)).status, 404, 'old link stops working');
  const cancelled = await vip.c.post(`/me/registrations/${vip.state.id}/cancel`);
  assert.equal(cancelled.body.step, 'cancelled');
  assert.equal(t.db.get('SELECT status FROM passes WHERE registration_id = ?', vip.state.id).status, 'revoked');
});

test('exhibitor to lead export: approve, allocate, badges, scan twice, export one row', async () => {
  const admin = await client(t.base).code('founder@newstand.example');
  const app = await admin.post('/events/futureworks-expo/exhibitor-applications', {
    companyName: 'Newstand Robotics',
    industry: 'Robotics',
    contactName: 'Asha Founder',
    contactEmail: 'founder@newstand.example',
    contactPhone: '+91 98765 43210',
    billingName: 'Newstand Robotics Pvt Ltd',
    billingAddress: 'Pune',
    categories: ['Robotics'],
    submit: true,
  });
  assert.equal(app.status, 201, JSON.stringify(app.body));
  const xid = app.body.id;
  const org = await as(t.base, 'organiser@futureworks.example');
  assert.equal((await org.post(`/org/events/${E.id}/exhibitors/${xid}/review`, { decision: 'approve' })).body.status, 'approved');
  const free = t.db.get("SELECT id FROM booths WHERE event_id = ? AND code = 'B12'", E.id);
  const alloc = await org.post(`/org/events/${E.id}/exhibitors/${xid}/allocate`, { boothId: free.id, confirm: true });
  assert.equal(alloc.body.status, 'confirmed');

  // Team badges: quota of 4 including the applicant.
  for (const n of [1, 2, 3])
    assert.equal(
      (await admin.post(`/exhibitor/${xid}/team`, { name: `Staff ${n}`, email: `staff${n}@newstand.example`, role: 'booth_staff' })).status,
      201,
    );
  assert.equal((await admin.post(`/exhibitor/${xid}/team`, { name: 'Staff 5', email: 'staff5@newstand.example' })).status, 409);
  const ws = await admin.get(`/exhibitor/${xid}`);
  assert.equal(ws.body.booth.code, 'B12');
  assert.equal(ws.body.team.length, 4);

  // Booth staff scan a permitted visitor badge twice: one lead.
  const staff = await client(t.base).code('staff1@newstand.example');
  const visitor = t.db.get(
    "SELECT p.token_id FROM passes p JOIN registrations r ON r.id = p.registration_id WHERE r.email = 'aarav.mehta@meridianretail.example'",
  );
  const qr = qrFor(E, visitor.token_id);
  const one = await staff.post(`/exhibitor/${xid}/leads/scan`, { qr, tags: ['Robotics'], notes: 'Wants a demo', rating: 'hot' });
  assert.equal(one.status, 201);
  assert.equal(one.body.lead.phone, undefined, 'phone is not in the lead-sharing policy');
  const two = await staff.post(`/exhibitor/${xid}/leads/scan`, { qr, tags: ['Pricing sent'] });
  assert.equal(two.body.duplicate, true);
  assert.equal(two.body.lead.scanCount, 2);

  // VIP and exhibitor badges are not scannable for leads.
  const vipPass = t.db.get(
    "SELECT p.token_id FROM passes p JOIN pass_classes c ON c.id = p.pass_class_id WHERE c.code = 'VIP' AND p.status = 'active' LIMIT 1",
  );
  assert.equal((await staff.post(`/exhibitor/${xid}/leads/scan`, { qr: qrFor(E, vipPass.token_id) })).status, 403);

  // Booth staff cannot export; the admin exports exactly one deduplicated row, and it is logged.
  assert.equal((await staff.get(`/exhibitor/${xid}/leads/export.csv`)).status, 403);
  const csv = await admin.get(`/exhibitor/${xid}/leads/export.csv`);
  assert.equal(csv.status, 200);
  const lines = csv.body.trim().split('\r\n');
  assert.equal(lines.length, 2, 'header + one lead');
  assert.match(lines[1], /Aarav Mehta/);
  assert.equal(t.db.value('SELECT COUNT(*) FROM lead_exports WHERE exhibitor_id = ?', xid), 1);

  // Another company cannot read or export these leads.
  const other = await as(t.base, 'ritu@novadisplays.example');
  assert.equal((await other.get(`/exhibitor/${xid}/leads`)).status, 404);
  assert.equal((await other.get(`/exhibitor/${xid}/leads/export.csv`)).status, 404);
});

test('concurrency and finance: one booth, one entitlement, accurate reconciliation', async () => {
  const org = await as(t.base, 'organiser@futureworks.example');
  // Two approved exhibitors race for booth B10.
  const ids = t.db.all("SELECT id FROM exhibitors WHERE event_id = ? AND status = 'submitted' ORDER BY id LIMIT 2", E.id).map((x) => x.id);
  for (const x of ids) await org.post(`/org/events/${E.id}/exhibitors/${x}/review`, { decision: 'approve' });
  const booth = t.db.get("SELECT id FROM booths WHERE event_id = ? AND code = 'B10'", E.id);
  const [a, b] = await Promise.all(
    ids.map((x) => org.post(`/org/events/${E.id}/exhibitors/${x}/allocate`, { boothId: booth.id, confirm: true })),
  );
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(t.db.value("SELECT COUNT(*) FROM booth_assignments WHERE booth_id = ? AND status IN ('held','confirmed')", booth.id), 1);
  // Confirming the same assignment twice is harmless.
  const won = a.status === 201 ? a : b;
  for (let i = 0; i < 2; i++)
    assert.equal((await org.post(`/org/events/${E.id}/assignments/${won.body.assignmentId}/confirm`)).body.status, 'confirmed');

  // A paid registration whose gateway callback is delivered, replayed, then replayed out of order.
  const { c, state } = await register('DELEGATE', 'replay@example.org');
  const checkout = await c.post(`/public/orders/${state.order.token}/checkout`, {});
  const send = (evt) => {
    const body = Buffer.from(JSON.stringify(evt));
    return client(t.base).post('/webhooks/payments/local', body, {
      'Content-Type': 'application/json',
      'X-Signature': t.ctx.adapters.payments.sign(body),
    });
  };
  const now = Date.now();
  const captured = {
    id: 'evt_cap_1',
    type: 'payment.captured',
    intentId: checkout.body.intentId,
    amountPaise: 295000,
    method: 'card',
    occurredAt: new Date(now).toISOString(),
  };
  const pending = {
    id: 'evt_pend_1',
    type: 'payment.pending',
    intentId: checkout.body.intentId,
    amountPaise: 295000,
    occurredAt: new Date(now - 5000).toISOString(),
  };
  assert.equal((await send(captured)).body.outcome, 'applied');
  assert.equal((await send(captured)).body.outcome, 'duplicate');
  assert.equal((await send(pending)).body.outcome, 'stale', 'an older "pending" must not undo "captured"');
  assert.equal((await send({ ...captured, id: 'evt_cap_2' })).body.outcome, 'stale', 'a second capture event changes nothing');
  // A callback with a bad signature is refused.
  const bad = await client(t.base).post('/webhooks/payments/local', Buffer.from(JSON.stringify(captured)), {
    'Content-Type': 'application/json',
    'X-Signature': 'nope',
  });
  assert.equal(bad.status, 401);

  const reg = t.db.get("SELECT * FROM registrations WHERE email = 'replay@example.org'");
  assert.equal(reg.payment_status, 'paid');
  assert.equal(t.db.value('SELECT COUNT(*) FROM passes WHERE registration_id = ?', reg.id), 1, 'one entitlement');
  const order = t.db.get('SELECT * FROM orders WHERE registration_id = ?', reg.id);
  assert.equal(order.paid_paise, 295000, 'money counted once');

  const fin = await as(t.base, 'finance@futureworks.example');
  const report = (await fin.get(`/org/events/${E.id}/finance`)).body.report;
  const captureTotal = t.db.value("SELECT SUM(amount_paise) FROM payments WHERE event_id = ? AND status IN ('captured','refunded')", E.id);
  assert.equal(report.capturedPaise, captureTotal);
  assert.equal(t.db.value('SELECT SUM(paid_paise) FROM orders WHERE event_id = ?', E.id), captureTotal, 'orders agree with payments');
  assert.ok(!report.issues.some((i) => i.kind === 'order_mismatch' || i.kind === 'paid_no_pass'));
  assert.ok(
    report.issues.some((i) => i.kind === 'refund_due'),
    'the seeded cancelled-after-paying delegate is listed',
  );
});

test('offline and hardware: two devices, queued scans sync, conflict counted once, printer recovery', async () => {
  const s1 = await as(t.base, 'gate1@futureworks.example');
  const s2 = await as(t.base, 'supervisor@futureworks.example');
  const d1 = (await s1.post('/gate/devices', { gateId: gates.G1, name: 'Phone A', platform: 'android' })).body;
  const d2 = (await s2.post('/gate/devices', { gateId: gates.G1, name: 'Phone B', platform: 'ios' })).body;

  // Both preload the signed eligibility set, then lose the network.
  const load = async (c, d) => {
    const b = (await c.get(`/gate/devices/${d.deviceId}/bundle`)).body;
    assert.equal(
      crypto.createHmac('sha256', d.key).update(b.payload).digest('hex'),
      b.signature,
      'bundle signature verifies with the device key',
    );
    return JSON.parse(b.payload);
  };
  const [b1, b2] = [await load(s1, d1), await load(s2, d2)];
  assert.ok(Date.parse(b1.expiresAt) > Date.now(), 'bundle is time-limited');
  const fresh = await register('VISITOR', 'offline.visitor@example.org');
  // Issued after the bundles were loaded: offline devices do not know this pass yet.
  const gate = { id: gates.G1, zoneId: t.db.get('SELECT zone_id FROM gates WHERE id = ?', gates.G1).zone_id };
  const unknown = decideOffline({
    bundle: b1,
    gate,
    history: [],
    tokenId: fresh.state.pass.qr.split('.')[1],
    scannedAt: new Date().toISOString(),
  });
  assert.equal(unknown.result, 'denied_unknown');

  // A pass both devices do know, never scanned today.
  const p = t.db.get(
    `SELECT p.* FROM passes p JOIN pass_classes c ON c.id = p.pass_class_id
     WHERE c.code = 'VISITOR' AND p.status = 'active' AND NOT EXISTS (SELECT 1 FROM scan_events s WHERE s.pass_id = p.id) LIMIT 1`,
  );
  const at1 = new Date(Date.now() - 20 * 60000).toISOString();
  const at2 = new Date(Date.now() - 15 * 60000).toISOString();
  const r1 = decideOffline({ bundle: b1, gate, history: [], tokenId: p.token_id, scannedAt: at1 });
  const r2 = decideOffline({ bundle: b2, gate, history: [], tokenId: p.token_id, scannedAt: at2 });
  assert.deepEqual([r1.result, r2.result], ['admitted', 'admitted'], 'each offline device accepts the pass');
  // The same device sees its own repeat without the network.
  assert.equal(
    decideOffline({
      bundle: b1,
      gate,
      history: [{ tokenId: p.token_id, zoneId: gate.zoneId, scannedAt: at1 }],
      tokenId: p.token_id,
      scannedAt: new Date(Date.parse(at1) + 20000).toISOString(),
    }).result,
    'repeat',
  );

  // Connectivity returns. The later scan syncs first; reconciliation still puts them in order.
  const q = qrFor(E, p.token_id);
  const scan2 = { id: uuid(), gateId: gates.G1, qr: q, scannedAt: at2, deviceResult: 'admitted' };
  const scan1 = { id: uuid(), gateId: gates.G1, qr: q, scannedAt: at1, deviceResult: 'admitted' };
  const sync2 = await s2.post('/gate/scans/sync', { deviceId: d2.deviceId, scans: [scan2], queuedCount: 0 });
  assert.equal(sync2.body.results[0].result, 'admitted');
  const sync1 = await s1.post('/gate/scans/sync', { deviceId: d1.deviceId, scans: [scan1], queuedCount: 0 });
  assert.equal(sync1.body.results[0].result, 'admitted', 'the earlier scan is the real first entry');
  const rows = t.db.all('SELECT id, result, counted, conflict FROM scan_events WHERE pass_id = ? ORDER BY scanned_at', p.id);
  assert.deepEqual(
    rows.map((r) => [r.counted, r.conflict]),
    [
      [1, 0],
      [0, 1],
    ],
    'counted once, the other flagged',
  );
  // Retrying an upload creates nothing new.
  await s1.post('/gate/scans/sync', { deviceId: d1.deviceId, scans: [scan1], queuedCount: 0 });
  assert.equal(t.db.value('SELECT COUNT(*) FROM scan_events WHERE pass_id = ?', p.id), 2);
  const org = await as(t.base, 'organiser@futureworks.example');
  const ops = (await org.get(`/org/events/${E.id}/gate-ops`)).body;
  assert.ok(ops.conflicts.some((c) => c.id === scan2.id));
  assert.equal(t.db.value('SELECT COUNT(DISTINCT pass_id) FROM scan_events WHERE pass_id = ? AND counted = 1', p.id), 1);

  // A restricted area cannot be decided offline.
  const vipZone = t.db.get("SELECT id FROM zones WHERE code = 'VIP' AND event_id = ?", E.id).id;
  const vipPass = t.db.get(
    "SELECT p.token_id FROM passes p JOIN pass_classes c ON c.id = p.pass_class_id WHERE c.code = 'VIP' AND p.status = 'active' LIMIT 1",
  );
  assert.equal(
    decideOffline({
      bundle: b1,
      gate: { id: 0, zoneId: vipZone },
      history: [],
      tokenId: vipPass.token_id,
      scannedAt: new Date().toISOString(),
    }).result,
    'needs_online',
  );

  // A revoked device is told to purge.
  await org.post(`/org/events/${E.id}/devices/${d2.deviceId}/revoke`);
  assert.equal((await s2.get(`/gate/devices/${d2.deviceId}/bundle`)).status, 410);

  // Printer failure is its own state: the visitor is admitted, the badge moves to the spare.
  const g2 = await as(t.base, 'gate2@futureworks.example');
  const job = await g2.post('/gate/print', { gateId: gates.G2, passId: p.id });
  assert.equal(job.body.status, 'failed');
  assert.match(job.body.error, /Out of labels/);
  assert.equal((await g2.post(`/gate/print-jobs/${job.body.id}/retry`)).body.status, 'failed');
  const spare = await g2.post(`/gate/print-jobs/${job.body.id}/spare`);
  assert.equal(spare.body.status, 'printed');
  // A second badge is a reprint: gate staff may not, a supervisor must give a reason.
  assert.equal((await g2.post('/gate/print', { gateId: gates.G2, passId: p.id })).status, 403);
  assert.equal((await s2.post('/gate/print', { gateId: gates.G2, passId: p.id })).status, 400);
  assert.equal((await s2.post('/gate/print', { gateId: gates.G1, passId: p.id, reason: 'Badge torn' })).body.kind, 'reprint');
});

test('permissions: tenants, exhibitor companies, gates and roles are enforced on the server', async () => {
  const fw = await as(t.base, 'organiser@futureworks.example');
  const nf = await as(t.base, 'owner@northfield.example');
  const other = t.db.get("SELECT id FROM events WHERE slug = 'northfield-build-summit'").id;
  // Cross-tenant requests fail as "not found" in both directions.
  for (const p of ['', '/live', '/registrations', '/exhibitors', '/finance', '/registrations.csv', '/reports/scans.csv', '/audit']) {
    assert.equal((await nf.get(`/org/events/${E.id}${p}`)).status, 404, `northfield -> futureworks ${p}`);
    assert.equal((await fw.get(`/org/events/${other}${p}`)).status, 404, `futureworks -> northfield ${p}`);
  }
  const reg = t.db.get('SELECT id FROM registrations WHERE event_id = ? LIMIT 1', E.id).id;
  assert.equal(
    (await nf.post(`/org/events/${other}/registrations/${reg}/cancel`)).status,
    404,
    "cannot reach another tenant's record through own event",
  );
  assert.equal((await nf.get('/org/events')).body.length, 1);

  // Exhibitor company boundaries.
  const nova = t.db.get("SELECT id FROM exhibitors WHERE company_name = 'Nova Displays'").id;
  const lumen = await as(t.base, 'farah@lumenworkspace.example');
  for (const p of ['', '/leads', '/leads/export.csv', '/services']) assert.equal((await lumen.get(`/exhibitor/${nova}${p}`)).status, 404);
  assert.equal((await lumen.post(`/exhibitor/${nova}/team`, { name: 'X', email: 'x@example.org' })).status, 404);

  // Roles: finance cannot approve, ops cannot refund, gate staff cannot override or leave their gate.
  const finance = await as(t.base, 'finance@futureworks.example');
  const ops = await as(t.base, 'ops@futureworks.example');
  const pending = t.db.get("SELECT id FROM registrations WHERE event_id = ? AND status = 'pending_review' LIMIT 1", E.id).id;
  assert.equal((await finance.post(`/org/events/${E.id}/registrations/${pending}/decision`, { decision: 'approve' })).status, 403);
  assert.equal((await ops.get(`/org/events/${E.id}/finance`)).status, 403);
  assert.equal((await ops.post(`/org/events/${E.id}/staff`, { email: 'a@b.co', name: 'A', role: 'finance' })).status, 403);
  const gate1 = await as(t.base, 'gate1@futureworks.example');
  const somePass = t.db.get("SELECT p.id, p.token_id FROM passes p WHERE p.event_id = ? AND p.status = 'active' LIMIT 1", E.id);
  assert.equal(
    (await gate1.post('/gate/scans', { gateId: gates.G2, id: uuid(), qr: qrFor(E, somePass.token_id) })).status,
    403,
    'wrong gate',
  );
  assert.equal((await gate1.post('/gate/override', { gateId: gates.G1, id: uuid(), passId: somePass.id, reason: 'x' })).status, 403);
  assert.equal((await gate1.get(`/org/events/${E.id}/live`)).status, 404);
  const sup = await as(t.base, 'supervisor@futureworks.example');
  const over = await sup.post('/gate/override', {
    gateId: gates.G3,
    id: uuid(),
    passId: somePass.id,
    reason: 'Speaker guest, approved by organiser',
  });
  assert.equal(over.body.result, 'override_admitted');
  assert.equal(
    (await sup.post('/gate/override', { gateId: gates.G3, id: uuid(), passId: somePass.id })).status,
    400,
    'a reason is required',
  );

  // Visitors and signed-out callers.
  const visitor = await client(t.base).code('aarav.mehta@meridianretail.example');
  assert.equal((await visitor.get('/me/passes')).body.registrations.length, 1);
  assert.equal((await visitor.get(`/org/events/${E.id}/live`)).status, 404);
  assert.equal((await visitor.get('/gate/context')).body.length, 0);
  assert.equal((await client(t.base).get('/me/passes')).status, 401);
  // The public display carries no personal data.
  const display = JSON.stringify((await client(t.base).get('/public/display/futureworks-expo/K1')).body);
  assert.ok(!display.includes('@') && !display.includes('+91'), 'no contact details on displays');
});
