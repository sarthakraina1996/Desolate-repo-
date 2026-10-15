// Working-calendar context (weekly offs + company holidays) and the derived
// day-by-day attendance status that leave, attendance and payroll all share.
import { getSettings } from '../core.js';
import { dow, eachDay, monthStart, monthEnd } from '../lib/dates.js';
import { isWorkingDay } from '../lib/leave.js';

export function calendarCtx(db, settings = getSettings(db)) {
  const holidays = new Set(db.all("SELECT date FROM holidays WHERE type = 'Company'").map((r) => r.date));
  return { weeklyOffs: settings.weeklyOffs, holidays };
}

export function holidayNames(db, from, to) {
  const map = new Map();
  for (const h of db.all('SELECT date, name, type FROM holidays WHERE date BETWEEN ? AND ?', from, to)) {
    if (h.type === 'Company' || !map.has(h.date)) map.set(h.date, h);
  }
  return map;
}

// Approved leave for the given employees over [from, to], expanded per day.
// Returns Map(employeeId -> Map(date -> { code, name, paid, kind, half }))
export function approvedLeaveDays(db, employeeIds, from, to, ctx) {
  const out = new Map();
  if (!employeeIds.length) return out;
  const rows = db.all(`
    SELECT r.employee_id, r.from_date, r.to_date, r.half_day, t.code, t.name, t.paid, t.kind, t.calendar_days, t.color
    FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
    WHERE r.status = 'Approved' AND r.from_date <= ? AND r.to_date >= ?
      AND r.employee_id IN (${employeeIds.map(() => '?').join(',')})`, to, from, ...employeeIds);
  for (const r of rows) {
    let m = out.get(r.employee_id);
    if (!m) out.set(r.employee_id, (m = new Map()));
    const start = r.from_date > from ? r.from_date : from;
    const end = r.to_date < to ? r.to_date : to;
    for (const d of eachDay(start, end)) {
      if (!r.calendar_days && !isWorkingDay(d, ctx)) continue;
      m.set(d, { code: r.code, name: r.name, paid: Boolean(r.paid), kind: r.kind, half: Boolean(r.half_day), color: r.color, calendar: Boolean(r.calendar_days) });
    }
  }
  return out;
}

// Status codes:
//   NA not employed · H holiday · WO weekly off · P present · WFH work from home
//   HD half day · A absent · U unmarked (past working day) · F upcoming working day
//   L  approved leave (leave.code holds CL/SL/EL/...)
export function dayStatuses(db, employees, from, to, today, settings = getSettings(db)) {
  const ctx = calendarCtx(db, settings);
  const ids = employees.map((e) => e.id);
  const leaves = approvedLeaveDays(db, ids, from, to, ctx);
  const records = new Map();
  if (ids.length) {
    for (const r of db.all(`SELECT * FROM attendance WHERE date BETWEEN ? AND ? AND employee_id IN (${ids.map(() => '?').join(',')})`, from, to, ...ids)) {
      let m = records.get(r.employee_id);
      if (!m) records.set(r.employee_id, (m = new Map()));
      m.set(r.date, r);
    }
  }
  const unmarkedAbsent = settings.payroll.unmarkedAs === 'absent';
  const days = eachDay(from, to);
  const result = new Map();
  for (const e of employees) {
    const m = new Map();
    const lv = leaves.get(e.id);
    const rec = records.get(e.id);
    for (const d of days) {
      const employed = d >= e.join_date && (!e.exit_date || d <= e.exit_date);
      const r = rec?.get(d);
      const leave = lv?.get(d);
      let s;
      if (!employed) s = { code: 'NA', lop: 0 };
      else if (leave && leave.calendar) s = { code: 'L', lop: leave.paid ? 0 : 1, leave };
      else if (ctx.holidays.has(d)) s = { code: 'H', lop: 0 };
      else if (ctx.weeklyOffs.includes(dow(d))) s = { code: 'WO', lop: 0 };
      else if (leave && leave.kind === 'wfh') s = { code: 'WFH', lop: 0, leave };
      else if (leave) {
        let lop = leave.paid ? 0 : leave.half ? 0.5 : 1;
        // Half-day leave: the other half follows the attendance mark.
        if (leave.half && r && r.status === 'A') lop += 0.5;
        s = { code: 'L', lop, leave };
      } else if (r) {
        s = { code: r.status, lop: r.status === 'A' ? 1 : r.status === 'HD' ? 0.5 : 0 };
      } else if (d < today) {
        s = { code: 'U', lop: unmarkedAbsent ? 1 : 0 };
      } else {
        s = { code: 'F', lop: 0 };
      }
      if (r) {
        s.checkIn = r.check_in;
        s.checkOut = r.check_out;
        s.note = r.note;
        s.mark = r.status;
      }
      m.set(d, s);
    }
    result.set(e.id, m);
  }
  return result;
}

export function monthRange(month) {
  return [monthStart(month), monthEnd(month)];
}
