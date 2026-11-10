// Passes: the entitlement a confirmed registration or a team badge turns into, and its QR.
// The QR is a signed opaque reference ("BAE1.<token>.<signature>"); it holds no personal data.
import crypto from 'node:crypto';
import { json, isUniqueViolation } from '../db.js';
import { eventSettings, nowIso, randomToken, safeEqual } from '../core.js';
import { parseQr, QR_PREFIX } from '../../shared/scanRules.js';

// Signature over a token id with the event's secret, shortened to keep the QR easy to scan.
const signToken = (event, tokenId) => crypto.createHmac('sha256', event.qr_secret).update(tokenId).digest('base64url').slice(0, 22);

export const qrFor = (event, tokenId) => `${QR_PREFIX}.${tokenId}.${signToken(event, tokenId)}`;

// Resolves scanned text to a pass of this event. Returns null when the text is not a pass QR,
// the signature is wrong, or the pass belongs to another event.
export function passFromQr(db, event, text) {
  const parsed = parseQr(text);
  if (!parsed) return null;
  if (!safeEqual(parsed.signature, signToken(event, parsed.tokenId))) return null;
  return db.get('SELECT * FROM passes WHERE token_id = ? AND event_id = ?', parsed.tokenId, event.id) || null;
}

// Issues the pass for a registration or team badge. Safe to call twice: the UNIQUE index on
// registration_id / team_badge_id means a retry or a replayed payment returns the same pass.
export function issuePass(db, { event, passClassId, registrationId, teamBadgeId, name, company }) {
  const existing = registrationId
    ? db.get('SELECT * FROM passes WHERE registration_id = ?', registrationId)
    : db.get('SELECT * FROM passes WHERE team_badge_id = ?', teamBadgeId);
  if (existing) {
    if (existing.status === 'revoked') db.update('passes', existing.id, { status: 'active', revoked_at: null, revoked_reason: null });
    return db.get('SELECT * FROM passes WHERE id = ?', existing.id);
  }
  try {
    const id = db.insert('passes', {
      event_id: event.id,
      pass_class_id: passClassId,
      registration_id: registrationId ?? null,
      team_badge_id: teamBadgeId ?? null,
      token_id: randomToken(16),
      holder_name: name,
      holder_company: company ?? null,
      issued_at: nowIso(),
    });
    return db.get('SELECT * FROM passes WHERE id = ?', id);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return registrationId
      ? db.get('SELECT * FROM passes WHERE registration_id = ?', registrationId)
      : db.get('SELECT * FROM passes WHERE team_badge_id = ?', teamBadgeId);
  }
}

export function revokePass(db, passId, reason) {
  db.run(
    "UPDATE passes SET status = 'revoked', revoked_at = ?, revoked_reason = ? WHERE id = ? AND status = 'active'",
    nowIso(),
    reason,
    passId,
  );
}

// Pass classes of an event in the shape the scan rules use.
export function passClasses(db, eventId) {
  return db.all('SELECT * FROM pass_classes WHERE event_id = ? ORDER BY sort, id', eventId).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    kind: c.kind,
    mode: c.mode,
    zoneIds: json(c.zone_ids, []),
    validFrom: c.valid_from,
    validTo: c.valid_to,
    reentry: Boolean(c.reentry),
    leadScannable: Boolean(c.lead_scannable),
  }));
}

// Everything a holder's screen shows for a pass: QR, name, pass type, dates and where to enter.
export function passView(db, event, pass) {
  const cls = db.get('SELECT * FROM pass_classes WHERE id = ?', pass.pass_class_id);
  const zoneIds = json(cls.zone_ids, []);
  const zones = db
    .all('SELECT id, code, name, kind FROM zones WHERE event_id = ? ORDER BY sort, id', event.id)
    .filter((z) => zoneIds.includes(z.id));
  const gates = db
    .all(
      "SELECT g.code, g.name, g.zone_id FROM gates g WHERE g.event_id = ? AND g.active = 1 AND g.direction = 'in' ORDER BY g.code",
      event.id,
    )
    .filter((g) => zoneIds.includes(g.zone_id));
  const reg = pass.registration_id ? db.get('SELECT ref FROM registrations WHERE id = ?', pass.registration_id) : null;
  const admitted = db.get('SELECT MIN(scanned_at) AS first FROM scan_events WHERE pass_id = ? AND counted = 1', pass.id);
  return {
    id: pass.id,
    ref: reg?.ref || null,
    qr: pass.status === 'active' ? qrFor(event, pass.token_id) : null,
    status: pass.status,
    holderName: pass.holder_name,
    holderCompany: pass.holder_company,
    passClass: { code: cls.code, name: cls.name, kind: cls.kind },
    validFrom: cls.valid_from,
    validTo: cls.valid_to,
    reentry: Boolean(cls.reentry),
    zones: zones.map((z) => z.name),
    gates: gates.map((g) => g.name),
    instructions: eventSettings(event).gateInstructions,
    firstAdmittedAt: admitted?.first || null,
    issuedAt: pass.issued_at,
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      edition: event.edition,
      venueName: event.venue_name,
      city: event.city,
      startsOn: event.starts_on,
      endsOn: event.ends_on,
      openTime: event.open_time,
      closeTime: event.close_time,
      timezone: event.timezone,
    },
  };
}
