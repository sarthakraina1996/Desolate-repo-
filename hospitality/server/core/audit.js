// Append-only audit trail (the table rejects updates and deletes).
import { stamp } from './clock.js';
export function audit(db, actor, action, { entity, entityId, propertyId, before, after } = {}) {
  db.run(
    `INSERT INTO audit_log (org_id, property_id, user_id, action, entity, entity_id, before, after, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    actor?.orgId ?? null,
    propertyId ?? null,
    actor?.id ?? null,
    action,
    entity ?? null,
    entityId ?? null,
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    stamp(actor),
  );
}
