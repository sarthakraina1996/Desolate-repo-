// Gate scan rules. One implementation of "what does this scan mean?", used by the server when
// it reconciles scans, by the web scanner when it is offline, and by the tests. The Android
// (ScanRules.kt) and iOS (ScanRules.swift) scanners mirror this file line for line.

export const QR_PREFIX = 'BAE1';

// Every result a scan can have, with how staff should read it.
//   ok   - let the person in
//   warn - look again before deciding
//   deny - do not admit; route to the help desk
export const RESULTS = {
  admitted: { tone: 'ok', title: 'Pass accepted', hint: 'First entry today.' },
  reentry: { tone: 'ok', title: 'Re-entry accepted', hint: 'This pass allows re-entry.' },
  override_admitted: { tone: 'ok', title: 'Admitted by override', hint: 'Reason recorded.' },
  exit: { tone: 'ok', title: 'Exit recorded', hint: '' },
  repeat: {
    tone: 'warn',
    title: 'Already scanned',
    hint: 'This pass was scanned moments ago. Do not admit a second person on it.',
  },
  needs_online: {
    tone: 'warn',
    title: 'Needs an online check',
    hint: 'This area cannot be checked offline. Reconnect or send to the help desk.',
  },
  denied_reentry: {
    tone: 'deny',
    title: 'Already used',
    hint: 'This pass has been used and does not allow re-entry.',
  },
  denied_wrong_zone: {
    tone: 'deny',
    title: 'Wrong area',
    hint: 'This pass is not valid for this gate.',
  },
  denied_expired: { tone: 'deny', title: 'Pass expired', hint: 'This pass was for an earlier day.' },
  denied_not_yet_valid: {
    tone: 'deny',
    title: 'Not valid yet',
    hint: 'This pass starts on a later day.',
  },
  denied_revoked: {
    tone: 'deny',
    title: 'Pass cancelled',
    hint: 'This pass was cancelled or refunded.',
  },
  denied_unknown: {
    tone: 'deny',
    title: 'Pass not recognised',
    hint: 'This is not a pass for this event, or it was issued after the last sync.',
  },
};
export const isAdmit = (result) => result === 'admitted' || result === 'reentry' || result === 'override_admitted';

// Splits a QR payload into its opaque token id and signature. The QR carries no personal data.
export function parseQr(text) {
  const m = /^BAE1\.([A-Za-z0-9_-]{16,40})\.([A-Za-z0-9_-]{16,64})$/.exec(String(text || '').trim());
  return m ? { tokenId: m[1], signature: m[2] } : null;
}

// The calendar date of an instant in the event's timezone.
export function eventDay(timezone, at) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const pick = (t) => parts.find((p) => p.type === t).value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

// Decides one scan.
//   pass       { status: 'active' | 'revoked' } or null when the token is unknown
//   passClass  { zoneIds, validFrom, validTo, reentry }
//   zone       { id, restricted }
//   day        the scan's calendar date in the event timezone
//   scannedAt  ISO time of this scan
//   prior      earlier admitting scans of this pass in this zone on this day, oldest first,
//              each { scannedAt }
//   online     false on a device that cannot reach the server
export function decideScan({ pass, passClass, zone, day, scannedAt, prior = [], repeatWindowSeconds = 90, online = true }) {
  if (!pass || !passClass) return 'denied_unknown';
  if (pass.status !== 'active') return 'denied_revoked';
  if (day < passClass.validFrom) return 'denied_not_yet_valid';
  if (day > passClass.validTo) return 'denied_expired';
  if (!passClass.zoneIds.includes(zone.id)) return 'denied_wrong_zone';
  if (zone.restricted && !online) return 'needs_online';
  if (!prior.length) return 'admitted';
  const last = prior[prior.length - 1];
  const seconds = (Date.parse(scannedAt) - Date.parse(last.scannedAt)) / 1000;
  if (seconds < repeatWindowSeconds) return 'repeat';
  return passClass.reentry ? 'reentry' : 'denied_reentry';
}

// Decides a scan on an offline device from its preloaded eligibility set.
//   bundle   the verified payload from GET /gate/bundle
//   gate     { id, zoneId }
//   history  admitting scans this device has made or been told about:
//            [{ tokenId, zoneId, scannedAt }]
// Returns { result, name, passClass } so the scanner can show who was scanned.
export function decideOffline({ bundle, gate, history, tokenId, scannedAt }) {
  if (!bundle || Date.parse(bundle.expiresAt) < Date.parse(scannedAt))
    return { result: 'needs_online', name: null, passClass: null, expired: true };
  const entry = bundle.passes[tokenId];
  const zone = bundle.zones.find((z) => z.id === gate.zoneId) || { id: gate.zoneId, restricted: 0 };
  if (!entry) return { result: 'denied_unknown', name: null, passClass: null };
  const [classId, name, revoked] = entry;
  const passClass = bundle.classes.find((c) => c.id === classId) || null;
  const day = eventDay(bundle.timezone, scannedAt);
  const prior = history
    .filter(
      (h) =>
        h.tokenId === tokenId &&
        h.zoneId === gate.zoneId &&
        eventDay(bundle.timezone, h.scannedAt) === day &&
        Date.parse(h.scannedAt) <= Date.parse(scannedAt),
    )
    .sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));
  const result = decideScan({
    pass: { status: revoked ? 'revoked' : 'active' },
    passClass,
    zone,
    day,
    scannedAt,
    prior,
    repeatWindowSeconds: bundle.repeatWindowSeconds,
    online: false,
  });
  return { result, name, passClass: passClass?.name || null };
}

// A stable id for a scan, generated on the device so retries never create a second record.
export function newScanId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
