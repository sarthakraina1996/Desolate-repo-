import { isHR, scopeIds, requireHR, fullName, str, num, date, oneOf, id, fail, notFound, notifyUsers, userIdForEmployee, managerUserId, reportIds } from '../core.js';

const SELECT = `
  SELECT rv.*, e.first_name, e.last_name, e.code, e.designation, e.manager_id, e.photo IS NOT NULL AS has_photo,
         d.name AS department, v.short AS vertical, v.color AS vertical_color,
         (SELECT ROUND(SUM(g.progress * g.weight) * 1.0 / NULLIF(SUM(g.weight), 0)) FROM goals g WHERE g.cycle_id = rv.cycle_id AND g.employee_id = rv.employee_id) AS goal_progress,
         (SELECT COUNT(*) FROM goals g WHERE g.cycle_id = rv.cycle_id AND g.employee_id = rv.employee_id) AS goal_count
  FROM reviews rv JOIN employees e ON e.id = rv.employee_id
  LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN verticals v ON v.id = e.vertical_id`;

const RATING_LABELS = { 5: 'Outstanding', 4: 'Exceeds Expectations', 3: 'Meets Expectations', 2: 'Needs Improvement', 1: 'Unsatisfactory' };

export default function performanceRoutes(r, { db }) {
  const isManagerOf = (user, employeeId) => user.role === 'manager' && reportIds(db, user.employeeId).includes(employeeId);
  const canManage = (user, employeeId) => isHR(user) || isManagerOf(user, employeeId);

  r.get('/performance', (req, res) => {
    const cycles = db.all('SELECT * FROM review_cycles ORDER BY start_date DESC');
    const cycle = req.query.cycle ? cycles.find((c) => c.id === Number(req.query.cycle)) : cycles.find((c) => c.status === 'Active') || cycles[0];
    if (!cycle) return res.json({ cycles, cycle: null, reviews: [] });
    const scope = scopeIds(db, req.user);
    const where = ['rv.cycle_id = ?'];
    const params = [cycle.id];
    if (scope !== null) { where.push(scope.length ? `rv.employee_id IN (${scope.map(() => '?').join(',')})` : '0=1'); params.push(...scope); }
    if (req.query.vertical) { where.push('e.vertical_id = ?'); params.push(Number(req.query.vertical)); }
    if (req.query.department) { where.push('e.department_id = ?'); params.push(Number(req.query.department)); }
    const reviews = db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.first_name`, ...params).map((x) => ({ ...x, name: fullName(x), mine: x.employee_id === req.user.employeeId }));
    const team = reviews.filter((x) => !x.mine);
    const statusCounts = ['Not Started', 'Self Review', 'Manager Review', 'Completed'].map((s) => ({ label: s, value: team.filter((x) => x.status === s).length }));
    const rated = team.filter((x) => x.final_rating != null);
    const distribution = [1, 2, 3, 4, 5].map((n) => ({ label: RATING_LABELS[n], rating: n, value: rated.filter((x) => Math.round(x.final_rating) === n).length }));
    const deptMap = new Map();
    for (const x of rated) {
      const d = deptMap.get(x.department) || { label: x.department, total: 0, n: 0 };
      d.total += x.final_rating;
      d.n++;
      deptMap.set(x.department, d);
    }
    res.json({
      cycles,
      cycle,
      reviews,
      mine: reviews.find((x) => x.mine) || null,
      summary: {
        total: team.length,
        completed: statusCounts[3].value,
        completionPct: team.length ? Math.round((statusCounts[3].value / team.length) * 100) : 0,
        avgRating: rated.length ? Math.round((rated.reduce((t, x) => t + x.final_rating, 0) / rated.length) * 10) / 10 : null,
        avgGoalProgress: team.length ? Math.round(team.reduce((t, x) => t + (x.goal_progress || 0), 0) / team.length) : 0,
        statusCounts,
        distribution,
        byDepartment: [...deptMap.values()].map((d) => ({ label: d.label, value: Math.round((d.total / d.n) * 10) / 10 })).sort((a, b) => b.value - a.value),
        top: [...rated].sort((a, b) => b.final_rating - a.final_rating || (b.goal_progress || 0) - (a.goal_progress || 0)).slice(0, 5),
      },
      ratingLabels: RATING_LABELS,
    });
  });

  r.get('/performance/reviews/:id', (req, res) => {
    const rv = db.get(`${SELECT} WHERE rv.id = ?`, id(req.params.id)) || notFound('Review');
    const self = rv.employee_id === req.user.employeeId;
    if (!self && !canManage(req.user, rv.employee_id)) fail(403, 'You cannot view this review');
    const cycle = db.get('SELECT * FROM review_cycles WHERE id = ?', rv.cycle_id);
    res.json({
      review: { ...rv, name: fullName(rv) },
      cycle,
      goals: db.all('SELECT * FROM goals WHERE cycle_id = ? AND employee_id = ? ORDER BY id', rv.cycle_id, rv.employee_id),
      canSelf: self && cycle.status === 'Active' && ['Not Started', 'Self Review'].includes(rv.status),
      canManager: !self && canManage(req.user, rv.employee_id) && cycle.status === 'Active' && rv.status !== 'Completed',
      canEditGoals: cycle.status === 'Active' && (self || canManage(req.user, rv.employee_id)) && rv.status !== 'Completed',
      ratingLabels: RATING_LABELS,
    });
  });

  r.post('/performance/cycles', (req, res) => {
    requireHR(req);
    const start = date(req.body.start_date, { required: true, name: 'Start date' });
    const end = date(req.body.end_date, { required: true, name: 'End date' });
    if (end < start) fail(400, 'End date must be after the start date');
    const cid = db.tx(() => {
      const newId = db.insert('review_cycles', { name: str(req.body.name, { required: true, max: 80, name: 'Name' }), start_date: start, end_date: end, status: 'Active' });
      for (const e of db.all("SELECT id FROM employees WHERE status != 'Exited' AND join_date <= ? AND grade IS NOT 'CXO'", end)) {
        db.insert('reviews', { cycle_id: newId, employee_id: e.id, status: 'Not Started' });
      }
      return newId;
    });
    notifyUsers(db, db.all('SELECT id FROM users WHERE active = 1').map((u) => u.id), `Performance cycle "${req.body.name}" has started. Set your goals.`, '/performance');
    res.json({ id: cid });
  });

  r.put('/performance/cycles/:id', (req, res) => {
    requireHR(req);
    const c = db.get('SELECT * FROM review_cycles WHERE id = ?', id(req.params.id)) || notFound('Cycle');
    db.update('review_cycles', c.id, { status: oneOf(req.body.status, ['Planned', 'Active', 'Closed'], { required: true, name: 'Status' }) });
    res.json({ ok: true });
  });

  const reviewFor = (cycleId, employeeId) => db.get('SELECT * FROM reviews WHERE cycle_id = ? AND employee_id = ?', cycleId, employeeId);
  const assertGoalAccess = (user, cycleId, employeeId) => {
    const cycle = db.get('SELECT * FROM review_cycles WHERE id = ?', cycleId) || notFound('Cycle');
    if (cycle.status !== 'Active') fail(409, 'This cycle is closed');
    if (employeeId !== user.employeeId && !canManage(user, employeeId)) fail(403, 'You cannot change these goals');
    const rv = reviewFor(cycleId, employeeId);
    if (rv?.status === 'Completed') fail(409, 'This review is completed');
  };

  r.post('/performance/goals', (req, res) => {
    const cycleId = id(req.body.cycle_id);
    const employeeId = req.body.employee_id ? id(req.body.employee_id) : req.user.employeeId;
    assertGoalAccess(req.user, cycleId, employeeId);
    if (db.value('SELECT COUNT(*) FROM goals WHERE cycle_id = ? AND employee_id = ?', cycleId, employeeId) >= 8) fail(400, 'A review can have at most 8 goals');
    const gid = db.insert('goals', {
      cycle_id: cycleId, employee_id: employeeId,
      title: str(req.body.title, { required: true, max: 150, name: 'Goal' }),
      description: str(req.body.description, { max: 500 }),
      weight: num(req.body.weight ?? 25, { min: 5, max: 100, int: true, name: 'Weight' }),
      progress: num(req.body.progress ?? 0, { min: 0, max: 100, int: true, name: 'Progress' }),
      due_date: date(req.body.due_date),
    });
    if (!reviewFor(cycleId, employeeId)) db.insert('reviews', { cycle_id: cycleId, employee_id: employeeId, status: 'Not Started' });
    res.json({ id: gid });
  });

  r.put('/performance/goals/:id', (req, res) => {
    const g = db.get('SELECT * FROM goals WHERE id = ?', id(req.params.id)) || notFound('Goal');
    assertGoalAccess(req.user, g.cycle_id, g.employee_id);
    const data = {};
    if (req.body.progress != null) data.progress = num(req.body.progress, { min: 0, max: 100, int: true, name: 'Progress' });
    if (req.body.title != null) data.title = str(req.body.title, { required: true, max: 150, name: 'Goal' });
    if (req.body.weight != null) data.weight = num(req.body.weight, { min: 5, max: 100, int: true, name: 'Weight' });
    if (req.body.due_date !== undefined) data.due_date = date(req.body.due_date);
    db.update('goals', g.id, data);
    res.json({ ok: true });
  });

  r.delete('/performance/goals/:id', (req, res) => {
    const g = db.get('SELECT * FROM goals WHERE id = ?', id(req.params.id)) || notFound('Goal');
    assertGoalAccess(req.user, g.cycle_id, g.employee_id);
    db.run('DELETE FROM goals WHERE id = ?', g.id);
    res.json({ ok: true });
  });

  r.post('/performance/reviews/:id/self', (req, res) => {
    const rv = db.get('SELECT * FROM reviews WHERE id = ?', id(req.params.id)) || notFound('Review');
    if (rv.employee_id !== req.user.employeeId) fail(403, 'This is not your review');
    if (!['Not Started', 'Self Review'].includes(rv.status)) fail(409, 'Your self review is already submitted');
    const submit = req.body.submit !== false;
    db.update('reviews', rv.id, {
      self_rating: num(req.body.rating, { required: submit, min: 1, max: 5, name: 'Rating' }),
      self_comments: str(req.body.comments, { max: 3000 }),
      status: submit ? 'Manager Review' : 'Self Review',
      updated_at: new Date().toISOString(),
    });
    if (submit) notifyUsers(db, [managerUserId(db, rv.employee_id)], `${req.user.name} submitted a self review`, `/performance?review=${rv.id}`);
    res.json({ ok: true });
  });

  r.post('/performance/reviews/:id/manager', (req, res) => {
    const rv = db.get('SELECT * FROM reviews WHERE id = ?', id(req.params.id)) || notFound('Review');
    if (rv.employee_id === req.user.employeeId || !canManage(req.user, rv.employee_id)) fail(403, 'Only the manager or HR can complete this review');
    if (rv.status === 'Completed') fail(409, 'This review is already completed');
    const rating = num(req.body.rating, { required: true, min: 1, max: 5, name: 'Rating' });
    db.update('reviews', rv.id, { manager_rating: rating, manager_comments: str(req.body.comments, { max: 3000 }), final_rating: rating, status: 'Completed', updated_at: new Date().toISOString() });
    notifyUsers(db, [userIdForEmployee(db, rv.employee_id)], 'Your performance review is completed', '/performance');
    res.json({ ok: true });
  });

}
