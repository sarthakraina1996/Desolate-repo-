import { today, requireHR, fullName, sendCsv } from '../core.js';
import { json } from '../db.js';
import * as D from '../lib/dates.js';
import { calendarCtx } from '../services/calendar.js';
import { balances } from '../services/leave.js';
import { headcountOn } from './dashboard.js';

export default function reportRoutes(r, { db }) {
  r.get('/reports/summary', (req, res) => {
    requireHR(req);
    const T = today(db);
    const month = D.monthOf(T);
    const all = { sql: '1=1', params: [] };
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const m = D.addMonths(month, -i);
      const end = m === month ? T : D.monthEnd(m);
      const hc = headcountOn(db, end, all);
      const exits = db.value('SELECT COUNT(*) FROM employees WHERE exit_date BETWEEN ? AND ?', D.monthStart(m), end);
      const joins = db.value('SELECT COUNT(*) FROM employees WHERE join_date BETWEEN ? AND ?', D.monthStart(m), end);
      const avg = (headcountOn(db, D.monthStart(m), all) + hc) / 2;
      const run = db.get('SELECT id FROM payroll_runs WHERE month = ?', m);
      const cost = run ? db.value('SELECT COALESCE(SUM(employer_cost),0) FROM payslips WHERE run_id = ?', run.id) : null;
      months.push({ month: m, label: D.shortMonth(m), headcount: hc, joins, exits, attrition: avg ? Math.round((exits / avg) * 1000) / 10 : 0, payrollCost: cost });
    }
    const year = D.yearOf(T);
    const leaveUse = db.all(`SELECT t.code, t.name, t.color, COALESCE(SUM(r.days),0) AS days, COUNT(r.id) AS requests FROM leave_types t
      LEFT JOIN leave_requests r ON r.leave_type_id = t.id AND r.status = 'Approved' AND r.from_date BETWEEN ? AND ? GROUP BY t.id ORDER BY t.sort`, `${year}-01-01`, `${year}-12-31`);
    const byVertical = db.all(`SELECT v.name AS label, v.color, COUNT(e.id) AS value, COALESCE(SUM(e.ctc),0) AS ctc FROM verticals v
      LEFT JOIN employees e ON e.vertical_id = v.id AND e.status != 'Exited' AND e.join_date <= ? GROUP BY v.id ORDER BY v.id`, T);
    const ttm = months.reduce((t, m) => t + m.exits, 0);
    const avgHc = months.reduce((t, m) => t + m.headcount, 0) / months.length;
    res.json({
      months, leaveUse, byVertical,
      annualAttrition: avgHc ? Math.round((ttm / avgHc) * 1000) / 10 : 0,
      totalCtc: byVertical.reduce((t, v) => t + v.ctc, 0),
      headcount: months[months.length - 1].headcount,
    });
  });

  r.get('/reports/leave-register.csv', (req, res) => {
    requireHR(req);
    const T = today(db);
    const year = Number(req.query.year) || D.yearOf(T);
    const ctx = calendarCtx(db);
    const types = db.all('SELECT * FROM leave_types WHERE active = 1 ORDER BY sort');
    const rows = db.all(`SELECT e.*, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'Exited' ORDER BY e.code`)
      .map((e) => ({ e, b: new Map(balances(db, e, year, year === D.yearOf(T) ? T : `${year}-12-31`, ctx).map((x) => [x.code, x])) }));
    sendCsv(res, `leave-register-${year}.csv`, rows, [
      { label: 'Employee ID', value: (x) => x.e.code }, { label: 'Name', value: (x) => fullName(x.e) }, { label: 'Department', value: (x) => x.e.department },
      ...types.flatMap((t) => [
        { label: `${t.code} Entitled`, value: (x) => (x.b.get(t.code) ? (x.b.get(t.code).entitled ?? 'Unlimited') : 'N/A') },
        { label: `${t.code} Used`, value: (x) => x.b.get(t.code)?.used ?? '' },
        { label: `${t.code} Available`, value: (x) => x.b.get(t.code)?.available ?? '' },
      ]),
    ]);
  });

  r.get('/reports/leave-requests.csv', (req, res) => {
    requireHR(req);
    const rows = db.all(`SELECT r.*, t.name AS type, e.first_name, e.last_name, e.code FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
      JOIN employees e ON e.id = r.employee_id ORDER BY r.from_date DESC`);
    sendCsv(res, 'leave-requests.csv', rows, [
      { label: 'Employee ID', value: 'code' }, { label: 'Name', value: (x) => fullName(x) }, { label: 'Type', value: 'type' }, { label: 'From', value: 'from_date' },
      { label: 'To', value: 'to_date' }, { label: 'Days', value: 'days' }, { label: 'Status', value: 'status' }, { label: 'Reason', value: 'reason' }, { label: 'Applied On', value: (x) => x.created_at.slice(0, 10) },
    ]);
  });

  r.get('/reports/hiring.csv', (req, res) => {
    requireHR(req);
    const rows = db.all('SELECT c.*, j.title FROM candidates c LEFT JOIN jobs j ON j.id = c.job_id ORDER BY c.applied_on DESC');
    sendCsv(res, 'candidates.csv', rows, [
      { label: 'Name', value: 'name' }, { label: 'Email', value: 'email' }, { label: 'Phone', value: 'phone' }, { label: 'Job', value: 'title' }, { label: 'Stage', value: 'stage' },
      { label: 'Source', value: 'source' }, { label: 'Match %', value: 'ai_score' }, { label: 'Experience (yrs)', value: 'experience' }, { label: 'Expected CTC (LPA)', value: 'expected_ctc' },
      { label: 'Location', value: 'location' }, { label: 'Applied On', value: 'applied_on' }, { label: 'Offer Status', value: 'offer_status' },
    ]);
  });

  r.get('/reports/attrition.csv', (req, res) => {
    requireHR(req);
    const rows = db.all(`SELECT r.*, e.first_name, e.last_name, e.code, e.join_date, d.name AS department FROM resignations r JOIN employees e ON e.id = r.employee_id
      LEFT JOIN departments d ON d.id = e.department_id ORDER BY r.submitted_on DESC`);
    sendCsv(res, 'resignations.csv', rows, [
      { label: 'Employee ID', value: 'code' }, { label: 'Name', value: (x) => fullName(x) }, { label: 'Department', value: 'department' }, { label: 'Joined', value: 'join_date' },
      { label: 'Submitted', value: 'submitted_on' }, { label: 'Last Working Day', value: 'last_working_day' }, { label: 'Reason', value: 'reason_category' }, { label: 'Status', value: 'status' },
      { label: 'Rehire Eligible', value: (x) => (x.rehire_eligible == null ? '' : x.rehire_eligible ? 'Yes' : 'No') },
      { label: 'F&F Amount', value: (x) => json(x.settlement, {})?.amount ?? '' },
    ]);
  });

  r.get('/reports/performance.csv', (req, res) => {
    requireHR(req);
    const rows = db.all(`SELECT rv.*, c.name AS cycle, e.first_name, e.last_name, e.code, d.name AS department FROM reviews rv JOIN review_cycles c ON c.id = rv.cycle_id
      JOIN employees e ON e.id = rv.employee_id LEFT JOIN departments d ON d.id = e.department_id ORDER BY c.start_date DESC, e.code`);
    sendCsv(res, 'performance.csv', rows, [
      { label: 'Cycle', value: 'cycle' }, { label: 'Employee ID', value: 'code' }, { label: 'Name', value: (x) => fullName(x) }, { label: 'Department', value: 'department' },
      { label: 'Status', value: 'status' }, { label: 'Self Rating', value: 'self_rating' }, { label: 'Manager Rating', value: 'manager_rating' }, { label: 'Final Rating', value: 'final_rating' },
    ]);
  });

  r.get('/reports/headcount.csv', (req, res) => {
    requireHR(req);
    const T = today(db);
    const rows = db.all(`SELECT v.name AS vertical, d.name AS department, l.name AS location, COUNT(*) AS n, SUM(e.gender = 'F') AS women, SUM(e.gender = 'M') AS men, ROUND(AVG(e.ctc)) AS avg_ctc
      FROM employees e LEFT JOIN verticals v ON v.id = e.vertical_id LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.status != 'Exited' AND e.join_date <= ? GROUP BY v.name, d.name, l.name ORDER BY v.name, d.name`, T);
    sendCsv(res, 'headcount.csv', rows, [
      { label: 'Vertical', value: 'vertical' }, { label: 'Department', value: 'department' }, { label: 'Location', value: 'location' }, { label: 'Headcount', value: 'n' },
      { label: 'Women', value: 'women' }, { label: 'Men', value: 'men' }, { label: 'Average CTC', value: 'avg_ctc' },
    ]);
  });
}
