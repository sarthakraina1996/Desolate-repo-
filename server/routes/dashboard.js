import { today, isHR, scopeIds, fullName, fail } from '../core.js';
import * as D from '../lib/dates.js';
import { balances } from '../services/leave.js';
import { calendarCtx, dayStatuses } from '../services/calendar.js';
import { runSummary } from '../services/payroll.js';

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const change = (now, prev) => (prev ? Math.round(((now - prev) / prev) * 100) : now ? 100 : 0);

// WHERE fragment for "employed on date" plus scope and vertical filters.
export function employeeFilter(scope, vertical, alias = 'e') {
  const parts = [];
  const params = [];
  if (scope !== null) {
    parts.push(scope.length ? `${alias}.id IN (${scope.map(() => '?').join(',')})` : '0=1');
    params.push(...scope);
  }
  if (vertical) {
    parts.push(`${alias}.vertical_id = ?`);
    params.push(vertical);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1=1', params };
}

export function headcountOn(db, date, f) {
  return db.value(`SELECT COUNT(*) FROM employees e WHERE e.join_date <= ? AND (e.exit_date IS NULL OR e.exit_date >= ?) AND ${f.sql}`, date, date, ...f.params);
}

export default function dashboardRoutes(r, { db }) {
  r.get('/dashboard', (req, res) => {
    if (!isHR(req.user) && req.user.role !== 'manager') fail(403, 'Use My Space for your personal dashboard');
    const T = today(db);
    const vertical = req.query.vertical ? Number(req.query.vertical) : null;
    const scope = scopeIds(db, req.user);
    const f = employeeFilter(scope, vertical);
    const month = D.monthOf(T);
    const prevMonth = D.addMonths(month, -1);
    const prevEnd = D.monthEnd(prevMonth);

    const headcount = headcountOn(db, T, f);
    const headcountPrev = headcountOn(db, prevEnd, f);
    const current = db.all(`
      SELECT e.id, e.join_date, e.exit_date, e.gender, e.vertical_id, e.department_id, e.location_id, d.name AS department, l.name AS location, v.name AS vertical, v.color
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN locations l ON l.id = e.location_id LEFT JOIN verticals v ON v.id = e.vertical_id
      WHERE e.join_date <= ? AND (e.exit_date IS NULL OR e.exit_date >= ?) AND ${f.sql}`, T, T, ...f.params);
    const ids = current.map((e) => e.id);

    const joiners = db.value(`SELECT COUNT(*) FROM employees e WHERE e.join_date BETWEEN ? AND ? AND ${f.sql}`, D.monthStart(month), T, ...f.params);
    const joinersPrev = db.value(`SELECT COUNT(*) FROM employees e WHERE e.join_date BETWEEN ? AND ? AND ${f.sql}`, D.monthStart(prevMonth), prevEnd, ...f.params);

    const onLeave = ids.length ? db.all(`
      SELECT DISTINCT r.employee_id FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
      WHERE r.status = 'Approved' AND t.kind = 'leave' AND r.from_date <= ? AND r.to_date >= ? AND r.employee_id IN (${ids.map(() => '?').join(',')})`, T, T, ...ids).length : 0;

    // Hiring (HR: all jobs; managers: jobs they own)
    const jobWhere = [];
    const jobParams = [];
    if (!isHR(req.user)) {
      jobWhere.push('j.hiring_manager_id = ?');
      jobParams.push(req.user.employeeId || 0);
    }
    if (vertical) {
      jobWhere.push('j.vertical_id = ?');
      jobParams.push(vertical);
    }
    const jw = jobWhere.length ? `AND ${jobWhere.join(' AND ')}` : '';
    const openPositions = db.value(`SELECT COALESCE(SUM(openings),0) FROM jobs j WHERE j.status = 'Active' ${jw}`, ...jobParams);
    const openPrev = db.value(`SELECT COALESCE(SUM(openings),0) FROM jobs j WHERE j.posted_on <= ? AND (j.closed_on IS NULL OR j.closed_on > ?) AND j.status != 'On Hold' ${jw}`, prevEnd, prevEnd, ...jobParams);
    const funnel = db.get(`
      SELECT COUNT(*) AS applications, SUM(c.max_stage >= 1) AS screened, SUM(c.max_stage >= 3) AS interviews,
             SUM(c.max_stage >= 5) AS offers, SUM(c.max_stage >= 6) AS hired
      FROM candidates c JOIN jobs j ON j.id = c.job_id WHERE 1=1 ${jw}`, ...jobParams);
    const stageCounts = Object.fromEntries(db.all(`SELECT c.stage, COUNT(*) n FROM candidates c JOIN jobs j ON j.id = c.job_id WHERE j.status != 'Closed' ${jw} GROUP BY c.stage`, ...jobParams).map((x) => [x.stage, x.n]));
    const pipeline = {
      open: openPositions,
      screening: (stageCounts.Applied || 0) + (stageCounts['AI Screened'] || 0) + (stageCounts.Shortlisted || 0),
      interviews: (stageCounts['Interview 1'] || 0) + (stageCounts['Interview 2'] || 0),
      offers: stageCounts.Offer || 0,
      hired: stageCounts.Hired || 0,
    };
    const interviews = db.all(`
      SELECT i.id, i.scheduled_at, i.round, i.mode, c.id AS candidate_id, c.name, j.title
      FROM interviews i JOIN candidates c ON c.id = i.candidate_id JOIN jobs j ON j.id = c.job_id
      WHERE i.status = 'Scheduled' AND i.scheduled_at >= ? ${jw} ${isHR(req.user) ? '' : 'OR (i.status = \'Scheduled\' AND i.interviewer_id = ? AND i.scheduled_at >= ?)'}
      ORDER BY i.scheduled_at LIMIT 4`, `${T}T00:00`, ...jobParams, ...(isHR(req.user) ? [] : [req.user.employeeId || 0, `${T}T00:00`]));

    // Leave requests this user can act on
    const approvable = scope === null ? null : scope.filter((x) => x !== req.user.employeeId);
    const lf = employeeFilter(approvable, vertical);
    const pendingLeaves = db.all(`
      SELECT r.id, r.from_date, r.to_date, r.days, r.half_day, t.name AS type, t.code, t.color, e.id AS employee_id, e.first_name, e.last_name,
             d.name AS department, v.short AS vertical, v.color AS vertical_color
      FROM leave_requests r JOIN employees e ON e.id = r.employee_id JOIN leave_types t ON t.id = r.leave_type_id
      LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN verticals v ON v.id = e.vertical_id
      WHERE r.status = 'Pending' AND ${lf.sql} ${req.user.employeeId ? 'AND r.employee_id != ?' : ''}
      ORDER BY r.from_date LIMIT 5`, ...lf.params, ...(req.user.employeeId ? [req.user.employeeId] : []));
    const pendingLeaveCount = db.value(`SELECT COUNT(*) FROM leave_requests r JOIN employees e ON e.id = r.employee_id WHERE r.status = 'Pending' AND ${lf.sql} ${req.user.employeeId ? 'AND r.employee_id != ?' : ''}`, ...lf.params, ...(req.user.employeeId ? [req.user.employeeId] : []));

    // Payroll status (HR only)
    let payroll = null;
    if (isHR(req.user)) {
      const run = db.get('SELECT * FROM payroll_runs ORDER BY month DESC LIMIT 1');
      if (run) {
        const counts = Object.fromEntries(db.all(`SELECT p.status, COUNT(*) n FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? AND ${f.sql} GROUP BY p.status`, run.id, ...f.params).map((x) => [x.status, x.n]));
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const na = Math.max(0, headcount - total);
        payroll = {
          ...runSummary(db, run),
          paid: counts.Paid || 0,
          processed: counts.Processed || 0,
          onHold: counts['On Hold'] || 0,
          notApplicable: na,
          percent: pct((counts.Paid || 0) + (counts.Processed || 0), total + na),
        };
      }
    }

    // Attrition vs hiring, last 6 months
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const m = D.addMonths(month, -i);
      const end = m === month ? T : D.monthEnd(m);
      trend.push({
        month: m,
        label: D.shortMonth(m),
        joiners: db.value(`SELECT COUNT(*) FROM employees e WHERE e.join_date BETWEEN ? AND ? AND ${f.sql}`, D.monthStart(m), end, ...f.params),
        exits: db.value(`SELECT COUNT(*) FROM employees e WHERE e.exit_date BETWEEN ? AND ? AND ${f.sql}`, D.monthStart(m), end, ...f.params),
      });
    }

    const group = (key) => {
      const m = new Map();
      for (const e of current) m.set(e[key] || 'Unassigned', (m.get(e[key] || 'Unassigned') || 0) + 1);
      return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    };
    const tenure = [['< 1 year', 0, 1], ['1-3 years', 1, 3], ['3-5 years', 3, 5], ['5+ years', 5, 99]].map(([label, a, b]) => ({
      label, value: current.filter((e) => { const y = D.yearsBetween(e.join_date, T); return y >= a && y < b; }).length,
    }));
    const byVertical = db.all('SELECT * FROM verticals ORDER BY id').map((v) => ({ id: v.id, label: v.name, short: v.short, color: v.color, value: current.filter((e) => e.vertical_id === v.id).length }));

    // Compliance
    const required = db.all('SELECT id, version FROM policies WHERE requires_ack = 1');
    let fullyAcked = 0;
    if (ids.length && required.length) {
      const acks = db.all(`SELECT a.employee_id, COUNT(*) n FROM policy_acks a JOIN policies p ON p.id = a.policy_id AND p.version = a.version AND p.requires_ack = 1
        WHERE a.employee_id IN (${ids.map(() => '?').join(',')}) GROUP BY a.employee_id`, ...ids);
      fullyAcked = acks.filter((a) => a.n >= required.length).length;
    }
    const poshTrained = ids.length ? db.value(`SELECT COUNT(*) FROM posh_training WHERE employee_id IN (${ids.map(() => '?').join(',')})`, ...ids) : 0;

    res.json({
      today: T,
      kpis: {
        headcount, headcountChange: change(headcount, headcountPrev),
        openPositions, openChange: change(openPositions, openPrev),
        joiners, joinersChange: change(joiners, joinersPrev),
        onLeave, onLeavePct: pct(onLeave, headcount),
      },
      byVertical,
      funnel,
      pipeline,
      interviews,
      pendingLeaves: pendingLeaves.map((l) => ({ ...l, name: fullName(l) })),
      pendingLeaveCount,
      payroll,
      trend,
      analytics: { departments: group('department'), tenure, locations: group('location'), gender: group('gender').map((g) => ({ ...g, label: { M: 'Male', F: 'Female', O: 'Other' }[g.label] || g.label })) },
      compliance: { headcount, acknowledged: fullyAcked, ackPct: pct(fullyAcked, headcount), poshTrained, poshPct: pct(poshTrained, headcount) },
      org: { departments: new Set(current.map((e) => e.department_id)).size, locations: new Set(current.map((e) => e.location_id)).size },
      notices: db.all('SELECT * FROM notices ORDER BY created_at DESC LIMIT 3'),
      scope: scope === null ? 'organisation' : 'team',
    });
  });

  // Personal dashboard ("My Space") for every signed-in employee.
  r.get('/dashboard/me', (req, res) => {
    const T = today(db);
    const empId = req.user.employeeId;
    const notices = db.all('SELECT * FROM notices ORDER BY created_at DESC LIMIT 4');
    const holidays = db.all('SELECT * FROM holidays WHERE date >= ? ORDER BY date LIMIT 5', T);
    if (!empId) return res.json({ today: T, employee: null, notices, holidays });
    const e = db.get(`SELECT e.*, d.name AS department, v.name AS vertical, v.short AS vertical_short, v.color AS vertical_color, l.name AS location
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN verticals v ON v.id = e.vertical_id LEFT JOIN locations l ON l.id = e.location_id WHERE e.id = ?`, empId);
    const att = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', empId, T);
    const month = D.monthOf(T);
    const statuses = dayStatuses(db, [e], D.monthStart(month), T, T).get(e.id);
    const summary = { P: 0, WFH: 0, HD: 0, A: 0, L: 0, U: 0 };
    for (const s of statuses.values()) if (s.code in summary) summary[s.code]++;
    const policies = db.all(`SELECT p.id, p.title, p.version FROM policies p
      LEFT JOIN policy_acks a ON a.policy_id = p.id AND a.employee_id = ? AND a.version = p.version
      WHERE p.requires_ack = 1 AND a.policy_id IS NULL`, empId);
    const cycle = db.get("SELECT * FROM review_cycles WHERE status = 'Active' ORDER BY start_date DESC LIMIT 1");
    const goals = cycle ? db.all('SELECT * FROM goals WHERE cycle_id = ? AND employee_id = ? ORDER BY id', cycle.id, empId) : [];
    const review = cycle ? db.get('SELECT * FROM reviews WHERE cycle_id = ? AND employee_id = ?', cycle.id, empId) : null;
    const payslip = db.get(`SELECT p.id, p.net, p.gross, r.month FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.employee_id = ? AND r.status = 'Completed' ORDER BY r.month DESC LIMIT 1`, empId);
    const team = e.manager_id ? db.all(`SELECT e.id, e.first_name, e.last_name, e.designation, e.photo IS NOT NULL AS has_photo FROM employees e
      WHERE e.manager_id = ? AND e.status != 'Exited' AND e.id != ? ORDER BY e.first_name LIMIT 12`, e.manager_id, empId) : [];
    const teamIds = team.map((t) => t.id);
    const teamOnLeave = teamIds.length ? db.all(`SELECT r.employee_id, r.from_date, r.to_date, t.name AS type FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id
      WHERE r.status = 'Approved' AND r.to_date >= ? AND r.from_date <= ? AND r.employee_id IN (${teamIds.map(() => '?').join(',')}) ORDER BY r.from_date`, T, D.addDays(T, 14), ...teamIds) : [];
    const celebrations = db.all(`SELECT id, first_name, last_name, dob, join_date FROM employees WHERE status != 'Exited'`).flatMap((x) => {
      const out = [];
      for (const [kind, d] of [['Birthday', x.dob], ['Work anniversary', x.join_date]]) {
        if (!d) continue;
        let next = `${T.slice(0, 4)}${d.slice(4)}`;
        if (next < T) next = `${Number(T.slice(0, 4)) + 1}${d.slice(4)}`;
        const years = Number(next.slice(0, 4)) - Number(d.slice(0, 4));
        if (D.isValidYmd(next) && D.diffDays(T, next) <= 14 && (kind === 'Birthday' || years > 0)) out.push({ id: x.id, name: fullName(x), kind, date: next, years });
      }
      return out;
    }).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    res.json({
      today: T,
      employee: { id: e.id, name: fullName(e), firstName: e.first_name, code: e.code, designation: e.designation, department: e.department, vertical: e.vertical, verticalShort: e.vertical_short, verticalColor: e.vertical_color, location: e.location, joinDate: e.join_date, hasPhoto: Boolean(e.photo), status: e.status },
      attendance: { today: att, monthSummary: summary, todayStatus: statuses.get(T) },
      balances: balances(db, e, D.yearOf(T), T, calendarCtx(db)),
      myRequests: db.all(`SELECT r.*, t.name AS type, t.code, t.color FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id WHERE r.employee_id = ? ORDER BY r.created_at DESC LIMIT 5`, empId),
      pendingPolicies: policies,
      goals,
      review,
      cycle,
      payslip,
      team: team.map((t) => ({ ...t, name: fullName(t) })),
      teamOnLeave: teamOnLeave.map((l) => ({ ...l, name: fullName(team.find((t) => t.id === l.employee_id)) })),
      celebrations,
      holidays,
      notices,
      onboarding: db.all('SELECT * FROM onboarding_tasks WHERE employee_id = ? ORDER BY sort', empId),
      resignation: db.get("SELECT id, status, last_working_day FROM resignations WHERE employee_id = ? AND status NOT IN ('Rejected','Withdrawn') ORDER BY id DESC LIMIT 1", empId),
      poshTrained: Boolean(db.value('SELECT 1 FROM posh_training WHERE employee_id = ?', empId)),
      requests: db.all('SELECT * FROM requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 5', empId),
    });
  });
}

