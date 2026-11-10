// Gate staff: device enrolment, the offline eligibility set, scanning, manual lookup,
// overrides and badge printing. Access is scoped to the gates a person is assigned to.
import { Router } from 'express';
import {
  audit,
  fail,
  gateAccess,
  gatesFor,
  hasOrgPerm,
  id,
  memberships,
  oneOf,
  requireUser,
  roleCan,
  str,
  GATE_ROLES,
  ORG_ROLES,
} from '../core.js';
import { eventSummary } from '../services/guide.js';
import { qrFor } from '../services/passes.js';
import {
  alreadyPrinted,
  buildBundle,
  createPrintJob,
  deviceFor,
  enrollDevice,
  printJob,
  printJobs,
  printOnSpare,
  recordScan,
  retryPrintJob,
  scanView,
  touchDevice,
} from '../services/scans.js';
import { nowIso } from '../core.js';

const jobOut = (j) => ({
  id: j.id,
  passId: j.pass_id,
  name: j.holder_name,
  company: j.holder_company,
  passClass: j.class_name,
  gate: j.gate_name,
  printer: j.printer_name,
  onSpare: Boolean(j.printer_is_spare),
  kind: j.kind,
  reason: j.reason,
  status: j.status,
  error: j.error,
  attempts: j.attempts,
  createdAt: j.created_at,
  updatedAt: j.updated_at,
});

export default function gateRoutes(ctx) {
  const { db, adapters } = ctx;
  const r = Router();
  const eventOf = (gate) => db.get('SELECT * FROM events WHERE id = ?', gate.event_id);
  // Does the user hold this gate permission on the gate's event (any gate role or org role)?
  const can = (req, event, perm) =>
    hasOrgPerm(db, req, event, perm) ||
    memberships(db, req).some((m) => GATE_ROLES.includes(m.role) && m.event_id === event.id && roleCan(m.role, perm));

  // Events and gates this person can operate, and what they may do there.
  r.get('/gate/context', (req, res) => {
    requireUser(req);
    const eventIds = new Set();
    for (const m of memberships(db, req)) {
      if (GATE_ROLES.includes(m.role)) eventIds.add(m.event_id);
      if (ORG_ROLES.includes(m.role) && roleCan(m.role, 'gate.scan'))
        for (const e of db.all('SELECT id FROM events WHERE organiser_id = ? AND (? IS NULL OR id = ?)', m.organiser_id, m.event_id, m.event_id))
          eventIds.add(e.id);
    }
    const out = [];
    for (const eid of eventIds) {
      const event = db.get('SELECT * FROM events WHERE id = ?', eid);
      const gates = gatesFor(db, req, eid, 'gate.scan');
      if (!event || !gates.length) continue;
      out.push({
        event: eventSummary(event),
        canOverride: can(req, event, 'gate.override'),
        canReprint: can(req, event, 'gate.reprint'),
        canPrint: can(req, event, 'gate.print'),
        gates: gates.map((g) => {
          const z = db.get('SELECT name, restricted FROM zones WHERE id = ?', g.zone_id);
          return { id: g.id, code: g.code, name: g.name, zoneId: g.zone_id, zoneName: z.name, restricted: Boolean(z.restricted) };
        }),
      });
    }
    res.json(out);
  });

  // Enrols this phone or PC as a scanning device for a gate and returns its signing key.
  r.post('/gate/devices', (req, res) => {
    const gate = gateAccess(db, req, id(req.body.gateId), 'gate.scan');
    const device = enrollDevice(db, {
      event: eventOf(gate),
      user: req.user,
      gate,
      name: str(req.body.name, { max: 80, required: true, name: 'Device name' }),
      platform: oneOf(req.body.platform, ['ios', 'android', 'web', 'windows']) || 'web',
      appVersion: str(req.body.appVersion, { max: 20 }),
    });
    audit(db, req, 'device.enroll', { event: eventOf(gate), entity: 'device', entityId: device.id, detail: { name: device.name, gate: gate.name } });
    res.status(201).json({ deviceId: device.id, key: device.key, gateId: gate.id });
  });

  r.get('/gate/devices/:id/bundle', (req, res) => {
    requireUser(req);
    const device = deviceFor(db, req, req.params.id);
    const event = db.get('SELECT * FROM events WHERE id = ?', device.event_id);
    if (!gatesFor(db, req, event.id, 'gate.scan').length) fail(403, 'You no longer have gate access for this event');
    touchDevice(db, device, { synced: true });
    res.json(buildBundle(db, event, device));
  });

  r.post('/gate/devices/:id/heartbeat', (req, res) => {
    requireUser(req);
    const device = deviceFor(db, req, req.params.id);
    touchDevice(db, device, { queuedCount: req.body.queuedCount });
    res.json({ ok: true, serverTime: nowIso() });
  });

  // One live scan, validated online.
  r.post('/gate/scans', (req, res) => {
    const gate = gateAccess(db, req, id(req.body.gateId), 'gate.scan');
    const device = req.body.deviceId ? deviceFor(db, req, req.body.deviceId) : null;
    if (device) touchDevice(db, device, { queuedCount: req.body.queuedCount });
    const manual = req.body.passId != null;
    if (manual) gateAccess(db, req, gate.id, 'gate.lookup');
    const out = db.tx(() =>
      recordScan(db, {
        event: eventOf(gate),
        gate,
        device,
        user: req.user,
        id: req.body.id,
        qr: req.body.qr,
        passId: manual ? id(req.body.passId) : null,
        scannedAt: req.body.scannedAt,
        method: manual ? 'manual' : 'qr',
      }),
    );
    res.json(scanView(db, out.scan));
  });

  // Uploads scans a device made offline. Each scan keeps its device id, gate and time; ids
  // make the upload safe to repeat. The answer tells the device the reconciled result of each.
  r.post('/gate/scans/sync', (req, res) => {
    requireUser(req);
    const device = deviceFor(db, req, req.body.deviceId);
    const scans = Array.isArray(req.body.scans) ? req.body.scans.slice(0, 500) : [];
    const results = db.tx(() =>
      scans.map((s) => {
        const gate = gateAccess(db, req, id(s.gateId), 'gate.scan');
        const out = recordScan(db, {
          event: eventOf(gate),
          gate,
          device,
          user: req.user,
          id: s.id,
          qr: s.qr,
          scannedAt: s.scannedAt,
          mode: 'offline',
          deviceResult: str(s.deviceResult, { max: 40 }),
        });
        return out.scan.id;
      }),
    );
    touchDevice(db, device, { queuedCount: req.body.queuedCount ?? 0, synced: true });
    const views = results.map((sid) => scanView(db, db.get('SELECT * FROM scan_events WHERE id = ?', sid)));
    res.json({ results: views, conflicts: views.filter((v) => v.conflict).length });
  });

  // Find a person when their QR will not scan. Returns the least needed to pick the right one.
  r.get('/gate/lookup', (req, res) => {
    const gate = gateAccess(db, req, id(req.query.gateId), 'gate.lookup');
    const q = str(req.query.q, { max: 80, required: true, name: 'Search' }).toLowerCase();
    if (q.length < 2) fail(400, 'Type at least 2 characters');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const rows = db.all(
      `SELECT p.id, p.holder_name, p.holder_company, p.status, c.name AS class_name, r.ref, r.email,
              (SELECT MAX(scanned_at) FROM scan_events s WHERE s.pass_id = p.id AND s.counted = 1) AS admitted_at
       FROM passes p
       JOIN pass_classes c ON c.id = p.pass_class_id
       LEFT JOIN registrations r ON r.id = p.registration_id
       WHERE p.event_id = ? AND (lower(p.holder_name) LIKE ? OR lower(COALESCE(p.holder_company,'')) LIKE ?
             OR lower(COALESCE(r.ref,'')) LIKE ? OR lower(COALESCE(r.email,'')) = ? OR COALESCE(r.phone,'') LIKE ?)
       ORDER BY p.holder_name LIMIT 25`,
      gate.event_id,
      like,
      like,
      like,
      q,
      like,
    );
    const mask = (e) => (e ? e.replace(/^(.).*(@.*)$/, '$1•••$2') : null);
    res.json(
      rows.map((p) => ({
        passId: p.id,
        name: p.holder_name,
        company: p.holder_company,
        passClass: p.class_name,
        status: p.status,
        ref: p.ref,
        email: mask(p.email),
        admittedAt: p.admitted_at,
      })),
    );
  });

  // Admits someone the rules refused. Restricted to supervisors, needs a reason, always audited.
  r.post('/gate/override', (req, res) => {
    const gate = gateAccess(db, req, id(req.body.gateId), 'gate.override');
    const event = eventOf(gate);
    const reason = str(req.body.reason, { max: 300, required: true, name: 'Reason' });
    const pass = db.get('SELECT * FROM passes WHERE id = ? AND event_id = ?', id(req.body.passId), event.id);
    if (!pass) fail(404, 'Pass not found');
    const device = req.body.deviceId ? deviceFor(db, req, req.body.deviceId) : null;
    const out = db.tx(() =>
      recordScan(db, { event, gate, device, user: req.user, id: req.body.id, passId: pass.id, method: 'override', overrideReason: reason }),
    );
    audit(db, req, 'gate.override', { event, entity: 'pass', entityId: pass.id, detail: { gate: gate.name, holder: pass.holder_name, reason } });
    res.json(scanView(db, out.scan));
  });

  // ---------- badge printing ----------
  r.post('/gate/print', (req, res) => {
    const gate = gateAccess(db, req, id(req.body.gateId), 'gate.print');
    const event = eventOf(gate);
    const pass = db.get("SELECT * FROM passes WHERE id = ? AND event_id = ? AND status = 'active'", id(req.body.passId), event.id);
    if (!pass) fail(404, 'Pass not found');
    let kind = 'first';
    let reason = null;
    if (alreadyPrinted(db, pass.id)) {
      // A second badge is a reprint: only authorised staff, and only with a reason.
      gateAccess(db, req, gate.id, 'gate.reprint');
      reason = str(req.body.reason, { max: 300, required: true, name: 'Reason for reprint' });
      kind = 'reprint';
    }
    const job = createPrintJob(db, adapters, { event, pass, gate, user: req.user, kind, reason });
    if (kind === 'reprint')
      audit(db, req, 'badge.reprint', { event, entity: 'pass', entityId: pass.id, detail: { holder: pass.holder_name, reason, gate: gate.name } });
    res.status(201).json(jobOut(job));
  });

  r.get('/gate/print-jobs', (req, res) => {
    const gate = gateAccess(db, req, id(req.query.gateId), 'gate.print');
    res.json(printJobs(db, gate.event_id, 'AND j.gate_id = ?', gate.id).slice(0, 50).map(jobOut));
  });

  const ownJob = (req, perm) => {
    const job = printJob(db, id(req.params.id));
    if (!job) fail(404, 'Print job not found');
    gateAccess(db, req, job.gate_id, perm);
    return job;
  };
  r.post('/gate/print-jobs/:id/retry', (req, res) => {
    res.json(jobOut(retryPrintJob(db, adapters, ownJob(req, 'gate.print'))));
  });
  r.post('/gate/print-jobs/:id/spare', (req, res) => {
    const job = ownJob(req, 'gate.print');
    const out = printOnSpare(db, adapters, job, req.user);
    audit(db, req, 'badge.spare_printer', { event: db.get('SELECT * FROM events WHERE id = ?', job.event_id), entity: 'print_job', entityId: job.id, detail: { holder: job.holder_name, failedWith: job.error } });
    res.json(jobOut(out));
  });

  // Print station (the Windows app next to a badge printer): take the next queued job, print
  // it, report the outcome. Used when PRINTER_ADAPTER=station.
  r.post('/gate/print-jobs/claim', (req, res) => {
    const gate = gateAccess(db, req, id(req.body.gateId), 'gate.print');
    const event = eventOf(gate);
    const job = db.tx(() => {
      const next = db.get("SELECT id FROM print_jobs WHERE event_id = ? AND gate_id = ? AND status = 'queued' ORDER BY id LIMIT 1", event.id, gate.id);
      if (!next) return null;
      db.run("UPDATE print_jobs SET status = 'printing', attempts = attempts + 1, updated_at = ? WHERE id = ?", nowIso(), next.id);
      return printJob(db, next.id);
    });
    if (!job) return res.json({ job: null });
    const pass = db.get('SELECT * FROM passes WHERE id = ?', job.pass_id);
    res.json({ job: jobOut(job), badge: { name: pass.holder_name, company: pass.holder_company, passClass: job.class_name, qr: qrFor(event, pass.token_id), event: event.name } });
  });
  r.post('/gate/print-jobs/:id/result', (req, res) => {
    const job = ownJob(req, 'gate.print');
    if (job.status !== 'printing') fail(409, 'This job is not printing');
    const ok = Boolean(req.body.ok);
    db.run('UPDATE print_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?', ok ? 'printed' : 'failed', ok ? null : str(req.body.error, { max: 200 }) || 'Printer error', nowIso(), job.id);
    res.json(jobOut(printJob(db, job.id)));
  });

  // What a badge shows, for printing from the browser or the Windows app.
  r.get('/gate/badge/:passId', (req, res) => {
    const gate = gateAccess(db, req, id(req.query.gateId), 'gate.print');
    const event = eventOf(gate);
    const pass = db.get(
      `SELECT p.*, c.name AS class_name FROM passes p JOIN pass_classes c ON c.id = p.pass_class_id
       WHERE p.id = ? AND p.event_id = ? AND p.status = 'active'`,
      id(req.params.passId),
      event.id,
    );
    if (!pass) fail(404, 'Pass not found');
    res.json({ name: pass.holder_name, company: pass.holder_company, passClass: pass.class_name, qr: qrFor(event, pass.token_id), event: event.name });
  });

  return r;
}
