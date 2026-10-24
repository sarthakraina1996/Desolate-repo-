// Authorisation guards: permission checks and property scoping. A user can act on a property
// only if it belongs to their organisation and they are granted it (or hold all_properties).
import { fail, notFound } from './errors.js';
import { can } from './permissions.js';

export function requirePermission(req, permission) {
  if (!can(req.user, permission))
    fail(403, 'You do not have permission to do this', { code: 'forbidden', details: { permission } });
}

// Property ids this user may see, as an array (cached on the user object per request).
export function propertyIds(db, user) {
  if (user._propertyIds) return user._propertyIds;
  const rows = user.allProperties
    ? db.all("SELECT id FROM properties WHERE org_id = ? AND status = 'active' ORDER BY id", user.orgId)
    : db.all(
        `SELECT p.id FROM user_properties up JOIN properties p ON p.id = up.property_id
         WHERE up.user_id = ? AND p.org_id = ? AND p.status = 'active' ORDER BY p.id`,
        user.id,
        user.orgId,
      );
  user._propertyIds = rows.map((r) => r.id);
  return user._propertyIds;
}

// Throws 404 (not 403, so ids of other tenants are not confirmed) unless the property is in scope.
export function assertProperty(db, user, propertyId) {
  const pid = Number(propertyId);
  if (!Number.isInteger(pid) || !propertyIds(db, user).includes(pid)) notFound('Property');
  return pid;
}

// Loads a row of `table` by id and checks its property is in scope; 404 otherwise.
export function scopedRow(db, user, table, id, what = 'Record') {
  const row = db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row || !propertyIds(db, user).includes(row.property_id)) notFound(what);
  return row;
}

// Resolves a `property` query/body parameter: one id, or every property in scope when absent
// or 'all'. Returns an array of ids.
export function propertyScope(db, user, value) {
  if (value == null || value === '' || value === 'all') return propertyIds(db, user);
  const ids = String(value)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Boolean);
  for (const pid of ids) assertProperty(db, user, pid);
  return ids;
}

// SQL "IN (?,?,...)" for a list of ids; an empty list matches nothing.
export function inList(ids) {
  return ids.length ? `(${ids.map(() => '?').join(',')})` : '(NULL)';
}
