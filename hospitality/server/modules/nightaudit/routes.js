// Night audit: pre-checks, history and run.
import { perm, propertyOf } from '../../core/http.js';
import { bool } from '../../core/validate.js';
import { preChecks, runNightAudit } from './service.js';

export default function nightAuditRoutes(r, { db }) {
  r.get('/night-audit', perm('nightaudit.run'), (req, res) => {
    const pid = propertyOf(db, req);
    res.json({
      ...preChecks(db, pid),
      history: db.all(
        `SELECT n.*, u.name AS run_by_name FROM night_audits n LEFT JOIN users u ON u.id = n.run_by
         WHERE n.property_id = ? ORDER BY n.id DESC LIMIT 30`,
        pid,
      ).map((h) => ({ ...h, summary: h.summary ? JSON.parse(h.summary) : null })),
    });
  });
  r.post('/night-audit', perm('nightaudit.run'), (req, res) => {
    const pid = propertyOf(db, req);
    res.json(runNightAudit(db, req.user, pid, { autoNoShow: req.body?.autoNoShow === undefined ? true : bool(req.body.autoNoShow) }));
  });
}
