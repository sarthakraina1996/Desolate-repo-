import { today, isHR, isAdmin, requireHR, fullName, str, num, oneOf, id, fail, notFound, getSettings, notifyUsers, audit, sendCsv } from '../core.js';
import { json } from '../db.js';
import * as D from '../lib/dates.js';
import { buildPayroll, processRun, runSummary, runRef, payDate } from '../services/payroll.js';

const KINDS = ['Bonus', 'Arrears', 'Reimbursement', 'Deduction'];

function lineFromPayslip(p) {
  const data = json(p.data, {});
  return {
    payslipId: p.id, employeeId: p.employee_id, status: p.status, gross: p.gross, net: p.net, deductions: p.deductions, employerCost: p.employer_cost,
    name: data.employee?.name, code: data.employee?.code, department: data.employee?.department, vertical: data.employee?.vertical, designation: data.employee?.designation,
    has_photo: Boolean(p.photo), payslip: data, exceptions: data.exceptions || [],
  };
}

export default function payrollRoutes(r, { db }) {
  function filterSql(q, alias = 'e') {
    const where = [];
    const params = [];
    for (const k of ['vertical', 'department', 'location']) if (q[k]) { where.push(`${alias}.${k}_id = ?`); params.push(Number(q[k])); }
    return { sql: where.length ? `AND ${where.join(' AND ')}` : '', params };
  }

  r.get('/payroll', (req, res) => {
    requireHR(req);
    const T = today(db);
    const month = D.isValidMonth(req.query.month) ? req.query.month : D.monthOf(T);
    const f = filterSql(req.query);
    const run = db.get('SELECT * FROM payroll_runs WHERE month = ?', month);
    const keep = (e) => (!req.query.vertical || e.vertical_id === Number(req.query.vertical))
      && (!req.query.department || e.department_id === Number(req.query.department))
      && (!req.query.location || e.location_id === Number(req.query.location));
    const preview = buildPayroll(db, month, { today: T }).filter((l) => keep(l.employee));
    let lines;
    if (run) {
      lines = db.all(`SELECT p.*, e.photo FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ${f.sql} ORDER BY e.code`, run.id, ...f.params).map(lineFromPayslip);
    } else {
      lines = preview.filter((l) => l.payslip).map((l) => ({
        payslipId: null, employeeId: l.employee.id, status: 'Not Run', gross: l.payslip.gross, net: l.payslip.net, deductions: l.payslip.totalDeductions, employerCost: l.payslip.employerCost,
        name: fullName(l.employee), code: l.employee.code, department: l.employee.department, vertical: l.employee.vertical, designation: l.employee.designation,
        has_photo: Boolean(l.employee.photo), payslip: { ...l.payslip, employee: { name: fullName(l.employee), code: l.employee.code, designation: l.employee.designation, department: l.employee.department } }, exceptions: l.exceptions,
      }));
    }
    const sum = (k, src = lines) => src.reduce((t, l) => t + (Number(l[k]) || 0), 0);
    const prevRun = db.get('SELECT * FROM payroll_runs WHERE month = ?', D.addMonths(month, -1));
    const prev = prevRun ? db.get(`SELECT COALESCE(SUM(p.employer_cost),0) cost, COALESCE(SUM(p.net),0) net FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ${f.sql}`, prevRun.id, ...f.params) : null;
    const cost = sum('employerCost');
    const net = sum('net');
    const change = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);

    // Statutory and composition totals
    const stat = { pfEmployee: 0, pfEmployer: 0, esiEmployee: 0, esiEmployer: 0, tds: 0, pt: 0, lwf: 0 };
    const comp = { basic: 0, allowances: 0, bonus: 0, reimbursement: 0, employer: 0 };
    for (const l of lines) {
      const p = l.payslip;
      if (!p?.deductions) continue;
      stat.pfEmployee += p.deductions.pf; stat.pfEmployer += p.employer.pf; stat.esiEmployee += p.deductions.esi; stat.esiEmployer += p.employer.esi;
      stat.tds += p.deductions.tds; stat.pt += p.deductions.pt; stat.lwf += p.deductions.lwf + p.employer.lwf;
      comp.basic += p.earnings.basic; comp.allowances += p.earnings.hra + p.earnings.special; comp.bonus += p.earnings.bonus; comp.reimbursement += p.earnings.reimbursement;
      comp.employer += p.employer.pf + p.employer.esi + p.employer.lwf;
    }

    // Exceptions are always computed from live data so fixes show up immediately.
    const exceptionTypes = { attendance: 'Missing Attendance', reimbursement: 'Pending Reimbursements', kyc: 'Incomplete KYC Details', bank: 'Bank Account Validation Failed', salary: 'Salary Not Set' };
    const exceptions = Object.entries(exceptionTypes).map(([type, label]) => {
      const people = preview.filter((l) => l.exceptions.some((x) => x.type === type)).map((l) => ({ id: l.employee.id, name: fullName(l.employee), code: l.employee.code, text: l.exceptions.find((x) => x.type === type).text }));
      return { type, label, count: people.length, people };
    });

    const trend = db.all('SELECT * FROM payroll_runs WHERE month <= ? ORDER BY month DESC LIMIT 6', month).reverse().map((x) => {
      const t = db.get(`SELECT COALESCE(SUM(p.employer_cost),0) cost, COALESCE(SUM(p.net),0) net, COUNT(*) n FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? ${f.sql}`, x.id, ...f.params);
      return { month: x.month, label: D.shortMonth(x.month), cost: t.cost, net: t.net, count: t.n };
    });

    const eligible = preview.length;
    const processed = run ? lines.filter((l) => ['Processed', 'Paid'].includes(l.status)).length : 0;
    const unmarkedPeople = preview.filter((l) => l.unmarked > 0).length;
    const leaveRecords = db.value("SELECT COUNT(*) FROM leave_requests WHERE status = 'Approved' AND from_date <= ? AND to_date >= ?", D.monthEnd(month), D.monthStart(month));
    const adjustments = db.all(`SELECT a.*, e.first_name, e.last_name, e.code FROM payroll_adjustments a JOIN employees e ON e.id = a.employee_id
      WHERE a.month = ? ${f.sql} ORDER BY a.status = 'Pending' DESC, a.created_at DESC`, month, ...f.params).map((a) => ({ ...a, name: fullName(a) }));

    res.json({
      month,
      label: D.monthLabel(month),
      ref: runRef(month),
      payDate: payDate(month),
      run: runSummary(db, run),
      canManage: isHR(req.user),
      canApproveManagement: isAdmin(req.user),
      kpis: {
        cost, costChange: prev ? change(cost, prev.cost) : null,
        net, netChange: prev ? change(net, prev.net) : null,
        pendingClaims: adjustments.filter((a) => a.status === 'Pending').length,
        processed, eligible, completionPct: eligible ? Math.round((processed / eligible) * 100) : 0,
      },
      lines,
      statutory: stat,
      composition: comp,
      exceptions,
      trend,
      sync: { attendancePct: eligible ? Math.round(((eligible - unmarkedPeople) / eligible) * 100) : 100, attendanceSynced: eligible - unmarkedPeople, eligible, leaveRecords },
      adjustments,
    });
  });

  r.post('/payroll/runs', (req, res) => {
    requireHR(req);
    const month = req.body.month;
    if (!D.isValidMonth(month)) fail(400, 'Choose a valid month');
    if (month > D.addMonths(D.monthOf(today(db)), 1)) fail(400, 'Payroll can be run for the current or next month at most');
    const existing = db.get('SELECT * FROM payroll_runs WHERE month = ?', month);
    if (existing && !['In Review', 'Finance Reviewed'].includes(existing.status)) fail(409, `Payroll for ${D.monthLabel(month)} is already ${existing.status.toLowerCase()}`);
    const run = processRun(db, req.user, month);
    notifyUsers(db, db.all("SELECT id FROM users WHERE role IN ('admin','hr') AND active = 1 AND id != ?", req.user.id).map((u) => u.id), `Payroll for ${D.monthLabel(month)} was processed by ${req.user.name} and is ready for review`, `/payroll?month=${month}`);
    audit(db, req.user, existing ? 'payroll.recompute' : 'payroll.run', 'payroll_run', run.id);
    res.json(runSummary(db, run));
  });

  const getRun = (rid) => db.get('SELECT * FROM payroll_runs WHERE id = ?', id(rid)) || notFound('Payroll run');

  r.post('/payroll/runs/:id/approve', (req, res) => {
    requireHR(req);
    const run = getRun(req.params.id);
    const stage = oneOf(req.body.stage, ['finance', 'management'], { required: true, name: 'Stage' });
    const approvals = json(run.approvals, []);
    const steps = json(run.steps, {});
    const now = new Date().toISOString();
    if (stage === 'finance') {
      if (run.status !== 'In Review') fail(409, 'This run is not waiting for finance review');
      approvals.push({ stage: 'Review by Finance', by: req.user.name, at: now });
      db.update('payroll_runs', run.id, { status: 'Finance Reviewed', approvals, updated_at: now });
      notifyUsers(db, db.all("SELECT id FROM users WHERE role = 'admin' AND active = 1").map((u) => u.id), `Payroll for ${D.monthLabel(run.month)} needs management approval`, `/payroll?month=${run.month}`);
    } else {
      if (!isAdmin(req.user)) fail(403, 'Management approval needs an administrator');
      if (run.status !== 'Finance Reviewed') fail(409, 'Finance must review this run first');
      approvals.push({ stage: 'Management Approval', by: req.user.name, at: now });
      steps.approvals = now;
      db.update('payroll_runs', run.id, { status: 'Approved', approvals, steps, updated_at: now });
    }
    audit(db, req.user, `payroll.approve.${stage}`, 'payroll_run', run.id);
    res.json(runSummary(db, db.get('SELECT * FROM payroll_runs WHERE id = ?', run.id)));
  });

  r.post('/payroll/runs/:id/send-back', (req, res) => {
    requireHR(req);
    const run = getRun(req.params.id);
    if (!['Finance Reviewed', 'Approved'].includes(run.status)) fail(409, 'Only reviewed runs can be sent back');
    const approvals = json(run.approvals, []).filter((a) => a.stage === 'Prepared by HR');
    const steps = json(run.steps, {});
    delete steps.approvals;
    db.update('payroll_runs', run.id, { status: 'In Review', approvals, steps, updated_at: new Date().toISOString() });
    audit(db, req.user, 'payroll.send_back', 'payroll_run', run.id, { note: str(req.body.note, { max: 300 }) });
    res.json(runSummary(db, db.get('SELECT * FROM payroll_runs WHERE id = ?', run.id)));
  });

  r.post('/payroll/runs/:id/transfer', (req, res) => {
    requireHR(req);
    const run = getRun(req.params.id);
    if (run.status !== 'Approved') fail(409, 'The run must be approved before the bank transfer');
    const s = db.get("SELECT COUNT(*) c, COALESCE(SUM(net),0) n FROM payslips WHERE run_id = ? AND status = 'Processed'", run.id);
    const now = new Date().toISOString();
    const steps = { ...json(run.steps, {}), transfer: now };
    const batch = { id: `BT-${run.month.replace('-', '')}-001`, bank: getSettings(db).bankName || 'HDFC Bank', count: s.c, amount: s.n, status: 'Scheduled', initiatedAt: now, payDate: payDate(run.month) };
    db.update('payroll_runs', run.id, { status: 'Transfer Scheduled', steps, bank_batch: batch, updated_at: now });
    audit(db, req.user, 'payroll.transfer', 'payroll_run', run.id);
    res.json(runSummary(db, db.get('SELECT * FROM payroll_runs WHERE id = ?', run.id)));
  });

  r.post('/payroll/runs/:id/complete', (req, res) => {
    requireHR(req);
    const run = getRun(req.params.id);
    if (run.status !== 'Transfer Scheduled') fail(409, 'Schedule the bank transfer first');
    const now = new Date().toISOString();
    db.tx(() => {
      db.run("UPDATE payslips SET status = 'Paid' WHERE run_id = ? AND status = 'Processed'", run.id);
      const batch = { ...json(run.bank_batch, {}), status: 'Completed', completedAt: now };
      db.update('payroll_runs', run.id, { status: 'Completed', steps: { ...json(run.steps, {}), completed: now }, bank_batch: batch, updated_at: now });
    });
    const users = db.all("SELECT u.id FROM users u JOIN payslips p ON p.employee_id = u.employee_id WHERE p.run_id = ? AND p.status = 'Paid' AND u.active = 1", run.id).map((u) => u.id);
    notifyUsers(db, users, `Your payslip for ${D.monthLabel(run.month)} is available`, '/my?tab=payslips');
    audit(db, req.user, 'payroll.complete', 'payroll_run', run.id);
    res.json(runSummary(db, db.get('SELECT * FROM payroll_runs WHERE id = ?', run.id)));
  });

  r.delete('/payroll/runs/:id', (req, res) => {
    requireHR(req);
    const run = getRun(req.params.id);
    if (!['In Review', 'Finance Reviewed'].includes(run.status)) fail(409, 'Approved or paid runs cannot be deleted');
    db.run('DELETE FROM payroll_runs WHERE id = ?', run.id);
    audit(db, req.user, 'payroll.delete', 'payroll_run', run.id);
    res.json({ ok: true });
  });

  r.put('/payroll/payslips/:id/hold', (req, res) => {
    requireHR(req);
    const p = db.get('SELECT p.*, r.status AS run_status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = ?', id(req.params.id)) || notFound('Payslip');
    if (['Transfer Scheduled', 'Completed'].includes(p.run_status)) fail(409, 'The bank transfer for this run has already been scheduled');
    db.run('UPDATE payslips SET status = ? WHERE id = ?', req.body.hold ? 'On Hold' : 'Processed', p.id);
    res.json({ ok: true });
  });

  r.get('/payroll/payslips/:id', (req, res) => {
    const p = db.get('SELECT p.*, r.month, r.status AS run_status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = ?', id(req.params.id)) || notFound('Payslip');
    const own = p.employee_id === req.user.employeeId;
    if (!isHR(req.user) && !(own && p.run_status === 'Completed')) fail(403, 'You cannot view this payslip');
    const s = getSettings(db);
    res.json({ id: p.id, month: p.month, label: D.monthLabel(p.month), status: p.status, runStatus: p.run_status, data: json(p.data, {}), company: { name: s.companyName }, payDate: payDate(p.month) });
  });

  r.get('/payroll/my', (req, res) => {
    if (!req.user.employeeId) return res.json({ items: [] });
    res.json({
      items: db.all(`SELECT p.id, p.gross, p.net, p.deductions, p.status, r.month FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
        WHERE p.employee_id = ? AND r.status = 'Completed' ORDER BY r.month DESC LIMIT 24`, req.user.employeeId).map((x) => ({ ...x, label: D.monthLabel(x.month) })),
      claims: db.all('SELECT * FROM payroll_adjustments WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20', req.user.employeeId),
    });
  });

  r.get('/payroll/runs/:id/bank-file.csv', (req, res) => {
    requireHR(req);
    const run = getRun(req.params.id);
    const rows = db.all("SELECT p.*, e.bank_account, e.ifsc, e.bank_name, e.first_name, e.last_name, e.code FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? AND p.status IN ('Processed','Paid') ORDER BY e.code", run.id);
    sendCsv(res, `bank-transfer-${run.month}.csv`, rows, [
      { label: 'Beneficiary Name', value: (x) => fullName(x) }, { label: 'Employee ID', value: 'code' }, { label: 'Account Number', value: 'bank_account' },
      { label: 'IFSC', value: 'ifsc' }, { label: 'Bank', value: 'bank_name' }, { label: 'Amount', value: 'net' }, { label: 'Narration', value: () => `Salary ${D.monthLabel(run.month)}` },
    ]);
  });

  r.get('/payroll/runs/:id/register.csv', (req, res) => {
    requireHR(req);
    const run = getRun(req.params.id);
    const rows = db.all('SELECT * FROM payslips WHERE run_id = ? ORDER BY id', run.id).map((p) => ({ ...json(p.data, {}), status: p.status }));
    sendCsv(res, `payroll-register-${run.month}.csv`, rows, [
      { label: 'Employee ID', value: (x) => x.employee?.code }, { label: 'Name', value: (x) => x.employee?.name }, { label: 'Department', value: (x) => x.employee?.department },
      { label: 'Days in Month', value: 'daysInMonth' }, { label: 'LOP Days', value: 'lopDays' }, { label: 'Paid Days', value: 'paidDays' },
      { label: 'Basic', value: (x) => x.earnings?.basic }, { label: 'HRA', value: (x) => x.earnings?.hra }, { label: 'Special Allowance', value: (x) => x.earnings?.special },
      { label: 'Bonus', value: (x) => x.earnings?.bonus }, { label: 'Reimbursement', value: (x) => x.earnings?.reimbursement }, { label: 'Gross', value: 'gross' },
      { label: 'PF', value: (x) => x.deductions?.pf }, { label: 'ESI', value: (x) => x.deductions?.esi }, { label: 'Professional Tax', value: (x) => x.deductions?.pt },
      { label: 'TDS', value: (x) => x.deductions?.tds }, { label: 'LWF', value: (x) => x.deductions?.lwf }, { label: 'Other Deductions', value: (x) => x.deductions?.other },
      { label: 'Total Deductions', value: 'totalDeductions' }, { label: 'Net Pay', value: 'net' }, { label: 'Employer PF', value: (x) => x.employer?.pf },
      { label: 'Employer ESI', value: (x) => x.employer?.esi }, { label: 'Cost to Company', value: 'employerCost' }, { label: 'Status', value: 'status' },
    ]);
  });

  // ---------- adjustments (bonuses, reimbursements, deductions) ----------
  r.post('/payroll/adjustments', (req, res) => {
    const T = today(db);
    const hr = isHR(req.user);
    const employeeId = req.body.employee_id ? id(req.body.employee_id) : req.user.employeeId;
    if (!employeeId) fail(400, 'Choose an employee');
    if (!hr && employeeId !== req.user.employeeId) fail(403, 'You can only submit your own claims');
    const kind = oneOf(req.body.kind || 'Reimbursement', KINDS, { name: 'Type' });
    if (!hr && kind !== 'Reimbursement') fail(403, 'Employees can only submit reimbursement claims');
    const month = D.isValidMonth(req.body.month) ? req.body.month : D.monthOf(T);
    const run = db.get('SELECT status FROM payroll_runs WHERE month = ?', month);
    if (run && !['In Review', 'Finance Reviewed'].includes(run.status)) fail(409, `Payroll for ${D.monthLabel(month)} is already approved. Choose next month.`);
    const aid = db.insert('payroll_adjustments', {
      employee_id: employeeId, month, kind,
      amount: num(req.body.amount, { required: true, min: 1, max: 10000000, name: 'Amount', int: true }),
      note: str(req.body.note, { max: 200 }),
      status: hr && req.body.approve ? 'Approved' : 'Pending',
    });
    if (!hr) notifyUsers(db, db.all("SELECT id FROM users WHERE role IN ('admin','hr') AND active = 1").map((u) => u.id), `${req.user.name} submitted a reimbursement claim`, `/payroll?month=${month}`);
    res.json({ id: aid });
  });
  r.put('/payroll/adjustments/:id', (req, res) => {
    requireHR(req);
    const a = db.get('SELECT * FROM payroll_adjustments WHERE id = ?', id(req.params.id)) || notFound('Adjustment');
    const status = oneOf(req.body.status, ['Pending', 'Approved', 'Rejected'], { required: true, name: 'Status' });
    db.update('payroll_adjustments', a.id, { status });
    const uid = db.value('SELECT id FROM users WHERE employee_id = ?', a.employee_id);
    if (status !== 'Pending') notifyUsers(db, [uid], `Your ${a.kind.toLowerCase()} of ₹${a.amount.toLocaleString('en-IN')} was ${status.toLowerCase()}`, '/my?tab=payslips');
    res.json({ ok: true });
  });
  r.delete('/payroll/adjustments/:id', (req, res) => {
    const a = db.get('SELECT * FROM payroll_adjustments WHERE id = ?', id(req.params.id)) || notFound('Adjustment');
    if (!isHR(req.user) && !(a.employee_id === req.user.employeeId && a.status === 'Pending')) fail(403, 'You cannot delete this claim');
    db.run('DELETE FROM payroll_adjustments WHERE id = ?', a.id);
    res.json({ ok: true });
  });
}
