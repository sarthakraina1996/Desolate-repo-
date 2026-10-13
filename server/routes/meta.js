import fs from 'node:fs';
import path from 'node:path';
import { getSettings, isHR, today, str, oneOf, id, fail, notFound, requireHR, fullName, notifyUsers, scopeIds, DOC_CATEGORIES } from '../core.js';
import { aiEnabled } from '../services/ai.js';
import { geofencePolicy, exemption } from '../services/geofence.js';

export default function metaRoutes(r, { db, uploads }) {
  r.get('/meta', (req, res) => {
    const s = getSettings(db);
    res.json({
      today: today(db),
      settings: { companyName: s.companyName, weeklyOffs: s.weeklyOffs, timezone: s.timezone, noticePeriodDays: s.noticePeriodDays, noticePeriodSeniorDays: s.noticePeriodSeniorDays, demo: Boolean(s.demo), workHours: s.workHours, requiredDocuments: s.requiredDocuments },
      documentCategories: DOC_CATEGORIES,
      verticals: db.all('SELECT * FROM verticals ORDER BY id'),
      departments: db.all('SELECT * FROM departments ORDER BY name'),
      locations: db.all('SELECT * FROM locations ORDER BY name'),
      leaveTypes: db.all('SELECT * FROM leave_types WHERE active = 1 ORDER BY sort, id'),
      employees: db.all(`
        SELECT e.id, e.code, e.first_name || CASE WHEN e.last_name != '' THEN ' ' || e.last_name ELSE '' END AS name,
               e.designation, e.department_id, e.vertical_id, e.location_id, e.status, e.gender, e.manager_id,
               e.photo IS NOT NULL AS has_photo, e.email
        FROM employees e WHERE e.status != 'Exited' ORDER BY e.first_name, e.last_name`),
      ai: aiEnabled(),
      icc: isIcc(db, req.user),
      geofence: { mode: geofencePolicy(s).mode, exempt: exemption(db, req.user, s, today(db))?.reason || null },
    });
  });

  r.get('/files/photo/:employeeId', (req, res) => {
    const photo = db.value('SELECT photo FROM employees WHERE id = ?', id(req.params.employeeId));
    if (!photo) notFound('Photo');
    const file = path.join(uploads, 'photos', path.basename(photo));
    if (!fs.existsSync(file)) notFound('Photo');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(file);
  });

  r.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ results: [] });
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const results = [];
    for (const e of db.all(`
      SELECT e.id, e.first_name, e.last_name, e.code, e.designation, e.status FROM employees e
      WHERE (e.first_name || ' ' || e.last_name LIKE ? OR e.code LIKE ? OR e.email LIKE ? OR e.designation LIKE ?)
      ORDER BY e.status = 'Exited', e.first_name LIMIT 8`, like, like, like, like)) {
      results.push({ type: 'Employee', id: e.id, title: fullName(e), subtitle: `${e.code} · ${e.designation || ''}${e.status === 'Exited' ? ' · Exited' : ''}`, link: `/employees/${e.id}` });
    }
    if (isHR(req.user)) {
      for (const c of db.all(`SELECT c.id, c.name, c.stage, j.title FROM candidates c LEFT JOIN jobs j ON j.id = c.job_id
        WHERE c.name LIKE ? OR c.email LIKE ? OR c.skills LIKE ? LIMIT 6`, like, like, like)) {
        results.push({ type: 'Candidate', id: c.id, title: c.name, subtitle: `${c.title || 'No job'} · ${c.stage}`, link: `/hiring?candidate=${c.id}` });
      }
      for (const j of db.all('SELECT id, title, status FROM jobs WHERE title LIKE ? LIMIT 4', like)) {
        results.push({ type: 'Job', id: j.id, title: j.title, subtitle: j.status, link: `/hiring?job=${j.id}` });
      }
    }
    for (const p of db.all('SELECT id, title, version FROM policies WHERE title LIKE ? OR content LIKE ? LIMIT 4', like, like)) {
      results.push({ type: 'Policy', id: p.id, title: p.title, subtitle: `v${p.version}`, link: `/leave?tab=policies&policy=${p.id}` });
    }
    res.json({ results });
  });

  // ---------- notifications ----------
  r.get('/notifications', (req, res) => {
    res.json({
      items: db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30', req.user.id),
      unread: db.value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0', req.user.id),
    });
  });
  r.post('/notifications/:id/read', (req, res) => {
    db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', id(req.params.id), req.user.id);
    res.json({ ok: true });
  });
  r.post('/notifications/read-all', (req, res) => {
    db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
    res.json({ ok: true });
  });

  // ---------- notice board ----------
  r.get('/notices', (_req, res) => {
    res.json({ items: db.all('SELECT * FROM notices ORDER BY created_at DESC, id DESC LIMIT 50') });
  });
  r.post('/notices', (req, res) => {
    requireHR(req);
    const title = str(req.body.title, { required: true, max: 120, name: 'Title' });
    const body = str(req.body.body, { max: 2000 });
    const kind = oneOf(req.body.kind || 'general', ['general', 'health', 'policy', 'award', 'event'], { name: 'Type' });
    const nid = db.insert('notices', { title, body, kind, created_by: req.user.id });
    notifyUsers(db, db.all('SELECT id FROM users WHERE active = 1 AND id != ?', req.user.id).map((u) => u.id), `Notice: ${title}`, '/');
    res.json({ id: nid });
  });
  r.delete('/notices/:id', (req, res) => {
    requireHR(req);
    db.run('DELETE FROM notices WHERE id = ?', id(req.params.id));
    res.json({ ok: true });
  });

  // ---------- helpdesk requests ----------
  r.get('/requests', (req, res) => {
    const scope = scopeIds(db, req.user);
    const mine = req.query.mine === '1' || !isHR(req.user);
    const rows = db.all(`
      SELECT q.*, e.first_name, e.last_name, e.code FROM requests q JOIN employees e ON e.id = q.employee_id
      ${mine ? 'WHERE q.employee_id = ?' : ''} ORDER BY q.status = 'Resolved', q.created_at DESC LIMIT 200`, ...(mine ? [req.user.employeeId || 0] : []));
    res.json({ items: rows.map((q) => ({ ...q, employee: fullName(q) })), scope: scope === null ? 'all' : 'mine' });
  });
  r.post('/requests', (req, res) => {
    if (!req.user.employeeId) fail(400, 'Your login is not linked to an employee record');
    const category = oneOf(req.body.category, ['HR', 'IT', 'Payroll', 'Admin', 'Other'], { required: true, name: 'Category' });
    const subject = str(req.body.subject, { required: true, max: 150, name: 'Subject' });
    const description = str(req.body.description, { max: 2000 });
    const rid = db.insert('requests', { employee_id: req.user.employeeId, category, subject, description });
    notifyUsers(db, db.all("SELECT id FROM users WHERE role IN ('admin','hr') AND active = 1").map((u) => u.id), `${req.user.name} raised a ${category} request: ${subject}`, '/employees?tab=requests');
    res.json({ id: rid });
  });
  r.put('/requests/:id', (req, res) => {
    requireHR(req);
    const rid = id(req.params.id);
    const row = db.get('SELECT * FROM requests WHERE id = ?', rid) || notFound('Request');
    const status = oneOf(req.body.status, ['Open', 'In Progress', 'Resolved'], { required: true, name: 'Status' });
    const response = str(req.body.response, { max: 2000 });
    db.update('requests', rid, { status, response, updated_at: new Date().toISOString() });
    const uid = db.value('SELECT id FROM users WHERE employee_id = ?', row.employee_id);
    notifyUsers(db, [uid], `Your ${row.category} request "${row.subject}" is ${status.toLowerCase()}`, '/my');
    res.json({ ok: true });
  });
}

export function isIcc(db, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const icc = getSettings(db).icc || {};
  return Boolean(user.employeeId) && (icc.presidingOfficerId === user.employeeId || (icc.memberIds || []).includes(user.employeeId));
}
