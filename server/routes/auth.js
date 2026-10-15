import { createSession, destroySession, verifyPassword, hashPassword, checkPasswordStrength, loginThrottle, loadUser } from '../auth.js';
import { getSettings, str, fail, audit, today } from '../core.js';
import { endSession } from '../services/workday.js';
import { checkLocation, logLocation, readCoords, geofencePolicy } from '../services/geofence.js';
import * as D from '../lib/dates.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../seed.js';
import { aiEnabled } from '../services/ai.js';

export default function authRoutes(r, { db }) {
  r.get('/auth/config', (_req, res) => {
    const s = getSettings(db);
    res.json({
      companyName: s.companyName,
      officeOnly: geofencePolicy(s).mode !== 'off',
      demo: Boolean(s.demo),
      demoAccounts: s.demo ? DEMO_ACCOUNTS.map((a) => ({ ...a, password: DEMO_PASSWORD })) : [],
    });
  });

  r.post('/auth/login', (req, res) => {
    const email = str(req.body?.email, { required: true, name: 'Email', max: 200 }).toLowerCase();
    const password = String(req.body?.password || '');
    const guard = loginThrottle(`${req.ip}|${email}`);
    const user = db.get('SELECT id, password_hash, active FROM users WHERE email = ?', email);
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      guard.failed();
      fail(401, 'Incorrect email or password');
    }
    guard.succeeded();
    // Location check after the password, so it reveals nothing to strangers.
    const settings = getSettings(db);
    const T = today(db);
    const who = loadUser(db, user.id);
    const coords = readCoords(req.body?.location);
    const check = checkLocation(db, { user: who, coords, ip: req.ip, today: T, settings });
    if (!check.ok) {
      if (check.code !== 'location_required') logLocation(db, { user: who, event: 'sign-in blocked', coords, ip: req.ip, check });
      return res.status(403).json({ error: check.message, code: check.code, distance: check.distance ?? null, office: check.site?.name ?? null });
    }
    if (geofencePolicy(settings).mode !== 'off') logLocation(db, { user: who, event: 'sign-in', coords, ip: req.ip, check });
    db.run('UPDATE users SET last_login = ? WHERE id = ?', new Date().toISOString(), user.id);
    // Office-only sign-ins last until midnight, so each workday starts in the office.
    createSession(db, req, res, user.id, check.dayBound ? { expiresAt: D.zonedIso(D.addDays(T, 1), '00:00', settings.timezone) } : {});
    res.json({ ok: true, location: check.method === 'exempt' ? { exempt: check.exempt } : { office: check.site?.name, method: check.method, distance: check.distance ?? null } });
  });

  // pause: true stops the work clock; the next sign-in asks why the employee was away.
  r.post('/auth/logout', (req, res) => {
    let paused = null;
    if (req.user?.employeeId && req.body?.pause) paused = endSession(db, { employeeId: req.user.employeeId, date: today(db), by: 'signout', userId: req.user.id });
    destroySession(db, req, res);
    res.json({ ok: true, paused: Boolean(paused) });
  });

  r.get('/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Please sign in' });
    const s = getSettings(db);
    res.json({ user: req.user, companyName: s.companyName, demo: Boolean(s.demo), ai: aiEnabled() });
  });

  r.post('/auth/change-password', (req, res) => {
    if (!req.user) fail(401, 'Please sign in');
    const row = db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(String(req.body?.current || ''), row.password_hash)) fail(400, 'Current password is incorrect');
    const next = String(req.body?.next || '');
    checkPasswordStrength(next);
    db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(next), req.user.id);
    audit(db, req.user, 'password.change', 'user', req.user.id);
    res.json({ ok: true });
  });
}
