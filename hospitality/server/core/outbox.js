// Transactional outbox: domain services record an event in the same transaction as the change,
// so the hub can later publish exactly what happened, in order, even after an outage.
import { uuidv7 } from './ids.js';

// While db.bulkImport is set (loading history into a new hub) nothing is queued: imported
// history is treated as already known to HQ.
export function emit(db, { propertyId, entity, entityUid, op, payload, idempotencyKey }) {
  if (db.bulkImport) return;
  db.insert('sync_outbox', {
    uid: uuidv7(),
    property_id: propertyId ?? null,
    entity,
    entity_uid: entityUid ?? null,
    op,
    payload: JSON.stringify(payload ?? {}),
    idempotency_key: idempotencyKey ?? null,
  });
}

// Queue depth and last activity, for the online/offline indicator and system status.
export function outboxStatus(db, propertyIds = null) {
  const where = propertyIds ? `WHERE property_id IN (${propertyIds.map(() => '?').join(',') || 'NULL'})` : '';
  const params = propertyIds || [];
  const counts = Object.fromEntries(
    db
      .all(`SELECT status, COUNT(*) AS n FROM sync_outbox ${where} GROUP BY status`, ...params)
      .map((r) => [r.status, r.n]),
  );
  return {
    pending: counts.pending || 0,
    sent: counts.sent || 0,
    acked: counts.acked || 0,
    failed: counts.failed || 0,
    lastEventAt: db.value(`SELECT MAX(created_at) FROM sync_outbox ${where}`, ...params) || null,
    lastAckAt: db.value(`SELECT MAX(acked_at) FROM sync_outbox ${where}`, ...params) || null,
  };
}
