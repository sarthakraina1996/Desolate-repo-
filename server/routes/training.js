// Training: the course catalogue, assigning courses, people's progress, and HR / manager tracking.
import path from 'node:path';
import fs from 'node:fs';
import {
  audit,
  canSeeEmployee,
  date,
  fail,
  fullName,
  id,
  isHR,
  notFound,
  notifyUsers,
  num,
  oneOf,
  requireHR,
  scopeIds,
  sendCsv,
  str,
  today,
  userIdForEmployee,
} from '../core.js';
import {
  CATEGORIES,
  FORMATS,
  assignCourse,
  assignmentRow,
  courseRow,
  statusOf,
} from '../services/training.js';

// Assignment columns joined with the course and the employee, used by several queries.
const ASSIGNMENT_SELECT = `SELECT a.*, t.title, t.category, t.format, t.mandatory, t.needs_certificate, t.system_key,
  t.session_at, t.venue, t.duration_min,
  e.first_name, e.last_name, e.code, e.designation, e.photo IS NOT NULL AS has_photo, d.name AS department
  FROM training_assignments a JOIN trainings t ON t.id = a.training_id
  JOIN employees e ON e.id = a.employee_id LEFT JOIN departments d ON d.id = e.department_id`;

// "true"/"1"/true from a form or JSON body.
const yes = (v) => v === true || v === 'true' || v === '1' || v === 1 || v === 'on';

// Only real web links, so a course link can't run script when clicked.
function webLink(v) {
  const s = str(v, { max: 500 });
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    fail(400, 'Link must be a full web address, starting with https://');
  }
  if (!['http:', 'https:'].includes(u.protocol)) fail(400, 'Link must start with https://');
  return u.toString();
}

// What a new course starts as, for fields the form leaves out.
const NEW_COURSE = {
  category: 'Skills',
  format: 'Online course',
  description: null,
  content: null,
  link: null,
  session_at: null,
  venue: null,
  duration_min: null,
  due_days: null,
  policy_id: null,
  mandatory: 0,
  open_enrol: 0,
  auto_new_joiners: 0,
  needs_certificate: 0,
};

// Managers and HR see their people's progress; everyone else only their own.
const canTrack = (user) => isHR(user) || user.role === 'manager';

export default function trainingRoutes(r, { db, uploads, upload }) {
  const T = () => today(db);
  const materialUpload = upload('training', {
    maxMb: 25,
    exts: ['.pdf', '.ppt', '.pptx', '.doc', '.docx', '.xls', '.xlsx'],
  }).single('file');
  const certificateUpload = upload('certificates', {
    maxMb: 10,
    exts: ['.pdf', '.jpg', '.jpeg', '.png'],
  }).single('certificate');

  // Reads and checks a course from the form; `prev` fills fields left out (defaults when new).
  function readCourse(b, prev = NEW_COURSE) {
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
    const pick = (k, fn) => (has(k) ? fn(b[k]) : prev[k]);
    const c = {
      title: pick('title', (v) => str(v, { required: true, max: 120, name: 'Title' })),
      category: pick('category', (v) => oneOf(v || 'Skills', CATEGORIES, { name: 'Category' })),
      format: pick('format', (v) => oneOf(v || 'Online course', FORMATS, { name: 'Format' })),
      description: pick('description', (v) => str(v, { max: 1000 })),
      content: pick('content', (v) => str(v, { max: 50000 })),
      link: pick('link', webLink),
      session_at: pick('session_at', (v) => {
        const s = str(v, { max: 16 });
        if (s && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s))
          fail(400, 'Choose the session date and time');
        return s || null;
      }),
      venue: pick('venue', (v) => str(v, { max: 120 })),
      duration_min: pick('duration_min', (v) =>
        v === '' || v == null ? null : num(v, { min: 1, max: 10000, int: true, name: 'Duration' }),
      ),
      due_days: pick('due_days', (v) =>
        v === '' || v == null
          ? null
          : num(v, { min: 1, max: 365, int: true, name: 'Days to complete' }),
      ),
      policy_id: pick('policy_id', (v) => {
        if (!v) return null;
        const pid = id(v);
        if (!db.value('SELECT 1 FROM policies WHERE id = ?', pid)) fail(400, 'Unknown policy');
        return pid;
      }),
      mandatory: pick('mandatory', (v) => (yes(v) ? 1 : 0)),
      open_enrol: pick('open_enrol', (v) => (yes(v) ? 1 : 0)),
      auto_new_joiners: pick('auto_new_joiners', (v) => (yes(v) ? 1 : 0)),
      needs_certificate: pick('needs_certificate', (v) => (yes(v) ? 1 : 0)),
    };
    if (!c.title) fail(400, 'Title is required');
    // Each format needs its own details
    if (['Online course', 'Video'].includes(c.format) && !c.link)
      fail(400, `Add the ${c.format === 'Video' ? 'video' : 'course'} link`);
    if (c.format === 'Classroom' && !c.session_at) fail(400, 'Add the session date and time');
    return c;
  }

  // Loads a course or 404s.
  const course = (cid) =>
    db.get('SELECT * FROM trainings WHERE id = ?', id(cid)) || notFound('Training');

  // Loads an assignment with course and employee, or 404s.
  const assignment = (aid) =>
    db.get(`${ASSIGNMENT_SELECT} WHERE a.id = ?`, id(aid)) || notFound('Training');

  // The signed-in person's trainings, newest first, with counts for the summary cards.
  r.get('/training/mine', (req, res) => {
    const t = T();
    const items = req.user.employeeId
      ? db
          .all(
            `${ASSIGNMENT_SELECT} WHERE a.employee_id = ? ORDER BY a.completed_at IS NOT NULL, a.due_date IS NULL, a.due_date, a.assigned_at DESC`,
            req.user.employeeId,
          )
          .map((a) => assignmentRow(a, t))
      : [];
    const count = (s) => items.filter((a) => a.status === s).length;
    res.json({
      items,
      summary: {
        toDo: items.length - count('Completed'),
        overdue: count('Overdue'),
        inProgress: count('In progress'),
        completed: count('Completed'),
        hours:
          Math.round(
            (items
              .filter((a) => a.status === 'Completed')
              .reduce((h, a) => h + (a.duration_min || 0), 0) /
              60) *
              10,
          ) / 10,
      },
    });
  });

  // The course catalogue. HR also sees archived courses; HR and managers get people counts.
  r.get('/training/courses', (req, res) => {
    const t = T();
    const scope = scopeIds(db, req.user);
    const rows = db.all(
      `SELECT * FROM trainings ${isHR(req.user) ? '' : 'WHERE active = 1'} ORDER BY system_key IS NULL, active DESC, title`,
    );
    const mine = new Map(
      req.user.employeeId
        ? db
            .all('SELECT * FROM training_assignments WHERE employee_id = ?', req.user.employeeId)
            .map((a) => [a.training_id, a])
        : [],
    );
    res.json({
      items: rows.map((c) => {
        const base = canTrack(req.user)
          ? courseRow(db, c, t, scope)
          : { ...c, builtIn: Boolean(c.system_key) };
        const a = mine.get(c.id);
        return { ...base, mine: a ? { id: a.id, status: statusOf(a, t) } : null };
      }),
      categories: CATEGORIES,
      formats: FORMATS,
    });
  });

  // One course: details, my progress, and (HR / managers) the people in their scope taking it.
  r.get('/training/courses/:id', (req, res) => {
    const t = T();
    const c = course(req.params.id);
    if (!c.active && !isHR(req.user)) notFound('Training');
    const scope = scopeIds(db, req.user);
    const mine = req.user.employeeId
      ? db.get(
          'SELECT * FROM training_assignments WHERE training_id = ? AND employee_id = ?',
          c.id,
          req.user.employeeId,
        )
      : null;
    const people = canTrack(req.user)
      ? db
          .all(
            `${ASSIGNMENT_SELECT} WHERE a.training_id = ? AND e.status != 'Exited'
             ${scope ? `AND a.employee_id IN (${scope.map(() => '?').join(',') || 'NULL'})` : ''}
             ORDER BY a.completed_at IS NOT NULL, a.due_date, e.first_name`,
            c.id,
            ...(scope || []),
          )
          .map((a) => assignmentRow(a, t))
      : null;
    const policy = c.policy_id
      ? db.get('SELECT id, title, version FROM policies WHERE id = ?', c.policy_id)
      : null;
    res.json({
      course: canTrack(req.user)
        ? courseRow(db, c, t, scope)
        : { ...c, builtIn: Boolean(c.system_key) },
      mine: mine ? assignmentRow(mine, t) : null,
      people,
      policy,
    });
  });

  // Creates a course (HR only), with an optional file (slides, handbook).
  r.post('/training/courses', materialUpload, (req, res) => {
    requireHR(req);
    const data = readCourse(req.body);
    if (data.format === 'Reading' && !data.content && !req.file)
      fail(400, 'Add the reading text or attach a file');
    const cid = db.insert('trainings', {
      ...data,
      file: req.file?.filename || null,
      file_name: req.file?.originalname?.slice(0, 120) || null,
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    });
    audit(db, req.user, 'training.create', 'training', cid);
    res.json({ id: cid });
  });

  // Edits a course (HR only); a new file replaces the old one.
  r.put('/training/courses/:id', materialUpload, (req, res) => {
    requireHR(req);
    const c = course(req.params.id);
    const data = readCourse(req.body, c);
    // Built-in courses stay in their format, mandatory and given to every new joiner
    if (c.system_key) Object.assign(data, { format: c.format, mandatory: 1, auto_new_joiners: 1 });
    if (req.file) {
      if (c.file)
        fs.rm(path.join(uploads, 'training', path.basename(c.file)), { force: true }, () => {});
      data.file = req.file.filename;
      data.file_name = req.file.originalname.slice(0, 120);
    }
    if (data.format === 'Reading' && !data.content && !data.file && !c.file)
      fail(400, 'Add the reading text or attach a file');
    db.update('trainings', c.id, data);
    audit(db, req.user, 'training.edit', 'training', c.id);
    res.json({ ok: true });
  });

  // Archives or restores a course (HR only). People keep what they completed.
  r.post('/training/courses/:id/active', (req, res) => {
    requireHR(req);
    const c = course(req.params.id);
    if (c.system_key) fail(400, 'Built-in courses stay active');
    const active = yes(req.body.active) ? 1 : 0;
    db.update('trainings', c.id, { active });
    audit(db, req.user, active ? 'training.restore' : 'training.archive', 'training', c.id);
    res.json({ ok: true, active });
  });

  // The course's attached file (slides, handbook), for anyone signed in.
  r.get('/training/courses/:id/material', (req, res) => {
    const c = course(req.params.id);
    if (!c.file) notFound('File');
    const file = path.join(uploads, 'training', path.basename(c.file));
    if (!fs.existsSync(file)) notFound('File');
    res.download(file, c.file_name || `${c.title}${path.extname(c.file)}`);
  });

  // Assigns a course with a due date. HR: everyone, a department, a vertical or chosen people.
  // Managers: chosen people in their own team.
  r.post('/training/courses/:id/assign', (req, res) => {
    if (!canTrack(req.user)) fail(403, 'Only HR and managers can assign training');
    const c = course(req.params.id);
    if (!c.active) fail(400, 'This course is archived');
    const to = oneOf(req.body.to || 'people', ['everyone', 'department', 'vertical', 'people'], {
      name: 'Assign to',
    });
    if (to !== 'people') requireHR(req);
    const dueDate = date(req.body.due_date, { name: 'Due date' });
    const t = T();
    if (dueDate && dueDate < t) fail(400, 'Choose a due date from today onwards');
    let ids;
    if (to === 'everyone')
      ids = db.all("SELECT id FROM employees WHERE status != 'Exited'").map((e) => e.id);
    else if (to === 'department' || to === 'vertical')
      ids = db
        .all(
          `SELECT id FROM employees WHERE status != 'Exited' AND ${to === 'department' ? 'department_id' : 'vertical_id'} = ?`,
          id(req.body.group_id),
        )
        .map((e) => e.id);
    else {
      ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(id);
      if (!ids.length) fail(400, 'Choose who should take it');
      for (const eid of ids)
        if (!canSeeEmployee(db, req.user, eid) || (eid === req.user.employeeId && !isHR(req.user)))
          fail(403, 'You can assign training only to your own team');
      const exited = db.value(
        `SELECT COUNT(*) FROM employees WHERE status = 'Exited' AND id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      );
      if (exited) fail(400, 'Someone you chose has left the company');
    }
    const added = db.tx(() => assignCourse(db, c, ids, { dueDate, by: req.user.id, today: t }));
    audit(db, req.user, 'training.assign', 'training', c.id, { to, added });
    res.json({ ok: true, added, already: ids.length - added });
  });

  // Signs yourself up for an optional course that's open to everyone.
  r.post('/training/courses/:id/enrol', (req, res) => {
    if (!req.user.employeeId) fail(400, 'Your login is not linked to an employee record');
    const c = course(req.params.id);
    if (!c.active || !c.open_enrol)
      fail(400, 'This course is by invitation; ask HR or your manager');
    assignCourse(db, c, [req.user.employeeId], { by: req.user.id, today: T(), notify: false });
    res.json({ ok: true });
  });

  // Reminds everyone in the user's scope who hasn't finished this course (HR or managers).
  r.post('/training/courses/:id/remind', (req, res) => {
    if (!canTrack(req.user)) fail(403, 'Only HR and managers can send reminders');
    const c = course(req.params.id);
    const scope = scopeIds(db, req.user);
    const pending = db.all(
      `SELECT a.employee_id, a.due_date FROM training_assignments a JOIN employees e ON e.id = a.employee_id
       WHERE a.training_id = ? AND a.completed_at IS NULL AND e.status != 'Exited'
       ${scope ? `AND a.employee_id IN (${scope.map(() => '?').join(',') || 'NULL'})` : ''}`,
      c.id,
      ...(scope || []),
    );
    for (const p of pending)
      notifyUsers(
        db,
        [userIdForEmployee(db, p.employee_id)],
        `Reminder: please finish "${c.title}"${p.due_date && p.due_date < T() ? ' (overdue)' : ''}`,
        `/training?open=${c.id}`,
      );
    res.json({ ok: true, sent: pending.length });
  });

  // Marks your own course as started (opening an online course or video).
  r.post('/training/assignments/:id/start', (req, res) => {
    const a = assignment(req.params.id);
    if (a.employee_id !== req.user.employeeId) fail(403, 'This training is not yours');
    if (!a.started_at && !a.completed_at)
      db.run(
        'UPDATE training_assignments SET started_at = ? WHERE id = ?',
        new Date().toISOString(),
        a.id,
      );
    res.json({ ok: true });
  });

  // Marks a course complete. People finish their own (with a certificate when the course asks
  // for one); classroom sessions are marked by HR or the manager, who can also mark anyone in scope.
  r.post('/training/assignments/:id/complete', certificateUpload, (req, res) => {
    const a = assignment(req.params.id);
    const own = a.employee_id === req.user.employeeId;
    const onBehalf = !own && canTrack(req.user) && canSeeEmployee(db, req.user, a.employee_id);
    if (!own && !onBehalf) fail(403, 'You can only complete your own training');
    if (own && !isHR(req.user) && a.format === 'Classroom')
      fail(400, 'Classroom sessions are marked complete by HR or your manager after you attend');
    if (a.completed_at) fail(409, 'Already completed');
    if (own && a.needs_certificate && !req.file) fail(400, 'Attach your certificate to finish');
    db.run(
      `UPDATE training_assignments SET completed_at = ?, completed_by = ?, started_at = COALESCE(started_at, ?),
       certificate = COALESCE(?, certificate), certificate_name = COALESCE(?, certificate_name) WHERE id = ?`,
      new Date().toISOString(),
      req.user.id,
      new Date().toISOString(),
      req.file?.filename || null,
      req.file?.originalname?.slice(0, 120) || null,
      a.id,
    );
    if (onBehalf) {
      notifyUsers(
        db,
        [userIdForEmployee(db, a.employee_id)],
        `"${a.title}" was marked complete for you`,
        '/training',
      );
      audit(db, req.user, 'training.complete', 'employee', a.employee_id, {
        training: a.training_id,
      });
    }
    res.json({ ok: true });
  });

  // Takes a course off someone (HR only). The built-in POSH course is required for everyone.
  r.delete('/training/assignments/:id', (req, res) => {
    requireHR(req);
    const a = assignment(req.params.id);
    if (a.system_key) fail(400, 'POSH awareness is required for everyone');
    if (a.certificate)
      fs.rm(
        path.join(uploads, 'certificates', path.basename(a.certificate)),
        { force: true },
        () => {},
      );
    db.run('DELETE FROM training_assignments WHERE id = ?', a.id);
    audit(db, req.user, 'training.unassign', 'employee', a.employee_id, {
      training: a.training_id,
    });
    res.json({ ok: true });
  });

  // A completion certificate, for its owner, HR, or their manager.
  r.get('/training/assignments/:id/certificate', (req, res) => {
    const a = assignment(req.params.id);
    if (
      a.employee_id !== req.user.employeeId &&
      !(canTrack(req.user) && canSeeEmployee(db, req.user, a.employee_id))
    )
      fail(403, 'You cannot open this certificate');
    if (!a.certificate) notFound('Certificate');
    const file = path.join(uploads, 'certificates', path.basename(a.certificate));
    if (!fs.existsSync(file)) notFound('Certificate');
    res.download(file, a.certificate_name || `certificate${path.extname(a.certificate)}`);
  });

  // HR and managers: completion across their people, each course's progress, and who is overdue.
  r.get('/training/tracking', (req, res) => {
    if (!canTrack(req.user)) fail(403, 'Only HR and managers can see training progress');
    const t = T();
    const scope = scopeIds(db, req.user);
    // Managers track their team, not themselves
    const team = scope ? scope.filter((x) => x !== req.user.employeeId) : null;
    const inScope = team ? `AND a.employee_id IN (${team.map(() => '?').join(',') || 'NULL'})` : '';
    const rows = db
      .all(
        `${ASSIGNMENT_SELECT} WHERE e.status != 'Exited' AND t.active = 1 ${inScope}`,
        ...(team || []),
      )
      .map((a) => assignmentRow(a, t));
    const completed = rows.filter((a) => a.status === 'Completed');
    const monthStart = `${t.slice(0, 7)}-01`;
    res.json({
      summary: {
        assigned: rows.length,
        completed: completed.length,
        completionPct: rows.length ? Math.round((completed.length / rows.length) * 100) : 0,
        overdue: rows.filter((a) => a.status === 'Overdue').length,
        completedThisMonth: completed.filter((a) => a.completed_at.slice(0, 10) >= monthStart)
          .length,
        people: new Set(rows.map((a) => a.employee_id)).size,
      },
      courses: db
        .all('SELECT * FROM trainings WHERE active = 1 ORDER BY system_key IS NULL, title')
        .map((c) => courseRow(db, c, t, team))
        .filter((c) => c.assigned > 0 || isHR(req.user)),
      overdue: rows
        .filter((a) => a.status === 'Overdue')
        .sort((x, y) => x.due_date.localeCompare(y.due_date))
        .slice(0, 100),
    });
  });

  // Everyone's training records in the user's scope as a spreadsheet (HR or managers).
  r.get('/training/export.csv', (req, res) => {
    if (!canTrack(req.user)) fail(403, 'Only HR and managers can export training records');
    const t = T();
    // Managers export their team, as on screen; HR everyone
    const scope = scopeIds(db, req.user)?.filter((x) => x !== req.user.employeeId) ?? null;
    const rows = db
      .all(
        `${ASSIGNMENT_SELECT} WHERE e.status != 'Exited' ${scope ? `AND a.employee_id IN (${scope.map(() => '?').join(',') || 'NULL'})` : ''} ORDER BY e.first_name, t.title`,
        ...(scope || []),
      )
      .map((a) => assignmentRow(a, t));
    sendCsv(res, `training-${t}.csv`, rows, [
      { label: 'Employee', value: (a) => fullName(a) },
      { label: 'Code', value: 'code' },
      { label: 'Department', value: 'department' },
      { label: 'Course', value: 'title' },
      { label: 'Category', value: 'category' },
      { label: 'Mandatory', value: (a) => (a.mandatory ? 'Yes' : 'No') },
      { label: 'Assigned', value: (a) => a.assigned_at.slice(0, 10) },
      { label: 'Due', value: 'due_date' },
      { label: 'Status', value: 'status' },
      { label: 'Completed', value: (a) => a.completed_at?.slice(0, 10) || '' },
    ]);
  });
}
