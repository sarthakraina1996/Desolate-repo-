// Work sessions and short-hours follow-up.
//
// A day can have several sessions: check in, step out (check out or sign
// out), check in again. Coming back asks for the reason for the gap. The
// attendance row stays the day's summary (first check-in, last check-out,
// status) so the register, leave and payroll code keep working unchanged.
//
// From the next day, a working day with fewer hours than required becomes an
// hour_shortfalls row: the employee explains it, and their reporting manager
// or an administrator approves it (the day counts in full) or rejects it (the
// day becomes a half day).
import { getSettings, fullName, notifyUsers, userIdForEmployee } from '../core.js';
import * as D from '../lib/dates.js';
import { dayStatuses } from './calendar.js';

export const GAP_REASONS = ['Client meeting', 'Site / field visit', 'Lunch break', 'Personal work', 'Medical', 'Other'];
const HALF_DAY_MINUTES = 240;

const minutesBetween = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
export const fmtMinutes = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
export const dayLabel = (date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T00:00:00Z`));

// Days recorded before sessions existed (or by the demo seed) only have the
// attendance row; give them one session so every day reads the same way.
export function ensureSessions(db, employeeId, date) {
  if (db.value('SELECT COUNT(*) FROM work_sessions WHERE employee_id = ? AND date = ?', employeeId, date)) return;
  const att = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', employeeId, date);
  if (!att?.check_in) return;
  db.insert('work_sessions', { employee_id: employeeId, date, start_at: att.check_in, end_at: att.check_out, mode: att.status === 'WFH' ? 'wfh' : 'office', ended_by: att.check_out ? 'checkout' : null });
}

export function sessionsFor(db, employeeId, date) {
  const rows = db.all('SELECT * FROM work_sessions WHERE employee_id = ? AND date = ? ORDER BY start_at', employeeId, date);
  if (rows.length) return rows;
  const att = db.get('SELECT check_in, check_out, status FROM attendance WHERE employee_id = ? AND date = ?', employeeId, date);
  return att?.check_in ? [{ start_at: att.check_in, end_at: att.check_out, mode: att.status === 'WFH' ? 'wfh' : 'office', ended_by: att.check_out ? 'checkout' : null }] : [];
}

// Minutes worked in closed sessions (open sessions count up to `now` if given).
export function workedMinutes(sessions, now = null) {
  return sessions.reduce((t, s) => t + (s.end_at ? minutesBetween(s.start_at, s.end_at) : now ? minutesBetween(s.start_at, now) : 0), 0);
}

// Time away between sessions, with the reason given when the employee came back.
export function gapsOf(sessions) {
  const out = [];
  for (let i = 1; i < sessions.length; i++) {
    const prev = sessions[i - 1];
    if (!prev.end_at) continue;
    out.push({ from: prev.end_at, to: sessions[i].start_at, minutes: minutesBetween(prev.end_at, sessions[i].start_at), reason: sessions[i].gap_reason || null, note: sessions[i].gap_note || null, leftBy: prev.ended_by });
  }
  return out;
}

export function requiredMinutes(settings) {
  return Math.round(Number(settings.workHours || 8) * 60);
}

export function workdaySummary(db, employeeId, date, settings = getSettings(db)) {
  const sessions = sessionsFor(db, employeeId, date);
  const open = sessions.find((s) => !s.end_at) || null;
  const last = sessions[sessions.length - 1] || null;
  return {
    date,
    sessions: sessions.map((s) => ({ start: s.start_at, end: s.end_at, mode: s.mode, endedBy: s.ended_by, gapReason: s.gap_reason || null, gapNote: s.gap_note || null })),
    gaps: gapsOf(sessions),
    workedMinutes: workedMinutes(sessions),
    openSince: open?.start_at || null,
    mode: sessions[0]?.mode || null,
    awaySince: !open && last?.end_at ? last.end_at : null,
    // Signed out mid-day: the next sign-in asks for the reason and offers to resume.
    signedOutAway: Boolean(!open && last?.ended_by === 'signout'),
    requiredMinutes: requiredMinutes(settings),
  };
}

// Recomputes the day's attendance row from its sessions.
export function syncAttendance(db, employeeId, date, userId) {
  const sessions = db.all('SELECT * FROM work_sessions WHERE employee_id = ? AND date = ? ORDER BY start_at', employeeId, date);
  if (!sessions.length) return;
  const open = sessions.some((s) => !s.end_at);
  const base = sessions[0].mode === 'wfh' ? 'WFH' : 'P';
  const worked = workedMinutes(sessions);
  const status = !open && base === 'P' && worked < HALF_DAY_MINUTES ? 'HD' : base;
  const lastOut = open ? null : sessions[sessions.length - 1].end_at;
  db.run(`INSERT INTO attendance (employee_id, date, status, check_in, check_out, updated_by) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, date) DO UPDATE SET status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out, updated_by = excluded.updated_by`,
  employeeId, date, status, sessions[0].start_at, lastOut, userId ?? null);
}

export function startSession(db, { employeeId, date, mode, gapReason, gapNote, userId, now = new Date().toISOString() }) {
  ensureSessions(db, employeeId, date);
  const sessions = db.all('SELECT * FROM work_sessions WHERE employee_id = ? AND date = ? ORDER BY start_at', employeeId, date);
  if (sessions.some((s) => !s.end_at)) return { error: 'Your work clock is already running' };
  const returning = sessions.length > 0;
  if (returning && !gapReason) return { error: 'Tell us the reason for the gap before checking in again', needsReason: true };
  db.tx(() => {
    db.insert('work_sessions', {
      employee_id: employeeId, date, start_at: now,
      mode: returning ? sessions[0].mode : mode,
      gap_reason: returning ? gapReason : null,
      gap_note: returning ? gapNote || null : null,
    });
    syncAttendance(db, employeeId, date, userId);
  });
  return { ok: true, at: now, returning };
}

export function endSession(db, { employeeId, date, by = 'checkout', userId, now = new Date().toISOString() }) {
  ensureSessions(db, employeeId, date);
  const open = db.get('SELECT * FROM work_sessions WHERE employee_id = ? AND date = ? AND end_at IS NULL', employeeId, date);
  if (!open) return null;
  db.tx(() => {
    db.run('UPDATE work_sessions SET end_at = ?, ended_by = ? WHERE id = ?', now < open.start_at ? open.start_at : now, by, open.id);
    syncAttendance(db, employeeId, date, userId);
  });
  return { at: now, workedMinutes: workedMinutes(sessionsFor(db, employeeId, date)) };
}

// Sessions left running past midnight are closed at the end of that workday
// (or where they started, if that was later).
export function closeStaleSessions(db, today, settings = getSettings(db)) {
  const stale = db.all('SELECT * FROM work_sessions WHERE end_at IS NULL AND date < ?', today);
  for (const s of stale) {
    const end = D.zonedIso(s.date, settings.workdayEnd || '18:30', settings.timezone);
    db.run("UPDATE work_sessions SET end_at = ?, ended_by = 'auto' WHERE id = ?", end > s.start_at ? end : s.start_at, s.id);
    syncAttendance(db, s.employee_id, s.date, null);
  }
  // Older single check-ins with no check-out (no session rows yet).
  for (const a of db.all('SELECT employee_id, date FROM attendance WHERE check_in IS NOT NULL AND check_out IS NULL AND date < ?', today)) {
    ensureSessions(db, a.employee_id, a.date);
    const s = db.get('SELECT * FROM work_sessions WHERE employee_id = ? AND date = ? AND end_at IS NULL', a.employee_id, a.date);
    if (!s) continue;
    const end = D.zonedIso(a.date, settings.workdayEnd || '18:30', settings.timezone);
    db.run("UPDATE work_sessions SET end_at = ?, ended_by = 'auto' WHERE id = ?", end > s.start_at ? end : s.start_at, s.id);
    syncAttendance(db, a.employee_id, a.date, null);
  }
}

// Who approves an employee's short-hours explanation: their reporting
// manager, or the administrators when there is no manager with a login.
export function approverUserIds(db, employeeId) {
  const mgr = db.value('SELECT manager_id FROM employees WHERE id = ?', employeeId);
  const mgrUser = userIdForEmployee(db, mgr);
  if (mgrUser) return [mgrUser];
  return db.all("SELECT id FROM users WHERE role = 'admin' AND active = 1").map((r) => r.id);
}

export function canDecideShortfall(db, user, employeeId) {
  if (!user || user.employeeId === employeeId) return false;
  if (user.role === 'admin') return true;
  return Boolean(user.employeeId) && db.value('SELECT manager_id FROM employees WHERE id = ?', employeeId) === user.employeeId;
}

// Creates short-hours rows for working days before `today` (looking back
// `days` days). Idempotent. Notifies each employee once per new row.
export function generateShortfalls(db, { today, days = 7, employeeIds = null, notify = true, settings = getSettings(db) } = {}) {
  closeStaleSessions(db, today, settings);
  const from = D.addDays(today, -days);
  const to = D.addDays(today, -1);
  const required = requiredMinutes(settings);
  const grace = Number(settings.shortHoursGraceMinutes || 0);
  const where = ['a.date BETWEEN ? AND ?', 'a.check_in IS NOT NULL', "a.status IN ('P','WFH','HD')", 'NOT EXISTS (SELECT 1 FROM hour_shortfalls s WHERE s.employee_id = a.employee_id AND s.date = a.date)'];
  const params = [from, to];
  if (employeeIds) {
    if (!employeeIds.length) return [];
    where.push(`a.employee_id IN (${employeeIds.map(() => '?').join(',')})`);
    params.push(...employeeIds);
  }
  const candidates = db.all(`SELECT a.employee_id, a.date FROM attendance a WHERE ${where.join(' AND ')}`, ...params);
  if (!candidates.length) return [];
  const ids = [...new Set(candidates.map((c) => c.employee_id))];
  const emps = db.all(`SELECT * FROM employees WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const statuses = dayStatuses(db, emps, from, to, today, settings);
  const created = [];
  for (const c of candidates) {
    const day = statuses.get(c.employee_id)?.get(c.date);
    if (!day || !['P', 'WFH', 'HD'].includes(day.code)) continue; // holidays, weekly offs, leave
    const worked = workedMinutes(sessionsFor(db, c.employee_id, c.date));
    if (worked + grace >= required) continue;
    const sid = db.insert('hour_shortfalls', { employee_id: c.employee_id, date: c.date, worked_minutes: worked, required_minutes: required });
    created.push(sid);
    if (notify) {
      notifyUsers(db, [userIdForEmployee(db, c.employee_id)], `You worked ${fmtMinutes(worked)} of ${fmtMinutes(required)} on ${dayLabel(c.date)}. Please tell your manager why.`, '/attendance?tab=short');
    }
  }
  return created;
}

export function shortfallRow(db, s, user) {
  const e = db.get('SELECT id, first_name, last_name, code, designation, manager_id, photo FROM employees WHERE id = ?', s.employee_id);
  const sessions = sessionsFor(db, s.employee_id, s.date);
  const decider = s.decided_by ? db.get(`SELECT u.email, e.first_name, e.last_name FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = ?`, s.decided_by) : null;
  return {
    ...s,
    name: fullName(e),
    code: e?.code,
    designation: e?.designation,
    has_photo: Boolean(e?.photo),
    sessions: sessions.map((x) => ({ start: x.start_at, end: x.end_at, endedBy: x.ended_by })),
    gaps: gapsOf(sessions),
    decidedByName: decider ? (decider.first_name ? fullName(decider) : decider.email) : null,
    mine: s.employee_id === user.employeeId,
    canExplain: s.employee_id === user.employeeId && ['Awaiting explanation', 'Pending approval'].includes(s.status),
    canDecide: canDecideShortfall(db, user, s.employee_id) && ['Awaiting explanation', 'Pending approval'].includes(s.status),
  };
}
