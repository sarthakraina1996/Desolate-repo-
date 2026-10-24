// Housekeeping board, schedule, tasks (attendant + supervisor), room status, productivity.
import { fail } from '../../core/errors.js';
import { str, int, date, oneOf, bool } from '../../core/validate.js';
import { perm, propertyOf } from '../../core/http.js';
import { scopedRow } from '../../core/access.js';
import { can } from '../../core/permissions.js';
import { addDays } from '../../core/dates.js';
import { roomsWithStatus } from '../rooms/service.js';
import { assignTask, completeTask, createTask, generateSchedule, inspectRoom, inspectTask, listTasks, productivity, setRoomStatus, startTask, TASK_KINDS } from './service.js';

export default function housekeepingRoutes(r, { db }) {
  r.get('/housekeeping/board', perm('housekeeping.view'), (req, res) => {
    const pid = propertyOf(db, req);
    const status = roomsWithStatus(db, pid);
    const tasks = listTasks(db, pid, {});
    const counts = {};
    for (const room of status.rooms) counts[room.code] = (counts[room.code] || 0) + 1;
    res.json({
      ...status,
      tasks,
      counts,
      dnd: status.rooms.filter((x) => x.dnd).length,
      maintenanceRequired: status.rooms.filter((x) => x.maintenance_flag === 'required').length,
      inspectionRequired: Boolean(db.value('SELECT inspection_required FROM properties WHERE id = ?', pid)),
    });
  });

  r.get('/housekeeping/tasks', perm('housekeeping.view'), (req, res) => {
    const pid = propertyOf(db, req);
    const mine = bool(req.query.mine) || !can(req.user, 'housekeeping.assign');
    res.json(listTasks(db, pid, { date: date(req.query.date), status: req.query.status, attendantId: mine ? req.user.id : int(req.query.attendant, { min: 1 }) }));
  });

  r.get('/housekeeping/attendants', perm('housekeeping.view'), (req, res) => {
    const pid = propertyOf(db, req);
    res.json(
      db.all(
        `SELECT u.id, u.name, u.role FROM users u WHERE u.active = 1 AND u.org_id = ?
         AND u.role IN ('housekeeping_attendant','housekeeping_manager')
         AND (u.all_properties = 1 OR EXISTS (SELECT 1 FROM user_properties up WHERE up.user_id = u.id AND up.property_id = ?))
         ORDER BY u.role DESC, u.name`,
        req.user.orgId,
        pid,
      ),
    );
  });

  r.post('/housekeeping/schedule', perm('housekeeping.assign'), (req, res) => res.json(generateSchedule(db, req.user, propertyOf(db, req))));

  r.post('/housekeeping/tasks', perm('housekeeping.assign'), (req, res) => {
    const pid = propertyOf(db, req);
    const b = req.body || {};
    res.status(201).json(
      createTask(db, req.user, pid, {
        roomId: int(b.roomId, { required: true, min: 1, name: 'Room' }),
        kind: oneOf(b.kind, TASK_KINDS, { required: true, name: 'Task type' }),
        priority: int(b.priority, { min: 0, max: 2 }) || 0,
        notes: str(b.notes, { max: 500 }),
        attendantId: b.attendantId ? int(b.attendantId, { min: 1 }) : null,
      }),
    );
  });
  r.post('/housekeeping/tasks/:id/assign', perm('housekeeping.assign'), (req, res) => {
    const t = scopedRow(db, req.user, 'hk_tasks', int(req.params.id, { min: 1 }), 'Task');
    res.json(assignTask(db, req.user, t.id, int(req.body?.attendantId, { required: true, min: 1, name: 'Attendant' })));
  });
  r.post('/housekeeping/tasks/:id/start', perm('housekeeping.update'), (req, res) => {
    const t = scopedRow(db, req.user, 'hk_tasks', int(req.params.id, { min: 1 }), 'Task');
    res.json(startTask(db, req.user, t.id));
  });
  r.post('/housekeeping/tasks/:id/complete', perm('housekeeping.update'), (req, res) => {
    const t = scopedRow(db, req.user, 'hk_tasks', int(req.params.id, { min: 1 }), 'Task');
    res.json(completeTask(db, req.user, t.id, { notes: str(req.body?.notes, { max: 500 }), exception: str(req.body?.exception, { max: 500 }) }));
  });
  r.post('/housekeeping/tasks/:id/inspect', perm('housekeeping.inspect'), (req, res) => {
    const t = scopedRow(db, req.user, 'hk_tasks', int(req.params.id, { min: 1 }), 'Task');
    res.json(inspectTask(db, req.user, t.id, { pass: bool(req.body?.pass), notes: str(req.body?.notes, { max: 500 }) }));
  });

  r.put('/housekeeping/rooms/:id/status', perm('housekeeping.update'), (req, res) => {
    const room = scopedRow(db, req.user, 'rooms', int(req.params.id, { min: 1 }), 'Room');
    const b = req.body || {};
    if (b.hk_status === 'inspected') {
      if (!can(req.user, 'housekeeping.inspect')) fail(403, 'Only a supervisor can mark a room inspected', { code: 'forbidden' });
      return res.json(inspectRoom(db, req.user, room));
    }
    res.json(
      setRoomStatus(db, req.user, room, {
        hk_status: b.hk_status !== undefined ? oneOf(b.hk_status, ['dirty', 'cleaning', 'clean'], { name: 'Status' }) : undefined,
        dnd: b.dnd !== undefined ? bool(b.dnd) : undefined,
        maintenance_flag: b.maintenance_flag !== undefined ? oneOf(b.maintenance_flag, ['ok', 'required']) : undefined,
        maintenance_note: str(b.maintenance_note, { max: 300 }),
        reason: str(b.reason, { max: 300 }),
      }),
    );
  });

  r.get('/housekeeping/productivity', perm('housekeeping.assign'), (req, res) => {
    const pid = propertyOf(db, req);
    const bd = db.value('SELECT business_date FROM properties WHERE id = ?', pid);
    res.json(productivity(db, pid, date(req.query.from) || addDays(bd, -30), date(req.query.to) || bd));
  });
}
