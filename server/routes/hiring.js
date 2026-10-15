import { today, isHR, requireHR, fullName, str, num, date, oneOf, id, fail, notFound, strList, notifyUsers, userIdForEmployee, audit, email as emailV } from '../core.js';
import { json } from '../db.js';
import * as D from '../lib/dates.js';
import { hashPassword, tempPassword } from '../auth.js';
import { estimateMonthlyTds } from '../lib/payroll.js';

export const STAGES = ['Applied', 'AI Screened', 'Shortlisted', 'Interview 1', 'Interview 2', 'Offer', 'Hired'];
const ALL_STAGES = [...STAGES, 'Rejected', 'On Hold'];
const SOURCES = ['LinkedIn', 'Naukri', 'Indeed', 'Company Website', 'Referrals', 'Other', 'Upload'];
const ONBOARDING = ['Offer letter signed', 'Documents & KYC collected', 'Laptop and accounts set up', 'Welcome kit & ID card', 'Orientation and buddy assigned'];

export const JOB_SELECT = `
  SELECT j.*, v.name AS vertical, v.short AS vertical_short, v.color AS vertical_color, d.name AS department, l.name AS location,
         m.first_name AS hm_first, m.last_name AS hm_last,
         (SELECT COUNT(*) FROM candidates c WHERE c.job_id = j.id) AS applicants
  FROM jobs j LEFT JOIN verticals v ON v.id = j.vertical_id LEFT JOIN departments d ON d.id = j.department_id
  LEFT JOIN locations l ON l.id = j.location_id LEFT JOIN employees m ON m.id = j.hiring_manager_id`;

export function shapeJob(j) {
  return { ...j, must_have: json(j.must_have, []), nice_to_have: json(j.nice_to_have, []), knockout: json(j.knockout, []), hiring_manager: j.hm_first ? fullName({ first_name: j.hm_first, last_name: j.hm_last }) : null };
}

export function shapeCandidate(c) {
  return { ...c, skills: json(c.skills, []), ai: json(c.ai, null), resume_text: undefined, has_resume: Boolean(c.resume_file || c.resume_text) };
}

// HR sees every job; managers see jobs they are hiring for.
export function canAccessJob(user, job) {
  return isHR(user) || (job && user.employeeId && job.hiring_manager_id === user.employeeId);
}
export function assertCandidateAccess(db, user, cand) {
  if (isHR(user)) return;
  const job = cand.job_id ? db.get('SELECT hiring_manager_id FROM jobs WHERE id = ?', cand.job_id) : null;
  const interviewer = user.employeeId && db.value('SELECT 1 FROM interviews WHERE candidate_id = ? AND interviewer_id = ?', cand.id, user.employeeId);
  if (!canAccessJob(user, job) && !interviewer) fail(403, 'You do not have access to this candidate');
}
export function logActivity(db, candidateId, text, user) {
  db.insert('candidate_activity', { candidate_id: candidateId, text, by_name: user?.name || 'System' });
}

export default function hiringRoutes(r, { db }) {
  function jobFilters(q) {
    const where = [];
    const params = [];
    for (const k of ['vertical', 'department', 'location']) if (q[k]) { where.push(`j.${k}_id = ?`); params.push(Number(q[k])); }
    if (q.type) { where.push('j.employment_type = ?'); params.push(q.type); }
    if (q.job) { where.push('j.id = ?'); params.push(Number(q.job)); }
    return { where, params };
  }

  r.get('/hiring', (req, res) => {
    if (!isHR(req.user) && req.user.role !== 'manager') fail(403, 'Hiring is available to HR and hiring managers');
    const T = today(db);
    const from = date(req.query.from) || D.monthStart(D.monthOf(T));
    const to = date(req.query.to) || T;
    const span = D.diffDays(from, to) + 1;
    const pFrom = D.addDays(from, -span);
    const pTo = D.addDays(from, -1);
    const f = jobFilters(req.query);
    if (!isHR(req.user)) { f.where.push('j.hiring_manager_id = ?'); f.params.push(req.user.employeeId || 0); }
    const jw = f.where.length ? `AND ${f.where.join(' AND ')}` : '';
    const jobs = db.all(`${JOB_SELECT} WHERE 1=1 ${jw} ORDER BY j.status = 'Active' DESC, j.posted_on DESC`, ...f.params).map(shapeJob);
    const jobIds = jobs.map((j) => j.id);
    const inJobs = jobIds.length ? `c.job_id IN (${jobIds.map(() => '?').join(',')})` : '0=1';

    const ttf = (a, b) => {
      const rows = db.all(`SELECT c.offer_date, j.posted_on FROM candidates c JOIN jobs j ON j.id = c.job_id WHERE ${inJobs} AND c.offer_status = 'Accepted' AND c.offer_date BETWEEN ? AND ?`, ...jobIds, a, b);
      return rows.length ? Math.round(rows.reduce((t, x) => t + D.diffDays(x.posted_on, x.offer_date), 0) / rows.length) : null;
    };
    const offers = (a, b) => db.value(`SELECT COUNT(*) FROM candidates c WHERE ${inJobs} AND c.offer_date BETWEEN ? AND ?`, ...jobIds, a, b);
    const accept = (a, b) => {
      const x = db.get(`SELECT SUM(offer_status = 'Accepted') acc, SUM(offer_status = 'Declined') dec FROM candidates c WHERE ${inJobs} AND c.offer_date BETWEEN ? AND ?`, ...jobIds, a, b);
      const decided = (x.acc || 0) + (x.dec || 0);
      return decided ? Math.round(((x.acc || 0) / decided) * 100) : null;
    };
    const pct = (a, b) => (a == null || b == null || !b ? null : Math.round(((a - b) / b) * 100));
    const openRoles = jobs.filter((j) => j.status === 'Active').reduce((t, j) => t + j.openings, 0);
    const openPrev = jobs.filter((j) => j.posted_on <= pTo && (!j.closed_on || j.closed_on > pTo) && j.status !== 'On Hold').reduce((t, j) => t + j.openings, 0);
    const kpis = {
      openRoles, openChange: pct(openRoles, openPrev),
      timeToFill: ttf(from, to), timeToFillChange: pct(ttf(from, to), ttf(pFrom, pTo)),
      offersSent: offers(from, to), offersChange: pct(offers(from, to), offers(pFrom, pTo)),
      acceptance: accept(from, to), acceptanceChange: pct(accept(from, to), accept(pFrom, pTo)),
    };

    const activeJobIds = jobs.filter((j) => j.status !== 'Closed').map((j) => j.id);
    const inActive = activeJobIds.length ? `c.job_id IN (${activeJobIds.map(() => '?').join(',')})` : '0=1';
    const pipeline = STAGES.map((stage) => {
      const total = db.value(`SELECT COUNT(*) FROM candidates c WHERE ${inActive} AND c.stage = ?`, ...activeJobIds, stage);
      const top = db.all(`SELECT c.id, c.name, c.ai_score, c.updated_at, c.applied_on, c.current_title, j.title FROM candidates c JOIN jobs j ON j.id = c.job_id
        WHERE ${inActive} AND c.stage = ? ORDER BY c.updated_at DESC LIMIT 3`, ...activeJobIds, stage);
      return { stage, total, candidates: top };
    });
    const interviewsToday = db.all(`SELECT i.*, c.name, c.id AS candidate_id, j.title, e.first_name, e.last_name FROM interviews i
      JOIN candidates c ON c.id = i.candidate_id JOIN jobs j ON j.id = c.job_id LEFT JOIN employees e ON e.id = i.interviewer_id
      WHERE ${inJobs} AND i.scheduled_at BETWEEN ? AND ? AND i.status != 'Cancelled' ORDER BY i.scheduled_at`, ...jobIds, `${T}T00:00`, `${T}T23:59`)
      .map((i) => ({ ...i, interviewer: i.first_name ? fullName(i) : null }));
    const upcoming = interviewsToday.length ? [] : db.all(`SELECT i.*, c.name, j.title FROM interviews i JOIN candidates c ON c.id = i.candidate_id JOIN jobs j ON j.id = c.job_id
      WHERE ${inJobs} AND i.scheduled_at > ? AND i.status = 'Scheduled' ORDER BY i.scheduled_at LIMIT 4`, ...jobIds, `${T}T23:59`);
    const scorecards = db.all(`SELECT c.id, c.name, j.title, AVG(i.rating) AS avg, COUNT(i.id) AS n FROM interviews i JOIN candidates c ON c.id = i.candidate_id JOIN jobs j ON j.id = c.job_id
      WHERE ${inJobs} AND i.rating IS NOT NULL AND c.stage NOT IN ('Rejected','Hired') GROUP BY c.id ORDER BY MAX(i.scheduled_at) DESC LIMIT 4`, ...jobIds)
      .map((s) => ({ ...s, avg: Math.round(s.avg * 10) / 10 }));
    const sources = db.all(`SELECT c.source, COUNT(*) AS applied, SUM(c.max_stage >= 2) AS shortlisted, SUM(c.max_stage >= 6) AS hired FROM candidates c
      WHERE ${inJobs} GROUP BY c.source ORDER BY applied DESC`, ...jobIds);
    const onboarding = isHR(req.user) ? db.all(`SELECT e.id, e.first_name, e.last_name, e.designation, e.join_date, v.short AS vertical, v.color AS vertical_color,
        e.photo IS NOT NULL AS has_photo, COUNT(t.id) AS total, SUM(t.done) AS done
      FROM onboarding_tasks t JOIN employees e ON e.id = t.employee_id LEFT JOIN verticals v ON v.id = e.vertical_id
      WHERE e.status != 'Exited' GROUP BY e.id HAVING SUM(t.done) < COUNT(t.id) OR e.join_date >= ? ORDER BY e.join_date DESC LIMIT 6`, D.addDays(T, -21))
      .map((x) => ({ ...x, name: fullName(x), status: x.done >= x.total ? 'Completed' : x.done > 0 ? 'In Progress' : 'Pending' })) : [];
    res.json({ today: T, from, to, kpis, pipeline, jobs, interviewsToday, upcoming, scorecards, sources, onboarding, totalCandidates: db.value(`SELECT COUNT(*) FROM candidates c WHERE ${inActive}`, ...activeJobIds) });
  });

  r.get('/candidates', (req, res) => {
    if (!isHR(req.user) && req.user.role !== 'manager') fail(403, 'Not allowed');
    const where = [];
    const params = [];
    if (req.query.job) { where.push('c.job_id = ?'); params.push(Number(req.query.job)); }
    if (req.query.stage) { where.push('c.stage = ?'); params.push(req.query.stage); }
    if (!isHR(req.user)) { where.push('j.hiring_manager_id = ?'); params.push(req.user.employeeId || 0); }
    const q = String(req.query.search || '').trim();
    if (q) {
      const like = `%${q.replace(/[%_]/g, '')}%`;
      where.push('(c.name LIKE ? OR c.email LIKE ? OR c.skills LIKE ? OR c.location LIKE ? OR c.current_company LIKE ?)');
      params.push(like, like, like, like, like);
    }
    const rows = db.all(`SELECT c.*, j.title AS job_title FROM candidates c LEFT JOIN jobs j ON j.id = c.job_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.updated_at DESC LIMIT 300`, ...params);
    res.json({ items: rows.map(shapeCandidate) });
  });

  r.get('/candidates/:id', (req, res) => {
    const c = db.get('SELECT c.*, j.title AS job_title FROM candidates c LEFT JOIN jobs j ON j.id = c.job_id WHERE c.id = ?', id(req.params.id)) || notFound('Candidate');
    assertCandidateAccess(db, req.user, c);
    const interviews = db.all(`SELECT i.*, e.first_name, e.last_name, e.designation FROM interviews i LEFT JOIN employees e ON e.id = i.interviewer_id
      WHERE i.candidate_id = ? ORDER BY i.scheduled_at`, c.id).map((i) => ({ ...i, interviewer: i.first_name ? fullName(i) : null }));
    const rated = interviews.filter((i) => i.rating != null);
    const job = c.job_id ? shapeJob(db.get(`${JOB_SELECT} WHERE j.id = ?`, c.job_id)) : null;
    res.json({
      candidate: { ...shapeCandidate(c), resume_text: c.resume_text },
      job,
      interviews,
      activity: db.all('SELECT * FROM candidate_activity WHERE candidate_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', c.id),
      scorecard: { average: rated.length ? Math.round((rated.reduce((t, i) => t + i.rating, 0) / rated.length) * 10) / 10 : null, count: rated.length },
      canManage: isHR(req.user) || canAccessJob(req.user, job),
      stages: ALL_STAGES,
    });
  });

  function readCandidate(b, partial = false) {
    const out = {};
    const has = (k) => !partial || Object.prototype.hasOwnProperty.call(b, k);
    if (has('name')) out.name = str(b.name, { required: true, max: 100, name: 'Name' });
    if (has('email')) out.email = emailV(b.email);
    if (has('phone')) out.phone = str(b.phone, { max: 20 });
    if (has('location')) out.location = str(b.location, { max: 60 });
    if (has('current_company')) out.current_company = str(b.current_company, { max: 80 });
    if (has('current_title')) out.current_title = str(b.current_title, { max: 80 });
    if (has('experience')) out.experience = num(b.experience, { min: 0, max: 50, name: 'Experience' });
    if (has('education')) out.education = str(b.education, { max: 150 });
    if (has('expected_ctc')) out.expected_ctc = num(b.expected_ctc, { min: 0, max: 500, name: 'Expected CTC' });
    if (has('current_ctc')) out.current_ctc = num(b.current_ctc, { min: 0, max: 500, name: 'Current CTC' });
    if (has('notice_days')) out.notice_days = num(b.notice_days, { min: 0, max: 365, int: true, name: 'Notice period' });
    if (has('linkedin')) out.linkedin = str(b.linkedin, { max: 150 });
    if (has('skills')) out.skills = strList(b.skills);
    if (has('source')) out.source = oneOf(b.source || 'Company Website', SOURCES, { name: 'Source' });
    return out;
  }

  r.post('/candidates', (req, res) => {
    requireHR(req);
    const jobId = id(req.body.job_id);
    db.get('SELECT 1 FROM jobs WHERE id = ?', jobId) || notFound('Job');
    const cid = db.insert('candidates', { ...readCandidate(req.body), job_id: jobId, stage: 'Applied', applied_on: today(db) });
    logActivity(db, cid, 'Candidate added manually', req.user);
    res.json({ id: cid });
  });

  r.put('/candidates/:id', (req, res) => {
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    requireHR(req);
    db.update('candidates', c.id, { ...readCandidate(req.body, true), updated_at: new Date().toISOString() });
    res.json({ ok: true });
  });

  r.post('/candidates/:id/move', (req, res) => {
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    const job = c.job_id ? db.get('SELECT * FROM jobs WHERE id = ?', c.job_id) : null;
    if (!canAccessJob(req.user, job)) fail(403, 'You cannot move this candidate');
    const stage = oneOf(req.body.stage, ALL_STAGES, { required: true, name: 'Stage' });
    if (stage === 'Hired') fail(400, 'Use "Convert to employee" to hire a candidate');
    const idx = STAGES.indexOf(stage);
    const decision = stage === 'Rejected' ? 'Reject' : stage === 'On Hold' ? 'Hold' : idx >= 2 ? 'Shortlist' : c.decision;
    db.update('candidates', c.id, {
      stage, decision, max_stage: Math.max(c.max_stage, idx), updated_at: new Date().toISOString(),
      reject_reason: stage === 'Rejected' ? str(req.body.reason, { max: 200 }) || 'Not a fit for this role' : c.reject_reason,
    });
    logActivity(db, c.id, `Moved to ${stage}${stage === 'Rejected' && req.body.reason ? ` · ${req.body.reason}` : ''}`, req.user);
    res.json({ ok: true });
  });

  r.post('/interviews', (req, res) => {
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.body.candidate_id)) || notFound('Candidate');
    const job = c.job_id ? db.get('SELECT * FROM jobs WHERE id = ?', c.job_id) : null;
    if (!canAccessJob(req.user, job)) fail(403, 'You cannot schedule interviews for this candidate');
    const round = oneOf(req.body.round || 'Interview 1', ['Interview 1', 'Interview 2', 'HR Round'], { name: 'Round' });
    const at = String(req.body.scheduled_at || '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) || !D.isValidYmd(at.slice(0, 10))) fail(400, 'Choose a valid date and time');
    const interviewer = req.body.interviewer_id ? id(req.body.interviewer_id) : null;
    const iid = db.insert('interviews', { candidate_id: c.id, round, scheduled_at: at, mode: oneOf(req.body.mode || 'Virtual', ['Virtual', 'In-person', 'Phone'], { name: 'Mode' }), interviewer_id: interviewer, status: 'Scheduled' });
    const idx = STAGES.indexOf(round);
    if (idx > STAGES.indexOf(c.stage)) db.update('candidates', c.id, { stage: round, max_stage: Math.max(c.max_stage, idx), decision: 'Shortlist', updated_at: new Date().toISOString() });
    logActivity(db, c.id, `${round} scheduled for ${at.replace('T', ' ')}`, req.user);
    if (interviewer) notifyUsers(db, [userIdForEmployee(db, interviewer)], `You are interviewing ${c.name} (${job?.title || 'candidate'}) on ${at.replace('T', ' at ')}`, `/hiring?candidate=${c.id}`);
    res.json({ id: iid });
  });

  r.put('/interviews/:id', (req, res) => {
    const i = db.get('SELECT * FROM interviews WHERE id = ?', id(req.params.id)) || notFound('Interview');
    const c = db.get('SELECT * FROM candidates WHERE id = ?', i.candidate_id);
    if (!isHR(req.user) && i.interviewer_id !== req.user.employeeId) assertCandidateAccess(db, req.user, c);
    const status = oneOf(req.body.status || i.status, ['Scheduled', 'Completed', 'Cancelled', 'No-show'], { name: 'Status' });
    const data = { status };
    if (req.body.scheduled_at) data.scheduled_at = String(req.body.scheduled_at).slice(0, 16);
    if (status === 'Completed') {
      data.rating = num(req.body.rating, { required: true, min: 1, max: 5, name: 'Rating' });
      data.recommendation = oneOf(req.body.recommendation, ['Strong Hire', 'Hire', 'No Hire'], { required: true, name: 'Recommendation' });
      data.feedback = str(req.body.feedback, { max: 2000 });
    }
    db.update('interviews', i.id, data);
    logActivity(db, c.id, `${i.round} ${status.toLowerCase()}${data.rating ? ` · rated ${data.rating}/5 (${data.recommendation})` : ''}`, req.user);
    res.json({ ok: true });
  });

  r.post('/candidates/:id/offer', (req, res) => {
    requireHR(req);
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    const ctc = num(req.body.offer_ctc, { required: true, min: 0.5, max: 500, name: 'Offer CTC (LPA)' });
    const joining = date(req.body.joining_date, { name: 'Joining date' });
    db.update('candidates', c.id, { stage: 'Offer', max_stage: Math.max(c.max_stage, 5), offer_ctc: ctc, offer_date: today(db), offer_status: 'Sent', joining_date: joining, decision: 'Shortlist', updated_at: new Date().toISOString() });
    logActivity(db, c.id, `Offer sent · ${ctc} LPA${joining ? ` · joining ${joining}` : ''}`, req.user);
    res.json({ ok: true });
  });

  r.post('/candidates/:id/offer-status', (req, res) => {
    requireHR(req);
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    if (!c.offer_status) fail(400, 'No offer has been sent');
    const status = oneOf(req.body.status, ['Accepted', 'Declined'], { required: true, name: 'Status' });
    db.update('candidates', c.id, { offer_status: status, offer_date: c.offer_date || today(db), updated_at: new Date().toISOString(), ...(status === 'Declined' ? { stage: 'Rejected', reject_reason: 'Offer declined' } : {}) });
    logActivity(db, c.id, `Offer ${status.toLowerCase()}`, req.user);
    res.json({ ok: true });
  });

  // Converts an accepted candidate into an employee record with onboarding tasks.
  r.post('/candidates/:id/hire', (req, res) => {
    requireHR(req);
    const c = db.get('SELECT * FROM candidates WHERE id = ?', id(req.params.id)) || notFound('Candidate');
    if (c.employee_id) fail(409, 'This candidate is already an employee');
    if (!c.email && !req.body.email) fail(400, 'Add the candidate\'s email first');
    const job = c.job_id ? db.get('SELECT * FROM jobs WHERE id = ?', c.job_id) : {};
    const [first, ...rest] = c.name.split(' ');
    const joinDate = date(req.body.join_date || c.joining_date, { required: true, name: 'Joining date' });
    const workEmail = emailV(req.body.email || `${first}.${rest.join('') || 'new'}@brainadz.com`.toLowerCase().replace(/[^a-z0-9.@]/g, ''), { required: true });
    if (db.value('SELECT 1 FROM employees WHERE email = ?', workEmail)) fail(409, `${workEmail} is already used by another employee`);
    const ctc = Math.round((Number(req.body.ctc) || c.offer_ctc || c.expected_ctc || 0) * 100000);
    let temp = null;
    const eid = db.tx(() => {
      const prefix = db.value("SELECT value FROM settings WHERE key = 'employeeCodePrefix'");
      const max = db.all('SELECT code FROM employees').map((x) => Number(String(x.code).replace(/\D/g, '')) || 0).reduce((a, b) => Math.max(a, b), 0);
      const newId = db.insert('employees', {
        code: `${prefix ? JSON.parse(prefix) : 'BZ'}${String(max + 1).padStart(3, '0')}`, first_name: first, last_name: rest.join(' '), email: workEmail, phone: c.phone,
        vertical_id: job.vertical_id, department_id: job.department_id, location_id: job.location_id, designation: job.title || c.current_title, grade: 'Executive',
        manager_id: job.hiring_manager_id || null, employment_type: job.employment_type || 'Full-time', join_date: joinDate, status: 'Active',
        skills: json(c.skills, []), ctc, monthly_tds: estimateMonthlyTds(ctc),
      });
      ONBOARDING.forEach((t, i) => db.insert('onboarding_tasks', { employee_id: newId, title: t, done: i === 0 ? 1 : 0, done_at: i === 0 ? new Date().toISOString() : null, sort: i }));
      if (req.body.create_login) {
        temp = tempPassword();
        db.insert('users', { email: workEmail, password_hash: hashPassword(temp), role: 'employee', employee_id: newId, must_change_password: 1 });
      }
      db.update('candidates', c.id, { stage: 'Hired', max_stage: 6, employee_id: newId, offer_status: 'Accepted', joining_date: joinDate, updated_at: new Date().toISOString() });
      return newId;
    });
    logActivity(db, c.id, `Hired · employee record created (joining ${joinDate})`, req.user);
    if (job.hiring_manager_id) notifyUsers(db, [userIdForEmployee(db, job.hiring_manager_id)], `${c.name} joins your team on ${joinDate}`, `/employees/${eid}`);
    audit(db, req.user, 'candidate.hire', 'employee', eid);
    res.json({ employeeId: eid, tempPassword: temp, email: workEmail });
  });

  // ---------- jobs ----------
  r.get('/jobs', (req, res) => {
    if (!isHR(req.user) && req.user.role !== 'manager') fail(403, 'Not allowed');
    const rows = db.all(`${JOB_SELECT} ${isHR(req.user) ? '' : 'WHERE j.hiring_manager_id = ?'} ORDER BY j.status = 'Active' DESC, j.posted_on DESC`, ...(isHR(req.user) ? [] : [req.user.employeeId || 0]));
    res.json({ items: rows.map(shapeJob) });
  });

  function readJob(b) {
    const ref = (k, table) => {
      const v = b[k] ? id(b[k]) : null;
      if (v && !db.value(`SELECT 1 FROM ${table} WHERE id = ?`, v)) fail(400, `Unknown ${k.replace('_id', '')}`);
      return v;
    };
    const expMin = num(b.exp_min, { min: 0, max: 40, name: 'Minimum experience' });
    const expMax = num(b.exp_max, { min: 0, max: 50, name: 'Maximum experience' });
    if (expMin != null && expMax != null && expMax < expMin) fail(400, 'Maximum experience must be at least the minimum');
    return {
      title: str(b.title, { required: true, max: 100, name: 'Job title' }),
      vertical_id: ref('vertical_id', 'verticals'),
      department_id: ref('department_id', 'departments'),
      location_id: ref('location_id', 'locations'),
      employment_type: oneOf(b.employment_type || 'Full-time', ['Full-time', 'Part-time', 'Contract', 'Intern'], { name: 'Employment type' }),
      work_mode: oneOf(b.work_mode || 'Onsite', ['Onsite', 'Hybrid', 'Remote'], { name: 'Work mode' }),
      openings: num(b.openings ?? 1, { min: 1, max: 100, int: true, name: 'Openings' }),
      description: str(b.description, { max: 5000 }),
      must_have: strList(b.must_have, { max: 12 }),
      nice_to_have: strList(b.nice_to_have, { max: 12 }),
      exp_min: expMin,
      exp_max: expMax,
      education: str(b.education, { max: 150 }),
      salary_min: num(b.salary_min, { min: 0, max: 500, name: 'Salary min' }),
      salary_max: num(b.salary_max, { min: 0, max: 500, name: 'Salary max' }),
      knockout: strList(b.knockout, { max: 5, itemMax: 200 }),
      hiring_manager_id: ref('hiring_manager_id', 'employees'),
    };
  }
  r.post('/jobs', (req, res) => {
    requireHR(req);
    const jid = db.insert('jobs', { ...readJob(req.body), status: 'Active', posted_on: today(db) });
    audit(db, req.user, 'job.create', 'job', jid);
    res.json({ id: jid });
  });
  r.put('/jobs/:id', (req, res) => {
    const job = db.get('SELECT * FROM jobs WHERE id = ?', id(req.params.id)) || notFound('Job');
    if (!canAccessJob(req.user, job)) fail(403, 'You cannot edit this job');
    const data = req.body.title !== undefined ? readJob({ ...shapeJob(job), ...req.body }) : {};
    if (req.body.status) {
      data.status = oneOf(req.body.status, ['Active', 'On Hold', 'Closed'], { name: 'Status' });
      data.closed_on = data.status === 'Closed' ? today(db) : null;
    }
    db.update('jobs', job.id, data);
    res.json({ ok: true });
  });
}
