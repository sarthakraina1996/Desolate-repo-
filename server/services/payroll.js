// Builds payslips for a month from employees, attendance, leave and
// adjustments, and flags the exceptions HR should look at before paying.
import { getSettings, fullName } from '../core.js';
import { json } from '../db.js';
import { computePayslip } from '../lib/payroll.js';
import { daysInMonth, monthStart, monthEnd, diffDays, todayIn, monthLabel } from '../lib/dates.js';
import { dayStatuses } from './calendar.js';

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^\d{9,18}$/;

export function eligibleEmployees(db, month) {
  return db.all(`
    SELECT e.*, d.name AS department, v.name AS vertical, v.short AS vertical_short, l.name AS location
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN verticals v ON v.id = e.vertical_id
    LEFT JOIN locations l ON l.id = e.location_id
    WHERE e.join_date <= ? AND (e.exit_date IS NULL OR e.exit_date >= ?) AND e.status != 'Draft'
    ORDER BY e.code`, monthEnd(month), monthStart(month));
}

export function buildPayroll(db, month, { today, settings = getSettings(db) } = {}) {
  const now = today || todayIn(settings.timezone);
  const from = monthStart(month);
  const to = monthEnd(month);
  const employees = eligibleEmployees(db, month);
  const statuses = dayStatuses(db, employees, from, to, now, settings);
  const adjustments = db.all('SELECT * FROM payroll_adjustments WHERE month = ?', month);
  const lines = [];
  for (const e of employees) {
    const days = statuses.get(e.id);
    let lop = 0;
    let unmarked = 0;
    for (const s of days.values()) {
      lop += s.lop;
      if (s.code === 'U') unmarked++;
    }
    const start = e.join_date > from ? e.join_date : from;
    const end = e.exit_date && e.exit_date < to ? e.exit_date : to;
    const employedDays = diffDays(start, end) + 1;
    const adj = adjustments.filter((a) => a.employee_id === e.id);
    const approved = adj.filter((a) => a.status === 'Approved');
    const exceptions = [];
    if (!e.ctc) exceptions.push({ type: 'salary', text: 'Salary (CTC) not set' });
    if (unmarked > 0) exceptions.push({ type: 'attendance', text: `${unmarked} day(s) with no attendance mark` });
    if (!e.pan || !e.uan) exceptions.push({ type: 'kyc', text: `Missing ${[!e.pan && 'PAN', !e.uan && 'UAN'].filter(Boolean).join(' & ')}` });
    if (!e.bank_account || !ACCOUNT_RE.test(e.bank_account) || !e.ifsc || !IFSC_RE.test(e.ifsc)) exceptions.push({ type: 'bank', text: 'Bank account or IFSC invalid' });
    const pendingAdj = adj.filter((a) => a.status === 'Pending');
    if (pendingAdj.some((a) => a.kind === 'Reimbursement')) exceptions.push({ type: 'reimbursement', text: 'Reimbursement awaiting approval' });
    if (!e.ctc) {
      lines.push({ employee: e, payslip: null, exceptions, unmarked });
      continue;
    }
    const payslip = computePayslip({
      ctc: e.ctc,
      monthlyTds: e.monthly_tds,
      month,
      employedDays,
      lopDays: lop,
      adjustments: approved,
      rules: settings.payroll,
    });
    lines.push({ employee: e, payslip, exceptions, unmarked });
  }
  return lines;
}

function snapshot(e) {
  return {
    name: fullName(e),
    code: e.code,
    designation: e.designation,
    department: e.department,
    vertical: e.vertical,
    location: e.location,
    joinDate: e.join_date,
    pan: e.pan,
    uan: e.uan,
    bankName: e.bank_name,
    bankAccount: e.bank_account ? `XXXX${String(e.bank_account).slice(-4)}` : null,
    ifsc: e.ifsc,
  };
}

// Creates (or recomputes) the run for `month`, marking the first three
// workflow steps complete. Existing approvals are cleared on recompute.
export function processRun(db, user, month, { today } = {}) {
  const settings = getSettings(db);
  const lines = buildPayroll(db, month, { today, settings });
  const now = new Date().toISOString();
  return db.tx(() => {
    let run = db.get('SELECT * FROM payroll_runs WHERE month = ?', month);
    const steps = { collation: now, sync: now, processing: now };
    const approvals = [{ stage: 'Prepared by HR', by: user?.name || 'System', at: now }];
    if (run) {
      db.run('DELETE FROM payslips WHERE run_id = ?', run.id);
      db.update('payroll_runs', run.id, { status: 'In Review', steps, approvals, bank_batch: null, updated_at: now });
    } else {
      const id = db.insert('payroll_runs', { month, status: 'In Review', steps, approvals, created_by: user?.id ?? null, created_at: now, updated_at: now });
      run = { id };
    }
    for (const l of lines) {
      if (!l.payslip) continue;
      const hold = l.exceptions.some((x) => x.type === 'bank');
      db.insert('payslips', {
        run_id: run.id,
        employee_id: l.employee.id,
        data: { ...l.payslip, employee: snapshot(l.employee), exceptions: l.exceptions },
        gross: l.payslip.gross,
        deductions: l.payslip.totalDeductions,
        net: l.payslip.net,
        employer_cost: l.payslip.employerCost,
        status: hold ? 'On Hold' : 'Processed',
      });
    }
    return db.get('SELECT * FROM payroll_runs WHERE id = ?', run.id);
  });
}

export function runSummary(db, run) {
  if (!run) return null;
  const totals = db.get(`
    SELECT COUNT(*) AS count, COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(net),0) AS net,
           COALESCE(SUM(deductions),0) AS deductions, COALESCE(SUM(employer_cost),0) AS cost,
           SUM(status = 'On Hold') AS on_hold, SUM(status = 'Paid') AS paid
    FROM payslips WHERE run_id = ?`, run.id);
  return {
    id: run.id,
    month: run.month,
    label: monthLabel(run.month),
    status: run.status,
    steps: json(run.steps, {}),
    approvals: json(run.approvals, []),
    bankBatch: json(run.bank_batch, null),
    createdAt: run.created_at,
    totals,
  };
}

export const runRef = (month) => `PR-${new Date(`${month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase()}-${month.slice(0, 4)}-001`;
export const payDate = (month) => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
