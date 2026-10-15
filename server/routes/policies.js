import fs from 'node:fs';
import path from 'node:path';
import { today, isHR, requireHR, fullName, str, oneOf, id, fail, notFound, getSettings, setSetting, notifyUsers, userIdForEmployee, audit, date } from '../core.js';
import { json } from '../db.js';
import * as D from '../lib/dates.js';
import { isIcc } from './meta.js';

const CATEGORIES = ['Leave', 'General', 'Compliance', 'POSH', 'IT', 'Finance', 'HR'];

function bumpVersion(v) {
  const [maj, min = '0'] = String(v || '1.0').split('.');
  return `${maj}.${Number(min) + 1}`;
}

function iccUserIds(db) {
  const icc = getSettings(db).icc || {};
  const empIds = [icc.presidingOfficerId, ...(icc.memberIds || [])].filter(Boolean);
  const ids = empIds.map((e) => userIdForEmployee(db, e)).filter(Boolean);
  return [...ids, ...db.all("SELECT id FROM users WHERE role = 'admin' AND active = 1").map((u) => u.id)];
}

export default function policyRoutes(r, { db, uploads, upload }) {
  r.get('/policies', (req, res) => {
    const T = today(db);
    const current = db.all("SELECT e.id, e.department_id, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.status != 'Exited' AND e.join_date <= ?", T);
    const items = db.all('SELECT id, title, category, version, summary, requires_ack, file_name, updated_at FROM policies ORDER BY title').map((p) => {
      const acked = db.value('SELECT COUNT(*) FROM policy_acks a JOIN employees e ON e.id = a.employee_id AND e.status != \'Exited\' WHERE a.policy_id = ? AND a.version = ?', p.id, p.version);
      const mine = req.user.employeeId ? db.get('SELECT version, acked_at FROM policy_acks WHERE policy_id = ? AND employee_id = ?', p.id, req.user.employeeId) : null;
      return { ...p, acked, total: current.length, myAck: mine && mine.version === p.version ? mine.acked_at : null, myAckOutdated: Boolean(mine && mine.version !== p.version) };
    });
    // Acknowledgement of all required policies, by department.
    const required = db.all('SELECT id, version FROM policies WHERE requires_ack = 1');
    const ackCount = new Map(db.all(`SELECT a.employee_id, COUNT(*) n FROM policy_acks a JOIN policies p ON p.id = a.policy_id AND p.version = a.version AND p.requires_ack = 1 GROUP BY a.employee_id`).map((x) => [x.employee_id, x.n]));
    const byDept = new Map();
    for (const e of current) {
      const k = e.department || 'Unassigned';
      const v = byDept.get(k) || { label: k, acked: 0, total: 0 };
      v.total++;
      if ((ackCount.get(e.id) || 0) >= required.length) v.acked++;
      byDept.set(k, v);
    }
    const fully = [...byDept.values()].reduce((t, d) => t + d.acked, 0);
    res.json({ items, byDepartment: [...byDept.values()].sort((a, b) => b.total - a.total), overall: { acked: fully, total: current.length } });
  });

  r.get('/policies/:id', (req, res) => {
    const p = db.get('SELECT * FROM policies WHERE id = ?', id(req.params.id)) || notFound('Policy');
    const mine = req.user.employeeId ? db.get('SELECT version, acked_at FROM policy_acks WHERE policy_id = ? AND employee_id = ?', p.id, req.user.employeeId) : null;
    const pending = isHR(req.user) && p.requires_ack ? db.all(`SELECT e.id, e.first_name, e.last_name, e.code, d.name AS department FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN policy_acks a ON a.employee_id = e.id AND a.policy_id = ? AND a.version = ?
      WHERE e.status != 'Exited' AND e.join_date <= ? AND a.policy_id IS NULL ORDER BY e.first_name`, p.id, p.version, today(db)).map((e) => ({ ...e, name: fullName(e) })) : [];
    res.json({ ...p, file: undefined, hasFile: Boolean(p.file), myAck: mine && mine.version === p.version ? mine.acked_at : null, pending });
  });

  r.get('/policies/:id/file', (req, res) => {
    const p = db.get('SELECT * FROM policies WHERE id = ?', id(req.params.id)) || notFound('Policy');
    if (!p.file) notFound('File');
    const file = path.join(uploads, 'policies', path.basename(p.file));
    if (!fs.existsSync(file)) notFound('File');
    res.download(file, p.file_name || `${p.title}.pdf`);
  });

  const policyUpload = upload('policies', { maxMb: 15, exts: ['.pdf', '.doc', '.docx'] }).single('file');
  r.post('/policies', policyUpload, (req, res) => {
    requireHR(req);
    const pid = db.insert('policies', {
      title: str(req.body.title, { required: true, max: 120, name: 'Title' }),
      category: oneOf(req.body.category || 'General', CATEGORIES, { name: 'Category' }),
      version: str(req.body.version, { max: 10 }) || '1.0',
      summary: str(req.body.summary, { max: 300 }),
      content: str(req.body.content, { max: 50000 }),
      requires_ack: req.body.requires_ack === 'false' || req.body.requires_ack === false ? 0 : 1,
      file: req.file?.filename || null,
      file_name: req.file?.originalname?.slice(0, 120) || null,
    });
    notifyUsers(db, db.all('SELECT id FROM users WHERE active = 1').map((u) => u.id), `New policy published: ${req.body.title}`, `/leave?tab=policies&policy=${pid}`);
    audit(db, req.user, 'policy.create', 'policy', pid);
    res.json({ id: pid });
  });

  r.put('/policies/:id', policyUpload, (req, res) => {
    requireHR(req);
    const p = db.get('SELECT * FROM policies WHERE id = ?', id(req.params.id)) || notFound('Policy');
    const major = req.body.new_version === 'true' || req.body.new_version === true;
    const version = major ? bumpVersion(p.version) : p.version;
    const data = {
      title: str(req.body.title, { required: true, max: 120, name: 'Title' }),
      category: oneOf(req.body.category || p.category, CATEGORIES, { name: 'Category' }),
      summary: str(req.body.summary, { max: 300 }),
      content: str(req.body.content, { max: 50000 }),
      requires_ack: req.body.requires_ack === 'false' || req.body.requires_ack === false ? 0 : 1,
      version,
      updated_at: new Date().toISOString(),
    };
    if (req.file) {
      data.file = req.file.filename;
      data.file_name = req.file.originalname.slice(0, 120);
      if (p.file) fs.rm(path.join(uploads, 'policies', path.basename(p.file)), { force: true }, () => {});
    }
    db.update('policies', p.id, data);
    if (major && data.requires_ack) notifyUsers(db, db.all('SELECT id FROM users WHERE active = 1').map((u) => u.id), `${data.title} updated to v${version}. Please acknowledge it.`, `/leave?tab=policies&policy=${p.id}`);
    audit(db, req.user, 'policy.update', 'policy', p.id, { version });
    res.json({ ok: true, version });
  });

  r.delete('/policies/:id', (req, res) => {
    requireHR(req);
    const p = db.get('SELECT * FROM policies WHERE id = ?', id(req.params.id)) || notFound('Policy');
    db.run('DELETE FROM policies WHERE id = ?', p.id);
    if (p.file) fs.rm(path.join(uploads, 'policies', path.basename(p.file)), { force: true }, () => {});
    res.json({ ok: true });
  });

  r.post('/policies/:id/ack', (req, res) => {
    if (!req.user.employeeId) fail(400, 'Your login is not linked to an employee record');
    const p = db.get('SELECT * FROM policies WHERE id = ?', id(req.params.id)) || notFound('Policy');
    db.run(`INSERT INTO policy_acks (policy_id, employee_id, version, acked_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(policy_id, employee_id) DO UPDATE SET version = excluded.version, acked_at = excluded.acked_at`, p.id, req.user.employeeId, p.version, new Date().toISOString());
    res.json({ ok: true });
  });

  r.post('/policies/:id/remind', (req, res) => {
    requireHR(req);
    const p = db.get('SELECT * FROM policies WHERE id = ?', id(req.params.id)) || notFound('Policy');
    const users = db.all(`SELECT u.id FROM users u JOIN employees e ON e.id = u.employee_id
      LEFT JOIN policy_acks a ON a.employee_id = e.id AND a.policy_id = ? AND a.version = ?
      WHERE u.active = 1 AND e.status != 'Exited' AND a.policy_id IS NULL`, p.id, p.version).map((u) => u.id);
    notifyUsers(db, users, `Reminder: please acknowledge ${p.title} v${p.version}`, `/leave?tab=policies&policy=${p.id}`);
    res.json({ ok: true, sent: users.length });
  });

  // ---------- POSH ----------
  r.get('/posh', (req, res) => {
    const T = today(db);
    const current = db.value("SELECT COUNT(*) FROM employees WHERE status != 'Exited' AND join_date <= ?", T);
    const trained = db.value("SELECT COUNT(*) FROM posh_training t JOIN employees e ON e.id = t.employee_id WHERE e.status != 'Exited'");
    const policy = db.get("SELECT id, version FROM policies WHERE category = 'POSH' ORDER BY updated_at DESC LIMIT 1");
    const acked = policy ? db.value("SELECT COUNT(*) FROM policy_acks a JOIN employees e ON e.id = a.employee_id AND e.status != 'Exited' WHERE a.policy_id = ? AND a.version = ?", policy.id, policy.version) : 0;
    const icc = getSettings(db).icc || {};
    const member = (eid, role) => {
      const e = db.get('SELECT id, first_name, last_name, designation, photo IS NOT NULL AS has_photo FROM employees WHERE id = ?', eid);
      return e ? { ...e, name: fullName(e), role } : null;
    };
    const members = [member(icc.presidingOfficerId, 'Presiding Officer'), ...(icc.memberIds || []).map((m) => member(m, 'Member'))].filter(Boolean);
    const canSeeCases = isIcc(db, req.user);
    const complaints = canSeeCases ? db.all('SELECT * FROM posh_complaints ORDER BY created_at DESC').map((c) => ({ ...c, updates: json(c.updates, []), complainant: c.anonymous ? 'Anonymous' : fullName(db.get('SELECT first_name, last_name FROM employees WHERE id = ?', c.complainant_id)) })) : [];
    const mine = req.user.employeeId ? db.all('SELECT id, ref_no, status, created_at, due_date FROM posh_complaints WHERE complainant_id = ? ORDER BY created_at DESC', req.user.employeeId) : [];
    const untrained = isHR(req.user) ? db.all(`SELECT e.id, e.first_name, e.last_name, e.code, d.name AS department FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN posh_training t ON t.employee_id = e.id WHERE e.status != 'Exited' AND e.join_date <= ? AND t.employee_id IS NULL ORDER BY e.first_name`, T).map((e) => ({ ...e, name: fullName(e) })) : [];
    res.json({
      stats: { headcount: current, trained, trainedPct: current ? Math.round((trained / current) * 100) : 0, acked, ackPct: current ? Math.round((acked / current) * 100) : 0 },
      policyId: policy?.id || null,
      icc: { members, externalMember: icc.externalMember || '' },
      canSeeCases,
      complaints,
      caseStats: canSeeCases ? {
        total: complaints.length,
        open: complaints.filter((c) => !['Resolved', 'Closed'].includes(c.status)).length,
        resolved: complaints.filter((c) => ['Resolved', 'Closed'].includes(c.status)).length,
        thisYear: complaints.filter((c) => c.created_at.slice(0, 4) === T.slice(0, 4)).length,
      } : null,
      mine,
      myTraining: req.user.employeeId ? db.value('SELECT completed_at FROM posh_training WHERE employee_id = ?', req.user.employeeId) || null : null,
      untrained,
    });
  });

  r.post('/posh/training', (req, res) => {
    const target = req.body.employee_id ? id(req.body.employee_id) : req.user.employeeId;
    if (!target) fail(400, 'Your login is not linked to an employee record');
    if (target !== req.user.employeeId) requireHR(req);
    db.run('INSERT INTO posh_training (employee_id, completed_at) VALUES (?, ?) ON CONFLICT(employee_id) DO UPDATE SET completed_at = excluded.completed_at', target, new Date().toISOString());
    res.json({ ok: true });
  });

  r.post('/posh/complaints', (req, res) => {
    const anonymous = Boolean(req.body.anonymous);
    const T = today(db);
    const year = T.slice(0, 4);
    const n = db.value('SELECT COUNT(*) FROM posh_complaints WHERE ref_no LIKE ?', `POSH-${year}-%`) + 1;
    const ref = `POSH-${year}-${String(n).padStart(3, '0')}`;
    db.insert('posh_complaints', {
      ref_no: ref,
      complainant_id: anonymous ? null : req.user.employeeId,
      anonymous,
      respondent: str(req.body.respondent, { max: 120 }),
      incident_date: date(req.body.incident_date, { name: 'Incident date' }),
      place: str(req.body.place, { max: 120 }),
      description: str(req.body.description, { required: true, max: 5000, name: 'Description' }),
      status: 'Received',
      due_date: D.addDays(T, 90),
      updates: [{ at: new Date().toISOString(), text: 'Complaint received by ICC.' }],
    });
    notifyUsers(db, iccUserIds(db), `A new POSH complaint (${ref}) was received. Please review it confidentially.`, '/posh');
    res.json({ ref });
  });

  r.put('/posh/complaints/:id', (req, res) => {
    if (!isIcc(db, req.user)) fail(403, 'Only ICC members can update complaints');
    const c = db.get('SELECT * FROM posh_complaints WHERE id = ?', id(req.params.id)) || notFound('Complaint');
    const status = oneOf(req.body.status || c.status, ['Received', 'Under Inquiry', 'Resolved', 'Closed'], { name: 'Status' });
    const note = str(req.body.note, { max: 1000 });
    const updates = json(c.updates, []);
    if (note || status !== c.status) updates.push({ at: new Date().toISOString(), text: note || `Status changed to ${status}.` });
    db.update('posh_complaints', c.id, { status, updates });
    if (c.complainant_id && status !== c.status) notifyUsers(db, [userIdForEmployee(db, c.complainant_id)], `Your POSH complaint ${c.ref_no} is now: ${status}`, '/posh');
    res.json({ ok: true });
  });

  r.put('/posh/icc', (req, res) => {
    requireHR(req);
    const presidingOfficerId = req.body.presidingOfficerId ? id(req.body.presidingOfficerId) : null;
    const memberIds = (Array.isArray(req.body.memberIds) ? req.body.memberIds : []).map(id).slice(0, 10);
    setSetting(db, 'icc', { presidingOfficerId, memberIds, externalMember: str(req.body.externalMember, { max: 120 }) || '' });
    audit(db, req.user, 'icc.update', 'settings', null);
    res.json({ ok: true });
  });

  r.post('/posh/remind-training', (req, res) => {
    requireHR(req);
    const users = db.all(`SELECT u.id FROM users u JOIN employees e ON e.id = u.employee_id LEFT JOIN posh_training t ON t.employee_id = e.id
      WHERE u.active = 1 AND e.status != 'Exited' AND t.employee_id IS NULL`).map((u) => u.id);
    notifyUsers(db, users, 'Reminder: please complete your POSH awareness training', '/posh');
    res.json({ ok: true, sent: users.length });
  });

}
