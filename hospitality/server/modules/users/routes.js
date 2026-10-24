// User administration: roles, property grants, activation, password resets.
import crypto from 'node:crypto';
import { fail, notFound } from '../../core/errors.js';
import { str, int, email, oneOf, bool } from '../../core/validate.js';
import { perm } from '../../core/http.js';
import { audit } from '../../core/audit.js';
import { ROLES, permissionsOf, PERMISSIONS } from '../../core/permissions.js';
import { hashPassword } from '../auth/service.js';

export default function userRoutes(r, { db }) {
  r.get('/roles', (_req, res) =>
    res.json({ roles: Object.entries(ROLES).map(([code, v]) => ({ code, ...v, permissions: permissionsOf(code) })), permissions: PERMISSIONS }),
  );

  r.get('/users', perm('users.manage'), (req, res) => {
    const users = db.all(
      'SELECT id, email, name, title, role, all_properties, active, mfa_enabled, last_login_at, created_at FROM users WHERE org_id = ? ORDER BY name',
      req.user.orgId,
    );
    const grants = db.all(
      'SELECT up.user_id, up.property_id FROM user_properties up JOIN users u ON u.id = up.user_id WHERE u.org_id = ?',
      req.user.orgId,
    );
    res.json(users.map((u) => ({ ...u, properties: grants.filter((g) => g.user_id === u.id).map((g) => g.property_id) })));
  });

  const saveGrants = (userId, orgId, ids = []) => {
    db.run('DELETE FROM user_properties WHERE user_id = ?', userId);
    for (const pid of ids) {
      if (!db.value('SELECT 1 FROM properties WHERE id = ? AND org_id = ?', pid, orgId)) fail(400, 'Property not found');
      db.run('INSERT INTO user_properties (user_id, property_id) VALUES (?, ?)', userId, pid);
    }
  };

  r.post('/users', perm('users.manage'), (req, res) => {
    const b = req.body || {};
    const role = oneOf(b.role, Object.keys(ROLES), { required: true, name: 'Role' });
    const temp = `Bh${crypto.randomBytes(6).toString('base64url')}7x`;
    const id = db.tx(() => {
      const uid = db.insert('users', {
        org_id: req.user.orgId,
        email: email(b.email, { required: true }),
        name: str(b.name, { required: true, max: 120, name: 'Name' }),
        title: str(b.title, { max: 120 }),
        role,
        all_properties: bool(b.allProperties) && ROLES[role].group ? 1 : 0,
        password_hash: hashPassword(temp),
        must_change_password: 1,
      });
      saveGrants(uid, req.user.orgId, (b.properties || []).map((x) => int(x, { min: 1 })));
      audit(db, req.user, 'user.create', { entity: 'user', entityId: uid, after: { email: b.email, role } });
      return uid;
    });
    res.status(201).json({ id, temporaryPassword: temp });
  });

  r.put('/users/:id', perm('users.manage'), (req, res) => {
    const id = int(req.params.id, { min: 1 });
    const u = db.get('SELECT * FROM users WHERE id = ? AND org_id = ?', id, req.user.orgId);
    if (!u) notFound('User');
    const b = req.body || {};
    db.tx(() => {
      const row = {};
      if (b.name !== undefined) row.name = str(b.name, { required: true, max: 120 });
      if (b.title !== undefined) row.title = str(b.title, { max: 120 });
      if (b.role !== undefined) row.role = oneOf(b.role, Object.keys(ROLES), { required: true });
      if (b.active !== undefined) {
        if (id === req.user.id && !bool(b.active)) fail(400, 'You cannot deactivate yourself');
        row.active = bool(b.active) ? 1 : 0;
      }
      if (b.allProperties !== undefined) row.all_properties = bool(b.allProperties) && ROLES[row.role || u.role].group ? 1 : 0;
      db.update('users', id, row);
      if (Array.isArray(b.properties)) saveGrants(id, req.user.orgId, b.properties.map((x) => int(x, { min: 1 })));
      if (row.active === 0) db.run('DELETE FROM sessions WHERE user_id = ?', id);
      audit(db, req.user, 'user.update', { entity: 'user', entityId: id, before: { role: u.role, active: u.active }, after: row });
    });
    res.json({ ok: true });
  });
}
