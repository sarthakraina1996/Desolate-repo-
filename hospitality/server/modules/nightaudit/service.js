// Night audit: closes the property's business day. Pre-checks list what blocks the close
// (departures still in house, arrivals not processed); the run marks remaining arrivals as
// no-shows (by policy), posts each in-house night's room charge (and package F&B component)
// exactly once, and advances the business date — all in one transaction, so an interrupted run
// leaves nothing half-posted and a re-run cannot double-post (dedupe keys).
import { stamp } from '../../core/clock.js';
import { conflict } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { addDays } from '../../core/dates.js';
import { loadProperty, markNoShow } from '../reservations/service.js';
import { postCharge } from '../folios/service.js';

export function preChecks(db, propertyId) {
  const prop = loadProperty(db, propertyId);
  const bd = prop.business_date;
  const name = "g.first_name || ' ' || g.last_name";
  return {
    businessDate: bd,
    departuresPending: db.all(
      `SELECT r.id, r.conf_no, ${name} AS guest FROM reservations r JOIN guests g ON g.id = r.guest_id
       WHERE r.property_id = ? AND r.status = 'in_house' AND r.departure <= ?`,
      propertyId,
      bd,
    ),
    arrivalsPending: db.all(
      `SELECT r.id, r.conf_no, ${name} AS guest, r.guarantee FROM reservations r JOIN guests g ON g.id = r.guest_id
       WHERE r.property_id = ? AND r.status = 'confirmed' AND r.arrival <= ?`,
      propertyId,
      bd,
    ),
    inHouse: db.value("SELECT COUNT(*) FROM reservations WHERE property_id = ? AND status = 'in_house'", propertyId),
    lastRun: db.get(
      "SELECT * FROM night_audits WHERE property_id = ? ORDER BY id DESC LIMIT 1",
      propertyId,
    ),
  };
}

// opts.hooks.beforeCommit lets tests simulate a crash mid-run.
export function runNightAudit(db, actor, propertyId, { autoNoShow = true, hooks = {} } = {}) {
  const started = stamp(actor);
  const prop = loadProperty(db, propertyId);
  const bd = prop.business_date;
  try {
    const summary = db.tx(() => {
      const checks = preChecks(db, propertyId);
      if (checks.departuresPending.length)
        conflict(`${checks.departuresPending.length} departure(s) are still in house; check them out or extend their stay`, {
          code: 'departures_pending',
          details: { reservations: checks.departuresPending },
        });
      if (checks.arrivalsPending.length && !autoNoShow)
        conflict(`${checks.arrivalsPending.length} arrival(s) have not checked in`, {
          code: 'arrivals_pending',
          details: { reservations: checks.arrivalsPending },
        });
      let noShows = 0;
      for (const a of checks.arrivalsPending) {
        markNoShow(db, actor, a.id);
        noShows++;
      }
      // Tonight's room and package postings for every in-house reservation.
      const stays = db.all(
        `SELECT r.id, r.is_complimentary, r.is_house_use, r.adults, n.rate_minor, rp.fnb_component_minor, rp.name AS plan_name
         FROM reservations r JOIN reservation_nights n ON n.reservation_id = r.id AND n.night = ?
         LEFT JOIN rate_plans rp ON rp.id = r.rate_plan_id
         WHERE r.property_id = ? AND r.status = 'in_house'`,
        bd,
        propertyId,
      );
      let posted = 0;
      let roomNet = 0;
      for (const s of stays) {
        if (s.is_complimentary || s.is_house_use || s.rate_minor <= 0) continue;
        const fnb = Math.min(s.rate_minor, (s.fnb_component_minor || 0) * s.adults);
        const room = postCharge(db, actor, {
          reservationId: s.id,
          chargeCode: 'ROOM',
          unitMinor: s.rate_minor - fnb,
          description: `Room charge ${bd}`,
          businessDate: bd,
          source: 'night_audit',
          dedupeKey: `room:${s.id}:${bd}`,
        });
        if (fnb > 0)
          postCharge(db, actor, {
            reservationId: s.id,
            chargeCode: 'BRKF',
            unitMinor: fnb,
            description: `${s.plan_name || 'Package'} — breakfast ${bd}`,
            businessDate: bd,
            source: 'night_audit',
            dedupeKey: `pkg:${s.id}:${bd}`,
          });
        if (!room.duplicate) {
          posted++;
          roomNet += room.net_minor;
        }
      }
      const result = { businessDate: bd, nextBusinessDate: addDays(bd, 1), roomsPosted: posted, roomRevenueMinor: roomNet, noShows, inHouse: stays.length };
      db.run('UPDATE properties SET business_date = ? WHERE id = ?', addDays(bd, 1), propertyId);
      db.insert('night_audits', {
        property_id: propertyId,
        business_date: bd,
        status: 'completed',
        started_at: started,
        completed_at: stamp(actor),
        run_by: actor?.id ?? null,
        summary: JSON.stringify(result),
      });
      audit(db, actor, 'night_audit.completed', { propertyId, after: result });
      emit(db, { propertyId, entity: 'night_audit', op: 'completed', payload: result });
      hooks.beforeCommit?.(result);
      return result;
    });
    return summary;
  } catch (e) {
    // The transaction rolled back; record the failed attempt outside it.
    db.insert('night_audits', {
      property_id: propertyId,
      business_date: bd,
      status: 'failed',
      started_at: started,
      completed_at: stamp(actor),
      run_by: actor?.id ?? null,
      error: e.message,
    });
    throw e;
  }
}
