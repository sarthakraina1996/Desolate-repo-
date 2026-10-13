// Vertical-scoped access rules. Every read and write in core/api.js goes through these,
// so a person only ever sees projects (and their tasks, files and activity) from
// verticals they have been given access to.

export const LEVELS = ['viewer', 'member', 'manager'];
const RANK = { viewer: 1, member: 2, manager: 3 };

export function loadUser(db, id) {
  const user = db.get('SELECT * FROM users WHERE id = ? AND active = 1', id);
  if (!user) return null;
  const access = new Map();
  if (user.role === 'admin') {
    for (const v of db.all('SELECT id FROM verticals WHERE active = 1')) access.set(v.id, 'manager');
  } else {
    for (const row of db.all(
      'SELECT uv.vertical_id, uv.level FROM user_verticals uv JOIN verticals v ON v.id = uv.vertical_id WHERE uv.user_id = ? AND v.active = 1',
      id,
    )) {
      access.set(row.vertical_id, row.level);
    }
  }
  user.access = access;
  return user;
}

export const isAdmin = (user) => user?.role === 'admin';

export function levelFor(user, verticalId) {
  return user?.access?.get(Number(verticalId)) || null;
}

export function atLeast(user, verticalId, level) {
  const have = levelFor(user, verticalId);
  return !!have && RANK[have] >= RANK[level];
}

export function visibleVerticalIds(user) {
  return [...(user?.access?.keys() || [])];
}

export const canView = (user, project) => !!project && levelFor(user, project.vertical_id) !== null;

export const canManageVertical = (user, verticalId) => isAdmin(user) || atLeast(user, verticalId, 'manager');

// Managers of the vertical, or the project's owner (if they still work in that vertical).
export const canEditProject = (user, project) =>
  canManageVertical(user, project.vertical_id) ||
  (project.owner_id === user.id && atLeast(user, project.vertical_id, 'member'));

// Tasks, files, milestones and comments.
export const canContribute = (user, project) => isAdmin(user) || atLeast(user, project.vertical_id, 'member');

export function permissionsFor(user, project) {
  return {
    view: canView(user, project),
    edit: canEditProject(user, project),
    contribute: canContribute(user, project),
    manage: canManageVertical(user, project.vertical_id),
    delete: isAdmin(user),
  };
}
