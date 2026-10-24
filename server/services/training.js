// Training rules shared by the routes, the seed and other modules: course status, assigning
// people, new-joiner courses, and the built-in POSH awareness course.
import { fullName, notifyUsers, userIdForEmployee } from '../core.js';
import * as D from '../lib/dates.js';

export const CATEGORIES = ['Induction', 'Compliance', 'Skills', 'Safety', 'Leadership', 'Product'];
export const FORMATS = ['Online course', 'Video', 'Classroom', 'Reading'];
const POSH_KEY = 'posh';

// The POSH awareness course that every employee takes on joining (moved here from the POSH page).
const POSH_COURSE = {
  system_key: POSH_KEY,
  title: 'POSH awareness',
  category: 'Compliance',
  format: 'Reading',
  description:
    'Prevention of Sexual Harassment at the workplace: what it is, where the policy applies, and how to raise a concern. About 10 minutes.',
  content: [
    '## What is sexual harassment?',
    'Any unwelcome act or behaviour, directly or by implication: physical contact or advances, a demand or request for sexual favours, sexually coloured remarks, showing pornography, or any other unwelcome physical, verbal or non-verbal conduct of a sexual nature.',
    '## Where does the policy apply?',
    'Everywhere you work for BrainADZ: offices, client sites, event venues, exhibition halls, travel, company parties, and online on email, chat and social media.',
    '## How do I raise a concern?',
    'Use "Raise a concern" on the POSH page or write to any ICC member. You can stay anonymous. Complaints should be made within 3 months of the incident (extendable by 3 months).',
    '## What happens next?',
    'The ICC acknowledges the complaint, hears both sides and completes the inquiry within 90 days. Interim relief such as a change of reporting line is possible. Everything is kept confidential.',
    '## What about retaliation?',
    'Retaliating against anyone who raises a concern or helps an inquiry is misconduct and is acted on.',
  ].join('\n\n'),
  duration_min: 10,
  mandatory: 1,
  auto_new_joiners: 1,
  due_days: 30,
};

// Assigned, In progress, Completed or Overdue, as of `today` (YYYY-MM-DD).
export function statusOf(a, today) {
  if (a.completed_at) return 'Completed';
  if (a.due_date && a.due_date < today) return 'Overdue';
  if (a.started_at) return 'In progress';
  return 'Assigned';
}

// Id of the built-in POSH course.
export const poshCourseId = (db) =>
  db.value('SELECT id FROM trainings WHERE system_key = ?', POSH_KEY);

// When this employee finished POSH awareness, or null.
export const poshCompletedAt = (db, employeeId) =>
  db.value(
    'SELECT a.completed_at FROM training_assignments a JOIN trainings t ON t.id = a.training_id WHERE t.system_key = ? AND a.employee_id = ?',
    POSH_KEY,
    employeeId,
  ) || null;

// How many current employees (optionally only these ids) have finished POSH awareness.
export function poshTrainedCount(db, ids = null) {
  if (ids && !ids.length) return 0;
  return db.value(
    `SELECT COUNT(*) FROM training_assignments a JOIN trainings t ON t.id = a.training_id
     JOIN employees e ON e.id = a.employee_id
     WHERE t.system_key = ? AND a.completed_at IS NOT NULL AND e.status != 'Exited'
     ${ids ? `AND e.id IN (${ids.map(() => '?').join(',')})` : ''}`,
    POSH_KEY,
    ...(ids || []),
  );
}

// Due date for someone given a course now (or when they joined, for new-joiner courses).
function dueFor(course, from) {
  return course.due_days ? D.addDays(from, course.due_days) : null;
}

// Gives a course to these employees (people who already have it are skipped) and tells them.
// Returns how many were newly assigned.
export function assignCourse(
  db,
  course,
  employeeIds,
  { dueDate = null, by = null, today, notify = true },
) {
  let added = 0;
  const now = new Date().toISOString();
  const due = dueDate || dueFor(course, today);
  for (const eid of [...new Set(employeeIds)]) {
    const r = db.run(
      `INSERT INTO training_assignments (training_id, employee_id, assigned_by, assigned_at, due_date)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(training_id, employee_id) DO NOTHING`,
      course.id,
      eid,
      by,
      now,
      due,
    );
    if (r.changes) {
      added++;
      if (notify)
        notifyUsers(
          db,
          [userIdForEmployee(db, eid)],
          `New training: ${course.title}${due ? `, due by ${D.parseYmd(due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}`,
          `/training?open=${course.id}`,
        );
    }
  }
  return added;
}

// Gives a new employee every active course set to go to new joiners, due from their joining date.
export function assignNewJoinerCourses(db, employeeId, { by = null, today }) {
  const e = db.get('SELECT id, join_date FROM employees WHERE id = ?', employeeId);
  if (!e) return;
  const start = e.join_date && e.join_date > today ? e.join_date : today;
  for (const c of db.all('SELECT * FROM trainings WHERE active = 1 AND auto_new_joiners = 1'))
    assignCourse(db, c, [e.id], { dueDate: dueFor(c, start), by, today });
}

// Makes sure the built-in POSH course exists, moves completions from the old POSH page across,
// and gives the course to every current employee who doesn't have it yet. Safe to run often.
export function ensureTraining(db, today) {
  db.tx(() => {
    let posh = db.get('SELECT * FROM trainings WHERE system_key = ?', POSH_KEY);
    if (!posh) {
      const policyId = db.value(
        "SELECT id FROM policies WHERE category = 'POSH' ORDER BY updated_at DESC LIMIT 1",
      );
      const tid = db.insert('trainings', {
        ...POSH_COURSE,
        policy_id: policyId || null,
        created_at: new Date().toISOString(),
      });
      posh = db.get('SELECT * FROM trainings WHERE id = ?', tid);
    }
    // Completions recorded before training had its own page
    for (const row of db.all('SELECT employee_id, completed_at FROM posh_training'))
      db.run(
        `INSERT INTO training_assignments (training_id, employee_id, assigned_at, completed_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(training_id, employee_id) DO UPDATE SET completed_at = excluded.completed_at`,
        posh.id,
        row.employee_id,
        row.completed_at,
        row.completed_at,
      );
    db.run('DELETE FROM posh_training');
    // Everyone working here needs it; existing staff get a month from today
    const missing = db
      .all(
        `SELECT e.id, e.join_date FROM employees e WHERE e.status != 'Exited' AND NOT EXISTS
         (SELECT 1 FROM training_assignments a WHERE a.training_id = ? AND a.employee_id = e.id)`,
        posh.id,
      )
      .map((e) => e);
    for (const e of missing) {
      const fromJoin = dueFor(posh, e.join_date || today);
      const due = fromJoin && fromJoin > today ? fromJoin : dueFor(posh, today);
      assignCourse(db, posh, [e.id], { dueDate: due, today, notify: false });
    }
  });
}

// A course row as the client sees it, with its people counts.
export function courseRow(db, c, today, scope = null) {
  const scopeSql = scope
    ? ` AND a.employee_id IN (${scope.map(() => '?').join(',') || 'NULL'})`
    : '';
  const counts = db.get(
    `SELECT COUNT(*) AS assigned,
       SUM(a.completed_at IS NOT NULL) AS completed,
       SUM(a.completed_at IS NULL AND a.due_date < ?) AS overdue
     FROM training_assignments a JOIN employees e ON e.id = a.employee_id
     WHERE a.training_id = ? AND e.status != 'Exited'${scopeSql}`,
    today,
    c.id,
    ...(scope || []),
  );
  return {
    ...c,
    builtIn: Boolean(c.system_key),
    assigned: counts.assigned || 0,
    completed: counts.completed || 0,
    overdue: counts.overdue || 0,
  };
}

// An assignment row with its status and the employee's name.
export const assignmentRow = (a, today) => ({
  ...a,
  name: a.first_name ? fullName(a) : undefined,
  status: statusOf(a, today),
});
