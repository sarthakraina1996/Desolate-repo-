// Housekeeping: cleanliness status per room (separate from occupancy and maintenance), daily
// task schedule, attendant workflow (start → complete) and supervisor inspection. Under an
// inspection policy a cleaned room is not ready for check-in until a supervisor passes it.
import { stamp } from '../../core/clock.js';
import { conflict, fail, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';
import { emit } from '../../core/outbox.js';
import { can } from '../../core/permissions.js';
import { roomsWithStatus } from '../rooms/service.js';

export const TASK_KINDS = ['departure', 'stayover', 'deep', 'turndown', 'touch_up'];

export function setRoomStatus(db, actor, room, { hk_status, dnd, maintenance_flag, maintenance_note, reason }) {
  return db.tx(() => {
    const changes = {};
    if (hk_status !== undefined && hk_status !== room.hk_status) {
      if (!['dirty', 'cleaning', 'clean', 'inspected'].includes(hk_status)) fail(400, 'Unknown housekeeping status');
      if (hk_status === 'inspected' && actor && !actor.system && !can(actor, 'housekeeping.inspect'))
        fail(403, 'Only a supervisor can mark a room inspected', { code: 'forbidden' });
      changes.hk_status = hk_status;
    }
    if (dnd !== undefined && Number(Boolean(dnd)) !== room.dnd) changes.dnd = dnd ? 1 : 0;
    if (maintenance_flag !== undefined && maintenance_flag !== room.maintenance_flag) {
      if (!['ok', 'required'].includes(maintenance_flag)) fail(400, 'Unknown maintenance flag');
      changes.maintenance_flag = maintenance_flag;
      changes.maintenance_note = maintenance_flag === 'required' ? maintenance_note || reason || null : null;
    }
    if (!Object.keys(changes).length) return room;
    db.update('rooms', room.id, { ...changes, version: room.version + 1, updated_at: stamp(actor) });
    for (const [field, to] of Object.entries(changes))
      if (field !== 'maintenance_note')
        db.run(
          'INSERT INTO room_status_log (room_id, field, from_value, to_value, reason, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          room.id,
          field,
          String(room[field]),
          String(to),
          reason ?? null,
          actor?.id ?? null,
          stamp(actor),
        );
    emit(db, { propertyId: room.property_id, entity: 'room', entityUid: room.uid, op: 'status', payload: changes });
    return db.get('SELECT * FROM rooms WHERE id = ?', room.id);
  });
}

export function createTask(db, actor, propertyId, { roomId, kind, priority = 0, notes, reservationId, attendantId, businessDate }) {
  if (!TASK_KINDS.includes(kind)) fail(400, 'Unknown task type');
  const room = db.get('SELECT * FROM rooms WHERE id = ? AND property_id = ?', roomId, propertyId);
  if (!room) notFound('Room');
  const bd = businessDate || db.value('SELECT business_date FROM properties WHERE id = ?', propertyId);
  const open = db.get(
    "SELECT * FROM hk_tasks WHERE room_id = ? AND business_date = ? AND kind = ? AND status IN ('open','in_progress')",
    roomId,
    bd,
    kind,
  );
  if (open) return open;
  if (attendantId) assertAttendant(db, propertyId, attendantId);
  const id = db.insert('hk_tasks', {
    property_id: propertyId,
    room_id: roomId,
    business_date: bd,
    kind,
    priority,
    notes: notes ?? null,
    reservation_id: reservationId ?? null,
    attendant_id: attendantId ?? null,
    created_by: actor?.id ?? null,
    created_at: stamp(actor),
  });
  const t = db.get('SELECT * FROM hk_tasks WHERE id = ?', id);
  emit(db, { propertyId, entity: 'hk_task', entityUid: t.uid, op: 'create', payload: { room: room.number, kind } });
  return t;
}

function assertAttendant(db, propertyId, userId) {
  const u = db.get(
    `SELECT u.id FROM users u WHERE u.id = ? AND u.active = 1 AND u.role IN ('housekeeping_attendant','housekeeping_manager')
     AND (u.all_properties = 1 OR EXISTS (SELECT 1 FROM user_properties up WHERE up.user_id = u.id AND up.property_id = ?))`,
    userId,
    propertyId,
  );
  if (!u) fail(400, 'Choose a housekeeping attendant at this property');
}

// Creates today's schedule: departure cleans for rooms due out and stayover service for
// in-house rooms that are not checking out. Existing tasks are kept.
export function generateSchedule(db, actor, propertyId) {
  return db.tx(() => {
    const { rooms, businessDate } = roomsWithStatus(db, propertyId);
    let created = 0;
    for (const r of rooms) {
      if (r.block) continue;
      if (r.occupant?.dueOut) {
        if (!db.value("SELECT 1 FROM hk_tasks WHERE room_id = ? AND business_date = ? AND kind = 'departure'", r.id, businessDate)) {
          createTask(db, actor, propertyId, { roomId: r.id, kind: 'departure', priority: r.arrival ? 1 : 0, reservationId: r.occupant.reservationId });
          created++;
        }
      } else if (r.occupied) {
        if (!db.value("SELECT 1 FROM hk_tasks WHERE room_id = ? AND business_date = ? AND kind = 'stayover'", r.id, businessDate)) {
          createTask(db, actor, propertyId, { roomId: r.id, kind: 'stayover', reservationId: r.occupant.reservationId });
          created++;
        }
      }
    }
    audit(db, actor, 'housekeeping.schedule', { propertyId, after: { created, businessDate } });
    return { created, businessDate };
  });
}

const loadTask = (db, id) => {
  const t = db.get('SELECT * FROM hk_tasks WHERE id = ?', id);
  if (!t) notFound('Task');
  return t;
};

export function assignTask(db, actor, taskId, attendantId) {
  const t = loadTask(db, taskId);
  if (['inspected', 'cancelled'].includes(t.status)) conflict('This task is finished');
  assertAttendant(db, t.property_id, attendantId);
  db.run('UPDATE hk_tasks SET attendant_id = ? WHERE id = ?', attendantId, taskId);
  audit(db, actor, 'housekeeping.assign', { entity: 'hk_task', entityId: taskId, propertyId: t.property_id, after: { attendantId } });
  return loadTask(db, taskId);
}

// Attendants may only work their own tasks; supervisors any task at the property.
function assertWorker(actor, t) {
  if (actor?.system || can(actor, 'housekeeping.assign')) return;
  if (t.attendant_id !== actor?.id) fail(403, 'This task is assigned to someone else', { code: 'forbidden' });
}

export function startTask(db, actor, taskId) {
  return db.tx(() => {
    const t = loadTask(db, taskId);
    assertWorker(actor, t);
    if (t.status !== 'open') conflict(`The task is ${t.status.replace('_', ' ')}`);
    const room = db.get('SELECT * FROM rooms WHERE id = ?', t.room_id);
    if (room.dnd) conflict(`Room ${room.number} is on Do Not Disturb`, { code: 'dnd' });
    db.run(
      "UPDATE hk_tasks SET status = 'in_progress', started_at = ?, attendant_id = COALESCE(attendant_id, ?) WHERE id = ?",
      stamp(actor),
      actor?.id ?? null,
      taskId,
    );
    setRoomStatus(db, actor, room, { hk_status: 'cleaning', reason: `${t.kind} clean started` });
    return loadTask(db, taskId);
  });
}

export function completeTask(db, actor, taskId, { notes, exception, now } = {}) {
  return db.tx(() => {
    const t = loadTask(db, taskId);
    assertWorker(actor, t);
    if (t.status !== 'in_progress') conflict('Start the task before completing it');
    const prop = db.get('SELECT inspection_required FROM properties WHERE id = ?', t.property_id);
    const end = now || stamp(actor);
    const minutes = Math.max(1, Math.round((Date.parse(end) - Date.parse(t.started_at)) / 60000));
    db.run(
      `UPDATE hk_tasks SET status = 'done', completed_at = ?, duration_minutes = ?, notes = COALESCE(?, notes), exception = ? WHERE id = ?`,
      end,
      minutes,
      notes ?? null,
      exception ?? null,
      taskId,
    );
    const room = db.get('SELECT * FROM rooms WHERE id = ?', t.room_id);
    // Without an inspection policy a cleaned room is ready straight away.
    setRoomStatus(db, actor, room, {
      hk_status: prop.inspection_required ? 'clean' : 'inspected',
      reason: `${t.kind} clean completed`,
      ...(exception ? { maintenance_flag: /maint|repair|broken|leak/i.test(exception) ? 'required' : undefined, maintenance_note: exception } : {}),
    });
    emit(db, { propertyId: t.property_id, entity: 'hk_task', entityUid: t.uid, op: 'complete', payload: { minutes } });
    return loadTask(db, taskId);
  });
}

// Supervisor inspection: pass makes the room ready; fail sends it back for re-cleaning.
export function inspectTask(db, actor, taskId, { pass, notes }) {
  return db.tx(() => {
    const t = loadTask(db, taskId);
    if (t.status !== 'done') conflict('Only a completed clean can be inspected');
    const room = db.get('SELECT * FROM rooms WHERE id = ?', t.room_id);
    if (pass) {
      db.run("UPDATE hk_tasks SET status = 'inspected', inspected_at = ?, supervisor_id = ? WHERE id = ?", stamp(actor), actor?.id ?? null, taskId);
      setRoomStatus(db, actor, room, { hk_status: 'inspected', reason: 'Passed inspection' });
    } else {
      if (!notes) fail(400, 'Say what needs re-doing');
      db.run(
        "UPDATE hk_tasks SET status = 'open', started_at = NULL, completed_at = NULL, duration_minutes = NULL, supervisor_id = ?, exception = ? WHERE id = ?",
        actor?.id ?? null,
        `Failed inspection: ${notes}`,
        taskId,
      );
      setRoomStatus(db, actor, room, { hk_status: 'dirty', reason: `Failed inspection: ${notes}` });
    }
    audit(db, actor, pass ? 'housekeeping.inspect_pass' : 'housekeeping.inspect_fail', { entity: 'hk_task', entityId: taskId, propertyId: t.property_id, after: { notes } });
    return loadTask(db, taskId);
  });
}

// Inspects a room directly (no task), e.g. a vacant clean room checked before an arrival.
export function inspectRoom(db, actor, room) {
  if (!['clean', 'inspected'].includes(room.hk_status)) conflict(`Room ${room.number} is ${room.hk_status}; it must be clean to inspect`);
  return setRoomStatus(db, actor, room, { hk_status: 'inspected', reason: 'Inspected' });
}

export function listTasks(db, propertyId, { date, status, attendantId } = {}) {
  const bd = date || db.value('SELECT business_date FROM properties WHERE id = ?', propertyId);
  const where = ['t.property_id = ?', 't.business_date = ?'];
  const params = [propertyId, bd];
  if (status) {
    const st = String(status).split(',');
    where.push(`t.status IN (${st.map(() => '?').join(',')})`);
    params.push(...st);
  }
  if (attendantId) where.push('t.attendant_id = ?') && params.push(attendantId);
  return db.all(
    `SELECT t.*, r.number AS room_number, r.hk_status, r.dnd, rt.code AS room_type_code, f.level AS floor_level,
            a.name AS attendant_name, s.name AS supervisor_name
     FROM hk_tasks t JOIN rooms r ON r.id = t.room_id JOIN room_types rt ON rt.id = r.room_type_id
     JOIN floors f ON f.id = r.floor_id LEFT JOIN users a ON a.id = t.attendant_id LEFT JOIN users s ON s.id = t.supervisor_id
     WHERE ${where.join(' AND ')} ORDER BY t.priority DESC, f.level, r.number`,
    ...params,
  );
}

// Productivity per attendant for a date range: tasks completed and average minutes per kind.
export function productivity(db, propertyId, from, to) {
  return db.all(
    `SELECT a.id AS attendant_id, a.name, t.kind, COUNT(*) AS tasks, ROUND(AVG(t.duration_minutes), 1) AS avg_minutes,
            SUM(CASE WHEN t.exception LIKE 'Failed inspection%' THEN 1 ELSE 0 END) AS failed_inspections
     FROM hk_tasks t JOIN users a ON a.id = t.attendant_id
     WHERE t.property_id = ? AND t.business_date >= ? AND t.business_date <= ? AND t.status IN ('done','inspected')
     GROUP BY a.id, t.kind ORDER BY a.name, t.kind`,
    propertyId,
    from,
    to,
  );
}
