// Health, system status (business dates, sync outbox) and the audit trail.
import { perm } from '../../core/http.js';
import { propertyIds, propertyScope, inList } from '../../core/access.js';
import { outboxStatus } from '../../core/outbox.js';
import { int, str } from '../../core/validate.js';
import { MODULES } from './modules.js';

export function publicSystemRoutes(r, { db }) {
  r.get('/system/health', (_req, res) => {
    const version = db.value('SELECT MAX(version) FROM schema_migrations');
    res.json({ ok: true, schema: version, time: new Date().toISOString() });
  });
}

export default function systemRoutes(r, { db }) {
  r.get('/system/modules', (_req, res) => res.json(MODULES));
  r.get('/system/status', (req, res) => {
    const pids = propertyIds(db, req.user);
    res.json({
      mode: process.env.BHOS_MODE || 'central',
      sync: { ...outboxStatus(db, pids), transport: 'not configured (Phase 7)' },
      properties: pids.length
        ? db.all(
            `SELECT p.id, p.code, p.business_date, (SELECT MAX(completed_at) FROM night_audits n WHERE n.property_id = p.id AND n.status = 'completed') AS last_audit
             FROM properties p WHERE p.id IN ${inList(pids)}`,
            ...pids,
          )
        : [],
    });
  });
  r.get('/audit', perm('audit.view'), (req, res) => {
    const pids = propertyScope(db, req.user, req.query.property);
    const where = [`(a.property_id IN ${inList(pids)} OR (a.property_id IS NULL AND a.org_id = ?))`];
    const params = [...pids, req.user.orgId];
    if (req.query.entity) where.push('a.entity = ?') && params.push(str(req.query.entity, { max: 40 }));
    if (req.query.entityId) where.push('a.entity_id = ?') && params.push(int(req.query.entityId, { min: 1 }));
    if (req.query.action) where.push('a.action LIKE ?') && params.push(`${str(req.query.action, { max: 60 })}%`);
    const limit = int(req.query.limit, { min: 1, max: 200 }) || 50;
    const offset = int(req.query.offset, { min: 0 }) || 0;
    res.json({
      total: db.value(`SELECT COUNT(*) FROM audit_log a WHERE ${where.join(' AND ')}`, ...params),
      rows: db.all(
        `SELECT a.*, u.name AS user_name, p.code AS property_code FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN properties p ON p.id = a.property_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
      ),
    });
  });
}
