// Booking calendar timeline.
import { date, int } from '../../core/validate.js';
import { perm, propertyOf } from '../../core/http.js';
import { addDays } from '../../core/dates.js';
import { can } from '../../core/permissions.js';
import { timeline } from './service.js';

export default function calendarRoutes(r, { db }) {
  r.get('/calendar', perm('reservations.view'), (req, res) => {
    const pid = propertyOf(db, req);
    const bd = db.value('SELECT business_date FROM properties WHERE id = ?', pid);
    const from = date(req.query.from) || addDays(bd, -2);
    const days = int(req.query.days, { min: 1, max: 62 }) || 14;
    const t = timeline(db, pid, from, days);
    if (!can(req.user, 'folio.view'))
      for (const s of [...t.segments, ...t.unassigned]) {
        s.totalMinor = null;
        s.balanceMinor = null;
      }
    res.json(t);
  });
}
