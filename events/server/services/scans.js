// Gate scanning: storing immutable scan events, reconciling them into one answer per pass,
// the signed offline eligibility set for enrolled devices, and badge print jobs.
import crypto from 'node:crypto';
import {
  addDays,
  eventSettings,
  fail,
  nowIso,
  randomToken,
  ymdIn,
  zonedToUtc,
} from '../core.js';
import { decideScan, isAdmit } from '../../shared/scanRules.js';
import { passClasses, passFromQr } from './passes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Recomputes result, counted and conflict for every scan of one pass in one zone on one day.
// Scans are replayed in the order they happened on the devices, so a late offline scan with
// an earlier time takes its true place: the earliest valid scan is the single counted entry
// and a second device that also showed "accepted" is flagged as a conflict.
export function reconcile(db, event, passId, zoneId, day) {
  const settings = eventSettings(event);
  const from = zonedToUtc(day, '00:00', event.timezone).toISOString();
  const to = zonedToUtc(addDays(day, 1), '00:00', event.timezone).toISOString();
  const scans = db.all(
    `SELECT * FROM scan_events WHERE pass_id = ? AND zone_id = ? AND scanned_at >= ? AND scanned_at < ?
     ORDER BY scanned_at, received_at, id`,
    passId,
    zoneId,
    from,
    to,
  );
  const pass = db.get('SELECT * FROM passes WHERE id = ?', passId);
  const cls = passClasses(db, event.id).find((c) => c.id === pass.pass_class_id);
  const zone = db.get('SELECT id, restricted FROM zones WHERE id = ?', zoneId);
  const prior = [];
  let counted = null;
  for (const s of scans) {
    let result;
    if (s.direction === 'out') result = 'exit';
    else if (s.method === 'override') result = 'override_admitted';
    else {
      // A pass revoked after this scan happened was still valid when it was scanned.
      const activeThen = pass.status === 'active' || (pass.revoked_at && pass.revoked_at > s.scanned_at);
      result = decideScan({
        pass: { status: activeThen ? 'active' : 'revoked' },
        passClass: cls,
        zone,
        day,
        scannedAt: s.scanned_at,
        prior,
        repeatWindowSeconds: settings.repeatWindowSeconds,
        online: true,
      });
    }
    const admits = isAdmit(result);
    const isCounted = admits && !counted ? 1 : 0;
    // The device told staff "accepted" but another device had already admitted this pass.
    const conflict =
      s.device_result === 'admitted' && result !== 'admitted' && counted && counted.device_id !== s.device_id
        ? 1
        : 0;
    if (s.result !== result || s.counted !== isCounted || s.conflict !== conflict)
      db.run(
        'UPDATE scan_events SET result = ?, counted = ?, conflict = ?, conflict_with = ? WHERE id = ?',
        result,
        isCounted,
        conflict,
        conflict ? counted.id : null,
        s.id,
      );
    if (isCounted) counted = s;
    if (admits) prior.push({ scannedAt: s.scanned_at });
  }
}

// Stores one scan and returns it with its reconciled result. Sending the same id again (a
// retry after a dropped connection) returns the stored scan and changes nothing.
export function recordScan(
  db,
  { event, gate, device, user, id, qr, passId, scannedAt, mode = 'online', method = 'qr', deviceResult, overrideReason },
) {
  if (!UUID_RE.test(String(id || ''))) fail(400, 'Scan id must be a UUID');
  const existing = db.get('SELECT * FROM scan_events WHERE id = ?', id);
  if (existing) return { scan: existing, duplicate: true };
  const at = scannedAt && !Number.isNaN(Date.parse(scannedAt)) ? new Date(scannedAt) : new Date();
  // A device clock far in the future would corrupt ordering; clamp it to now.
  const when = at.getTime() > Date.now() + 5 * 60000 ? new Date() : at;
  const pass = passId
    ? db.get('SELECT * FROM passes WHERE id = ? AND event_id = ?', passId, event.id)
    : passFromQr(db, event, qr);
  db.insert('scan_events', {
    id,
    event_id: event.id,
    gate_id: gate.id,
    zone_id: gate.zone_id,
    device_id: device?.id ?? null,
    user_id: user?.id ?? null,
    token_id: pass?.token_id ?? null,
    pass_id: pass?.id ?? null,
    method,
    mode,
    direction: gate.direction,
    scanned_at: when.toISOString(),
    received_at: nowIso(),
    device_result: deviceResult ?? null,
    result: pass ? 'admitted' : 'denied_unknown',
    override_reason: overrideReason ?? null,
  });
  if (pass) reconcile(db, event, pass.id, gate.zone_id, ymdIn(event.timezone, when));
  return { scan: db.get('SELECT * FROM scan_events WHERE id = ?', id), duplicate: false, pass };
}

// What a scanner shows for a stored scan: the result plus the minimum about the holder.
export function scanView(db, scan) {
  const pass = scan.pass_id
    ? db.get(
        `SELECT p.id, p.holder_name, p.holder_company, c.name AS class_name
         FROM passes p JOIN pass_classes c ON c.id = p.pass_class_id WHERE p.id = ?`,
        scan.pass_id,
      )
    : null;
  const first =
    scan.pass_id && !scan.counted && scan.result !== 'denied_unknown'
      ? db.get(
          `SELECT s.scanned_at, g.name AS gate FROM scan_events s JOIN gates g ON g.id = s.gate_id
           WHERE s.pass_id = ? AND s.zone_id = ? AND s.counted = 1 ORDER BY s.scanned_at DESC LIMIT 1`,
          scan.pass_id,
          scan.zone_id,
        )
      : null;
  return {
    id: scan.id,
    result: scan.result,
    conflict: Boolean(scan.conflict),
    scannedAt: scan.scanned_at,
    mode: scan.mode,
    method: scan.method,
    passId: pass?.id ?? null,
    name: pass?.holder_name ?? null,
    company: pass?.holder_company ?? null,
    passClass: pass?.class_name ?? null,
    earlier: first ? { at: first.scanned_at, gate: first.gate } : null,
  };
}

// ---------- devices ----------
export function enrollDevice(db, { event, user, gate, name, platform, appVersion }) {
  const id = db.insert('devices', {
    event_id: event.id,
    user_id: user.id,
    gate_id: gate?.id ?? null,
    name,
    platform,
    app_version: appVersion ?? null,
    key: randomToken(32),
    last_seen_at: nowIso(),
    enrolled_at: nowIso(),
  });
  return db.get('SELECT * FROM devices WHERE id = ?', id);
}

// Loads an active device that belongs to this user. A revoked device answers 410 so the app
// knows to purge its cached eligibility data and sign out.
export function deviceFor(db, req, deviceId) {
  const device = db.get('SELECT * FROM devices WHERE id = ?', Number(deviceId) || 0);
  if (!device || device.user_id !== req.user.id) fail(404, 'Device not found');
  if (device.status !== 'active')
    fail(410, 'This device has been removed from the event. Its saved data must be cleared.', 'device_revoked');
  return device;
}

export function touchDevice(db, device, { queuedCount, synced } = {}) {
  const row = { last_seen_at: nowIso() };
  if (queuedCount != null) row.queued_count = Math.max(0, Math.min(100000, Number(queuedCount) || 0));
  if (synced) row.last_sync_at = nowIso();
  db.update('devices', device.id, row);
}

// The time-limited, signed eligibility set a device preloads so it can scan offline.
// It carries the minimum: per pass, the pass type, holder name and whether it was revoked.
// The signature is an HMAC with the device's own key, so a tampered copy is rejected on load.
export function buildBundle(db, event, device) {
  const settings = eventSettings(event);
  const today = ymdIn(event.timezone);
  const passes = {};
  for (const p of db.all(
    'SELECT token_id, pass_class_id, holder_name, status FROM passes WHERE event_id = ?',
    event.id,
  ))
    passes[p.token_id] = [p.pass_class_id, p.holder_name, p.status === 'active' ? 0 : 1];
  const from = zonedToUtc(today, '00:00', event.timezone).toISOString();
  const seen = db
    .all(
      `SELECT token_id, zone_id, scanned_at FROM scan_events
       WHERE event_id = ? AND scanned_at >= ? AND result IN ('admitted','reentry','override_admitted')`,
      event.id,
      from,
    )
    .map((s) => ({ tokenId: s.token_id, zoneId: s.zone_id, scannedAt: s.scanned_at }));
  const payload = JSON.stringify({
    v: 1,
    eventId: event.id,
    deviceId: device.id,
    timezone: event.timezone,
    issuedAt: nowIso(),
    expiresAt: new Date(Date.now() + settings.bundleHours * 3600000).toISOString(),
    repeatWindowSeconds: settings.repeatWindowSeconds,
    zones: db
      .all('SELECT id, name, restricted FROM zones WHERE event_id = ?', event.id)
      .map((z) => ({ id: z.id, name: z.name, restricted: z.restricted })),
    classes: passClasses(db, event.id).map((c) => ({
      id: c.id,
      name: c.name,
      zoneIds: c.zoneIds,
      validFrom: c.validFrom,
      validTo: c.validTo,
      reentry: c.reentry,
    })),
    passes,
    seen,
  });
  return {
    payload,
    signature: crypto.createHmac('sha256', device.key).update(payload).digest('hex'),
  };
}

// ---------- badge printing ----------
const jobView = `
  SELECT j.*, p.holder_name, p.holder_company, c.name AS class_name, g.name AS gate_name,
         pr.name AS printer_name, pr.is_spare AS printer_is_spare
  FROM print_jobs j
  JOIN passes p ON p.id = j.pass_id
  JOIN pass_classes c ON c.id = p.pass_class_id
  LEFT JOIN gates g ON g.id = j.gate_id
  LEFT JOIN printers pr ON pr.id = j.printer_id`;
export const printJob = (db, id) => db.get(`${jobView} WHERE j.id = ?`, id);
export const printJobs = (db, eventId, where = '', ...params) =>
  db.all(`${jobView} WHERE j.event_id = ? ${where} ORDER BY j.id DESC LIMIT 200`, eventId, ...params);

// Hands a job to the printer adapter and stores the outcome.
function submitJob(db, adapters, jobId, printerRow) {
  const out = adapters.printer.submit(printJob(db, jobId), printerRow);
  db.run(
    'UPDATE print_jobs SET status = ?, error = ?, printer_id = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?',
    out.status,
    out.error ?? null,
    printerRow?.id ?? null,
    nowIso(),
    jobId,
  );
  return printJob(db, jobId);
}

// Picks the printer for a gate: its own working printer first, then any printer it has.
function printerForGate(db, eventId, gateId) {
  return (
    db.get(
      "SELECT * FROM printers WHERE event_id = ? AND gate_id = ? AND is_spare = 0 ORDER BY (status = 'ready') DESC, id LIMIT 1",
      eventId,
      gateId,
    ) || null
  );
}

// Queues a badge. A second badge for a pass that already printed is a reprint: it needs the
// reprint permission and a reason, both checked by the caller and stored here.
export function createPrintJob(db, adapters, { event, pass, gate, user, kind = 'first', reason }) {
  const id = db.insert('print_jobs', {
    event_id: event.id,
    pass_id: pass.id,
    gate_id: gate?.id ?? null,
    kind,
    reason: reason ?? null,
    requested_by: user.id,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return submitJob(db, adapters, id, gate ? printerForGate(db, event.id, gate.id) : null);
}
export const alreadyPrinted = (db, passId) =>
  Boolean(db.value("SELECT 1 FROM print_jobs WHERE pass_id = ? AND status = 'printed'", passId));

// Tries a failed job again on the same gate's printer.
export function retryPrintJob(db, adapters, job) {
  if (job.status !== 'failed') fail(409, 'Only a failed print job can be retried');
  return submitJob(db, adapters, job.id, printerForGate(db, job.event_id, job.gate_id));
}

// Sends a failed job to the event's configured spare printer.
export function printOnSpare(db, adapters, job, user) {
  if (job.status !== 'failed') fail(409, 'Only a failed print job can move to the spare printer');
  const spare = db.get(
    "SELECT * FROM printers WHERE event_id = ? AND is_spare = 1 AND status = 'ready' ORDER BY id LIMIT 1",
    job.event_id,
  );
  if (!spare) fail(409, 'No working spare printer is set up for this event');
  db.update('print_jobs', job.id, { kind: 'spare', resolved_by: user.id });
  return submitJob(db, adapters, job.id, spare);
}
