// The whole project-management API as plain functions. The Node server mounts it under
// /api, and the browser demo calls it directly against an in-browser SQLite database.
//
// handle(ctx, method, path) where ctx = { db, user, query, body, upload, services }
//   db:       { all(sql, ...p), get(sql, ...p), run(sql, ...p) -> {id, changes}, exec(sql), tx(fn) }
//   user:     result of loadUser() (row + access map), always signed in
//   services: { today(), now(), hashPassword(pw), verifyPassword(pw, hash), removeStored(key) }

import {
  HttpError, bad, notFound, forbidden, optDate, text, oneOf, optId, toId,
  parseJSON, addDays, daysBetween, placeholders, isDate,
} from './util.js';
import {
  loadUser, isAdmin, levelFor, atLeast, visibleVerticalIds, canView, canManageVertical,
  canEditProject, canContribute, permissionsFor, LEVELS,
} from './access.js';
import { FILE_CATEGORIES } from './schema.js';

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'ready', 'completed', 'cancelled'];
export const OPEN_STATUSES = ['planning', 'active', 'on_hold', 'ready'];
const OPEN_IN = "('planning','active','on_hold','ready')";
// Comments can be deleted this long after posting; later a head has to approve it.
export const DELETE_WINDOW_MS = 15000;
const DELETE_GRACE_MS = 5000; // allows for network delay between the click and the request
export const HEALTH = ['on_track', 'at_risk', 'off_track'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'blocked', 'done'];
const DEFAULT_STAGES = ['Plan', 'Execute', 'Deliver', 'Close'];

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ method, re, keys, handler });
}

export async function handle(ctx, method, path) {
  for (const rt of routes) {
    if (rt.method !== method) continue;
    const m = rt.re.exec(path);
    if (!m) continue;
    const params = {};
    rt.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const c = { ...ctx, params, query: ctx.query || {}, body: ctx.body || {} };
    c.today = ctx.services.today();
    c.now = ctx.services.now();
    return await rt.handler(c);
  }
  throw new HttpError(404, 'Not found', 'not_found');
}

// ---------------------------------------------------------------- helpers

const uid = (ctx) => ctx.user.id;

function log(ctx, project_id, action, detail = '', task_id = null) {
  ctx.db.run(
    'INSERT INTO activity (project_id, task_id, user_id, action, detail, created_at) VALUES (?,?,?,?,?,?)',
    project_id, task_id, uid(ctx), action, detail, ctx.now,
  );
}

function notify(ctx, user_id, project_id, textMsg, task_id = null) {
  if (!user_id || user_id === uid(ctx)) return;
  ctx.db.run(
    'INSERT INTO notifications (user_id, project_id, task_id, text, created_at) VALUES (?,?,?,?,?)',
    user_id, project_id, task_id, textMsg, ctx.now,
  );
}

// Vertical ids the request may read, narrowed by ?vertical= when given.
function scopeVerticals(ctx) {
  const visible = visibleVerticalIds(ctx.user);
  const v = ctx.query.vertical ? Number(ctx.query.vertical) : null;
  if (v) return visible.includes(v) ? [v] : [];
  return visible;
}

const PROJECT_COLS = `p.*, v.short AS vertical, v.name AS vertical_name, v.color AS vertical_color, v.key_date_label, v.ready_label,
  o.name AS owner_name, o.color AS owner_color,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_total,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS task_done,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < ?) AS task_overdue,
  (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count,
  (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id AND f.is_final = 1) AS final_count,
  (SELECT f.id || '|' || COALESCE(f.storage_key, '') || '|' || f.mime FROM files f
    WHERE f.project_id = p.id AND f.mime LIKE 'image/%' ORDER BY f.is_final DESC, f.id DESC LIMIT 1) AS cover`;
const PROJECT_FROM = 'FROM projects p JOIN verticals v ON v.id = p.vertical_id LEFT JOIN users o ON o.id = p.owner_id';

// "12|key|image/png" -> { id, storage_key, mime }, the image shown on board cards.
function parseCover(c) {
  if (!c) return null;
  const [id, storage_key, mime] = String(c).split('|');
  return { id: Number(id), storage_key, mime, kind: 'file' };
}

function shapeProject(row, today) {
  if (!row) return row;
  const open = OPEN_STATUSES.includes(row.status);
  return {
    ...row,
    cover: parseCover(row.cover),
    stages: parseJSON(row.stages, []),
    tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    progress: row.task_total ? Math.round((row.task_done / row.task_total) * 100) : row.status === 'completed' ? 100 : 0,
    open,
    late: open && !!row.due_date && row.due_date < today,
  };
}

function getProjectRaw(ctx, id) {
  const p = ctx.db.get('SELECT * FROM projects WHERE id = ?', toId(id, 'Project'));
  // Hidden projects look exactly like missing ones.
  if (!p || !canView(ctx.user, p)) throw notFound('Project');
  return p;
}

function getProjectFull(ctx, id) {
  getProjectRaw(ctx, id);
  return shapeProject(ctx.db.get(`SELECT ${PROJECT_COLS} ${PROJECT_FROM} WHERE p.id = ?`, ctx.today, Number(id)), ctx.today);
}

function getTaskRaw(ctx, id) {
  const t = ctx.db.get('SELECT * FROM tasks WHERE id = ?', toId(id, 'Task'));
  if (!t) throw notFound('Task');
  const p = ctx.db.get('SELECT * FROM projects WHERE id = ?', t.project_id);
  if (!p || !canView(ctx.user, p)) throw notFound('Task');
  return { task: t, project: p };
}

// People who can be assigned work in a vertical (members, managers and admins).
function assertAssignable(ctx, userId, verticalId) {
  if (!userId) return;
  const u = loadUser(ctx.db, userId);
  if (!u || !atLeast(u, verticalId, 'member')) throw bad('That person does not have access to this vertical');
}

function assertCanSee(ctx, userId, verticalId) {
  if (!userId) return;
  const u = loadUser(ctx.db, userId);
  if (!u || !levelFor(u, verticalId)) throw bad('That person does not have access to this vertical');
}

function userBrief(db, id) {
  return id ? db.get('SELECT id, name, title, color FROM users WHERE id = ?', id) : null;
}

function nextCode(db, vertical, dateStr) {
  const prefix = `${vertical.code}-${dateStr.slice(2, 4)}`;
  const row = db.get(
    'SELECT MAX(CAST(substr(code, ?) AS INTEGER)) AS n FROM projects WHERE code LIKE ?',
    prefix.length + 2, prefix + '-%',
  );
  let n = (row?.n || 0) + 1;
  let code;
  do {
    code = `${prefix}-${String(n).padStart(3, '0')}`;
    n++;
  } while (db.get('SELECT 1 AS x FROM projects WHERE code = ?', code));
  return code;
}

const anchorOf = (p) => p.key_date || p.due_date || p.start_date || null;

function shapeTask(t, today) {
  return {
    ...t,
    cover: parseCover(t.cover),
    checklist: parseJSON(t.checklist, []),
    overdue: t.status !== 'done' && !!t.due_date && t.due_date < today,
  };
}

const TASK_COLS = `t.*, u.name AS assignee_name, u.color AS assignee_color,
  (SELECT COUNT(*) FROM comments c WHERE c.task_id = t.id) AS comment_count,
  (SELECT COUNT(*) FROM files f WHERE f.task_id = t.id) AS file_count,
  (SELECT f.id || '|' || COALESCE(f.storage_key, '') || '|' || f.mime FROM files f
    WHERE f.task_id = t.id AND f.mime LIKE 'image/%' ORDER BY f.is_final DESC, f.id DESC LIMIT 1) AS cover`;

function readProjectFields(body, { creating = false } = {}) {
  const f = {
    name: text(body.name, { max: 160, label: 'Project name', required: creating }),
    client: text(body.client, { max: 160, label: 'Client' }),
    description: text(body.description, { max: 10000, label: 'Description' }),
    status: oneOf(body.status, PROJECT_STATUSES, 'Status'),
    health: oneOf(body.health, HEALTH, 'Health'),
    priority: oneOf(body.priority, PRIORITIES, 'Priority'),
    stage: text(body.stage, { max: 80, label: 'Stage' }),
    owner_id: optId(body.owner_id),
    start_date: optDate(body.start_date, 'Start date'),
    due_date: optDate(body.due_date, 'Due date'),
    key_date: optDate(body.key_date, 'Key date'),
    venue: text(body.venue, { max: 200, label: 'Venue' }),
    city: text(body.city, { max: 80, label: 'City' }),
    tags: body.tags === undefined ? undefined : (Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(','))
      .map((t) => String(t).trim()).filter(Boolean).slice(0, 20).join(','),
  };
  if (body.name !== undefined && !f.name) throw bad('Project name is required');
  if (body.budget !== undefined) {
    if (body.budget === null || body.budget === '') f.budget = null;
    else {
      const n = Number(body.budget);
      if (!Number.isFinite(n) || n < 0) throw bad('Budget must be a positive number');
      f.budget = n;
    }
  }
  if (body.board_sort !== undefined) {
    const n = Number(body.board_sort);
    if (!Number.isFinite(n)) throw bad('Invalid board position');
    f.board_sort = n;
  }
  if (body.stages !== undefined) {
    if (!Array.isArray(body.stages)) throw bad('Stages must be a list');
    const stages = body.stages.map((s) => String(s).trim()).filter(Boolean).slice(0, 15);
    if (!stages.length) throw bad('Add at least one stage');
    f.stages = JSON.stringify(stages);
  }
  return f;
}

function assertStatusFits(status, vertical) {
  if (status === 'ready' && !vertical?.ready_label) {
    throw bad(`${vertical?.short || 'This vertical'} projects go from Active straight to Delivered`);
  }
}

function checkDates(p) {
  if (p.start_date && p.due_date && p.due_date < p.start_date) throw bad('Due date cannot be before the start date');
}

// ---------------------------------------------------------------- session / bootstrap

route('GET', '/bootstrap', (ctx) => {
  const { db, user } = ctx;
  const vids = visibleVerticalIds(user);
  const verticals = vids.length
    ? db.all(`SELECT * FROM verticals WHERE id IN (${placeholders(vids)}) AND active = 1 ORDER BY sort, id`, ...vids)
    : [];
  for (const v of verticals) v.level = levelFor(user, v.id);

  // Directory of people who share at least one vertical with me (admins see everyone).
  const people = db.all('SELECT id, name, email, title, color, role FROM users WHERE active = 1 ORDER BY name');
  const accessRows = db.all('SELECT user_id, vertical_id, level FROM user_verticals');
  const allV = db.all('SELECT id FROM verticals').map((v) => v.id);
  const byUser = new Map();
  for (const r of accessRows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, {});
    byUser.get(r.user_id)[r.vertical_id] = r.level;
  }
  const users = [];
  for (const p of people) {
    const acc = p.role === 'admin' ? Object.fromEntries(allV.map((id) => [id, 'manager'])) : byUser.get(p.id) || {};
    const shared = Object.keys(acc).some((id) => vids.includes(Number(id)));
    if (isAdmin(user) || p.id === user.id || shared) {
      // Only reveal access for verticals the viewer can see.
      const visibleAcc = Object.fromEntries(Object.entries(acc).filter(([id]) => vids.includes(Number(id))));
      users.push({ ...p, email: isAdmin(user) || shared ? p.email : '', access: visibleAcc });
    }
  }

  const templates = vids.length
    ? db.all(`SELECT id, vertical_id, name, description, stages FROM templates WHERE vertical_id IN (${placeholders(vids)}) ORDER BY name`, ...vids)
      .map((t) => ({ ...t, stages: parseJSON(t.stages, []) }))
    : [];

  const settings = Object.fromEntries(db.all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
  return {
    me: meShape(user),
    verticals,
    users,
    templates,
    categories: FILE_CATEGORIES,
    settings: { company_name: settings.company_name || 'BrainADZ' },
    unread: db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', user.id).n,
    today: ctx.today,
  };
});

function meShape(user) {
  return {
    id: user.id, name: user.name, email: user.email, title: user.title, phone: user.phone, color: user.color,
    role: user.role, must_change_password: !!user.must_change_password,
    access: Object.fromEntries(user.access),
  };
}

route('PATCH', '/me', (ctx) => {
  const b = ctx.body;
  const f = {
    name: text(b.name, { max: 120, label: 'Name' }),
    title: text(b.title, { max: 120, label: 'Title' }),
    phone: text(b.phone, { max: 40, label: 'Phone' }),
    color: b.color === undefined ? undefined : /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : undefined,
  };
  if (f.name === '') throw bad('Name is required');
  const sets = Object.entries(f).filter(([, v]) => v !== undefined);
  if (sets.length) ctx.db.run(`UPDATE users SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v), uid(ctx));
  return meShape(loadUser(ctx.db, uid(ctx)));
});

route('POST', '/me/password', async (ctx) => {
  const { current, next } = ctx.body;
  const row = ctx.db.get('SELECT password_hash FROM users WHERE id = ?', uid(ctx));
  if (!ctx.user.must_change_password || current) {
    if (!(await ctx.services.verifyPassword(String(current || ''), row.password_hash))) throw bad('Your current password is not correct');
  }
  if (typeof next !== 'string' || next.length < 8) throw bad('Use at least 8 characters for the new password');
  ctx.db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await ctx.services.hashPassword(next), uid(ctx));
  return { ok: true };
});

// ---------------------------------------------------------------- dashboard

route('GET', '/dashboard', (ctx) => {
  const { db, today } = ctx;
  const vids = scopeVerticals(ctx);
  const year = today.slice(0, 4);
  const weekEnd = addDays(today, 6);
  const empty = { kpis: { active: 0, planning: 0, due_week: 0, overdue: 0, delivered: 0, at_risk: 0 }, my_tasks: [], attention: [], upcoming: [], by_vertical: [], activity: [] };
  if (!vids.length) return empty;
  const inV = `p.vertical_id IN (${placeholders(vids)})`;
  const openP = `p.status IN ${OPEN_IN}`;

  const k = db.get(
    `SELECT
      SUM(CASE WHEN p.status IN ('active','ready') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN p.status IN ('planning','on_hold') THEN 1 ELSE 0 END) AS planning,
      SUM(CASE WHEN ${openP} AND p.health != 'on_track' THEN 1 ELSE 0 END) AS at_risk,
      SUM(CASE WHEN p.status = 'completed' AND substr(p.completed_at, 1, 4) = ? THEN 1 ELSE 0 END) AS delivered
     FROM projects p WHERE ${inV}`,
    year, ...vids,
  );
  const t = db.get(
    `SELECT
      SUM(CASE WHEN t.due_date >= ? AND t.due_date <= ? THEN 1 ELSE 0 END) AS due_week,
      SUM(CASE WHEN t.due_date < ? THEN 1 ELSE 0 END) AS overdue
     FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE ${inV} AND ${openP} AND t.status != 'done'`,
    today, weekEnd, today, ...vids,
  );

  const myTasks = db.all(
    `SELECT t.*, p.code, p.name AS project_name, v.color AS vertical_color, v.short AS vertical
     FROM tasks t JOIN projects p ON p.id = t.project_id JOIN verticals v ON v.id = p.vertical_id
     WHERE ${inV} AND ${openP} AND t.assignee_id = ? AND t.status != 'done'
     ORDER BY t.due_date IS NULL, t.due_date, t.priority = 'urgent' DESC LIMIT 8`,
    ...vids, uid(ctx),
  ).map((x) => shapeTask(x, today));

  const attention = db.all(
    `SELECT ${PROJECT_COLS} ${PROJECT_FROM} WHERE ${inV} AND ${openP}
       AND (p.health != 'on_track' OR p.due_date < ? OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < ?))
     ORDER BY p.health = 'off_track' DESC, p.due_date LIMIT 8`,
    today, ...vids, today, today,
  ).map((p) => shapeProject(p, today));

  const horizon = addDays(today, 60);
  const upcoming = [];
  for (const p of db.all(
    `SELECT p.id, p.code, p.name, p.client, p.key_date, p.due_date, p.venue, p.city, v.short AS vertical, v.color AS vertical_color, v.key_date_label
     FROM projects p JOIN verticals v ON v.id = p.vertical_id
     WHERE ${inV} AND ${openP} AND ((p.key_date >= ? AND p.key_date <= ?) OR (p.due_date >= ? AND p.due_date <= ?))`,
    ...vids, today, horizon, today, horizon,
  )) {
    if (p.key_date && p.key_date >= today && p.key_date <= horizon) upcoming.push({ type: 'key', date: p.key_date, label: p.key_date_label, project: p });
    if (p.due_date && p.due_date >= today && p.due_date <= horizon && p.due_date !== p.key_date) upcoming.push({ type: 'due', date: p.due_date, label: 'Project due', project: p });
  }
  for (const m of db.all(
    `SELECT m.*, p.code, p.name AS project_name, p.client, v.short AS vertical, v.color AS vertical_color
     FROM milestones m JOIN projects p ON p.id = m.project_id JOIN verticals v ON v.id = p.vertical_id
     WHERE ${inV} AND ${openP} AND m.done = 0 AND m.due_date >= ? AND m.due_date <= ? AND (p.key_date IS NULL OR m.due_date != p.key_date)`,
    ...vids, today, horizon,
  )) {
    upcoming.push({ type: 'milestone', date: m.due_date, label: m.title, project: { id: m.project_id, code: m.code, name: m.project_name, client: m.client, vertical: m.vertical, vertical_color: m.vertical_color } });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'key' ? -1 : 1));

  const by_vertical = db.all(
    `SELECT v.id, v.short, v.name, v.color,
      SUM(CASE WHEN p.status IN ${OPEN_IN} THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN p.status IN ('active','ready') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN p.status IN ${OPEN_IN} AND p.health != 'on_track' THEN 1 ELSE 0 END) AS at_risk,
      SUM(CASE WHEN p.status = 'completed' AND substr(p.completed_at, 1, 4) = ? THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN p.status IN ${OPEN_IN} THEN COALESCE(p.budget, 0) ELSE 0 END) AS open_budget
     FROM verticals v LEFT JOIN projects p ON p.vertical_id = v.id
     WHERE v.id IN (${placeholders(vids)}) AND v.active = 1 GROUP BY v.id ORDER BY v.sort, v.id`,
    year, ...vids,
  );

  return {
    kpis: {
      active: k.active || 0, planning: k.planning || 0, at_risk: k.at_risk || 0, delivered: k.delivered || 0,
      due_week: t.due_week || 0, overdue: t.overdue || 0,
    },
    my_tasks: myTasks,
    attention,
    upcoming: upcoming.slice(0, 12),
    by_vertical,
    activity: recentActivity(ctx, vids, null, 14),
  };
});

function recentActivity(ctx, vids, projectId, limit) {
  const where = projectId ? 'a.project_id = ?' : `p.vertical_id IN (${placeholders(vids)})`;
  const params = projectId ? [projectId] : vids;
  return ctx.db.all(
    `SELECT a.*, u.name AS user_name, u.color AS user_color, p.code, p.name AS project_name, v.color AS vertical_color, t.title AS task_title
     FROM activity a JOIN projects p ON p.id = a.project_id JOIN verticals v ON v.id = p.vertical_id
     LEFT JOIN users u ON u.id = a.user_id LEFT JOIN tasks t ON t.id = a.task_id
     WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    ...params, limit,
  );
}

// ---------------------------------------------------------------- projects

route('GET', '/projects', (ctx) => {
  const { db, query: q, today } = ctx;
  const vids = scopeVerticals(ctx);
  if (!vids.length) return { items: [] };
  const where = [`p.vertical_id IN (${placeholders(vids)})`];
  const params = [...vids];
  const scope = q.scope || 'open';
  if (scope === 'open') where.push(`p.status IN ${OPEN_IN}`);
  else if (scope === 'past') where.push(`p.status IN ('completed','cancelled')`);
  if (q.status && PROJECT_STATUSES.includes(q.status)) { where.push('p.status = ?'); params.push(q.status); }
  if (q.health && HEALTH.includes(q.health)) { where.push('p.health = ?'); params.push(q.health); }
  if (q.owner) { where.push('p.owner_id = ?'); params.push(q.owner === 'me' ? uid(ctx) : Number(q.owner)); }
  if (q.member === 'me') {
    where.push('(p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?) OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.assignee_id = ?))');
    params.push(uid(ctx), uid(ctx), uid(ctx));
  }
  if (q.client) { where.push('p.client = ?'); params.push(q.client); }
  if (q.city) { where.push('p.city = ?'); params.push(q.city); }
  if (q.year && /^\d{4}$/.test(q.year)) {
    where.push('substr(COALESCE(p.key_date, p.due_date, p.completed_at, p.created_at), 1, 4) = ?');
    params.push(q.year);
  }
  if (q.q) {
    const like = `%${String(q.q).trim()}%`;
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.client LIKE ? OR p.tags LIKE ? OR p.venue LIKE ? OR p.city LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  const order = scope === 'past'
    ? 'COALESCE(p.key_date, p.due_date, p.completed_at) DESC'
    : "CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END, p.due_date IS NULL, COALESCE(p.key_date, p.due_date)";
  const items = db.all(`SELECT ${PROJECT_COLS} ${PROJECT_FROM} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`, today, ...params)
    .map((p) => shapeProject(p, today));
  return { items };
});

route('GET', '/projects/facets', (ctx) => {
  const vids = scopeVerticals(ctx);
  if (!vids.length) return { clients: [], cities: [], years: [] };
  const inV = `vertical_id IN (${placeholders(vids)})`;
  return {
    clients: ctx.db.all(`SELECT client AS name, COUNT(*) AS n, MAX(COALESCE(key_date, due_date)) AS last FROM projects WHERE ${inV} AND client != '' GROUP BY client ORDER BY client`, ...vids),
    cities: ctx.db.all(`SELECT DISTINCT city FROM projects WHERE ${inV} AND city != '' ORDER BY city`, ...vids).map((r) => r.city),
    years: ctx.db.all(`SELECT DISTINCT substr(COALESCE(key_date, due_date, completed_at, created_at), 1, 4) AS y FROM projects WHERE ${inV} ORDER BY y DESC`, ...vids).map((r) => r.y).filter(Boolean),
  };
});

route('POST', '/projects', (ctx) => {
  const { db, body, today } = ctx;
  const verticalId = Number(body.vertical_id);
  const vertical = db.get('SELECT * FROM verticals WHERE id = ? AND active = 1', verticalId);
  if (!vertical || !levelFor(ctx.user, verticalId)) throw bad('Choose a vertical you have access to');
  if (!canManageVertical(ctx.user, verticalId)) throw forbidden(`Only ${vertical.short} managers can create projects`);
  const f = readProjectFields(body, { creating: true });
  checkDates(f);
  assertStatusFits(f.status, vertical);
  const ownerId = f.owner_id || uid(ctx);
  assertAssignable(ctx, ownerId, verticalId);

  let template = null;
  let source = null;
  if (body.copy_from) {
    source = getProjectRaw(ctx, body.copy_from);
  } else if (body.template_id) {
    template = db.get('SELECT * FROM templates WHERE id = ? AND vertical_id = ?', Number(body.template_id), verticalId);
    if (!template) throw bad('That template is not available for this vertical');
  }
  const stages = f.stages
    ? JSON.parse(f.stages)
    : source ? parseJSON(source.stages, DEFAULT_STAGES) : template ? parseJSON(template.stages, DEFAULT_STAGES) : DEFAULT_STAGES;

  return db.tx(() => {
    const code = nextCode(db, vertical, f.start_date || today);
    const status = f.status || 'planning';
    const { id } = db.run(
      `INSERT INTO projects (code, vertical_id, name, client, description, status, health, priority, stages, stage, owner_id,
        start_date, due_date, key_date, venue, city, budget, tags, template_id, completed_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      code, verticalId, f.name, f.client || '', f.description || '', status, f.health || 'on_track', f.priority || 'medium',
      JSON.stringify(stages), f.stage && stages.includes(f.stage) ? f.stage : stages[0], ownerId,
      f.start_date ?? today, f.due_date ?? null, f.key_date ?? null, f.venue || '', f.city || '', f.budget ?? null, f.tags || '',
      template?.id ?? null, status === 'completed' ? ctx.now : null, uid(ctx), ctx.now, ctx.now,
    );
    const project = db.get('SELECT * FROM projects WHERE id = ?', id);
    const members = new Set([ownerId, ...(Array.isArray(body.member_ids) ? body.member_ids.map(Number) : [])]);
    if (source) for (const m of db.all('SELECT user_id FROM project_members WHERE project_id = ?', source.id)) members.add(m.user_id);
    for (const m of members) {
      const u = loadUser(db, m);
      if (u && levelFor(u, verticalId)) db.run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', id, m);
    }

    const newAnchor = anchorOf(project);
    const floor = project.start_date && project.start_date > today ? project.start_date : today;
    let created = 0;
    if (source) {
      const oldAnchor = anchorOf(source);
      const shift = oldAnchor && newAnchor ? daysBetween(oldAnchor, newAnchor) : null;
      const move = (d) => (d && shift !== null ? addDays(d, shift) : null);
      for (const t of db.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort, id', source.id)) {
        let assignee = t.assignee_id;
        if (assignee) {
          const u = loadUser(db, assignee);
          if (!u || !atLeast(u, verticalId, 'member')) assignee = null;
        }
        const checklist = parseJSON(t.checklist, []).map((c) => ({ text: c.text, done: false }));
        db.run(
          `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, stage, start_date, due_date, checklist, sort, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id, t.title, t.description, 'todo', t.priority, assignee, t.stage, move(t.start_date), move(t.due_date),
          JSON.stringify(checklist), t.sort, uid(ctx), ctx.now, ctx.now,
        );
        created++;
      }
      for (const m of db.all('SELECT * FROM milestones WHERE project_id = ? ORDER BY sort, id', source.id)) {
        db.run('INSERT INTO milestones (project_id, title, due_date, sort) VALUES (?,?,?,?)', id, m.title, move(m.due_date), m.sort);
      }
      log(ctx, id, 'created', `Copied from ${source.code} · ${source.name}`);
    } else if (template) {
      const at = (offset) => {
        if (!newAnchor) return null;
        const d = addDays(newAnchor, Number(offset) || 0);
        return d < floor ? floor : d;
      };
      parseJSON(template.tasks, []).forEach((t, i) => {
        db.run(
          `INSERT INTO tasks (project_id, title, description, status, priority, stage, due_date, sort, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          id, t.title, t.description || '', 'todo', PRIORITIES.includes(t.priority) ? t.priority : 'medium',
          stages.includes(t.stage) ? t.stage : stages[0], at(t.offset), i + 1, uid(ctx), ctx.now, ctx.now,
        );
        created++;
      });
      parseJSON(template.milestones, []).forEach((m, i) => {
        db.run('INSERT INTO milestones (project_id, title, due_date, sort) VALUES (?,?,?,?)', id, m.title, at(m.offset), i + 1);
      });
      log(ctx, id, 'created', `From template “${template.name}”`);
    } else {
      log(ctx, id, 'created', '');
    }
    notify(ctx, ownerId, id, `${ctx.user.name} made you the owner of ${code} · ${f.name}`);
    return { ...getProjectFull(ctx, id), tasks_created: created };
  });
});

route('GET', '/projects/:id', (ctx) => {
  const p = getProjectFull(ctx, ctx.params.id);
  const { db } = ctx;
  const members = db.all(
    `SELECT u.id, u.name, u.title, u.color, u.email FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? ORDER BY u.name`,
    p.id,
  );
  const milestones = db.all('SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date IS NULL, due_date, sort, id', p.id);
  const taskStats = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0]));
  for (const r of db.all('SELECT status, COUNT(*) AS n FROM tasks WHERE project_id = ? GROUP BY status', p.id)) taskStats[r.status] = r.n;
  const stageStats = db.all(
    `SELECT stage, COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done FROM tasks WHERE project_id = ? GROUP BY stage`,
    p.id,
  );
  const upcoming = db.all(
    `SELECT ${TASK_COLS} FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = ? AND t.status != 'done' ORDER BY t.due_date IS NULL, t.due_date LIMIT 6`,
    p.id,
  ).map((t) => shapeTask(t, ctx.today));
  const created_by = userBrief(db, p.created_by);
  return { ...p, members, milestones, task_stats: taskStats, stage_stats: stageStats, upcoming_tasks: upcoming, created_by_user: created_by, permissions: permissionsFor(ctx.user, p) };
});

const FIELD_LABELS = {
  name: 'name', client: 'client', status: 'status', health: 'health', priority: 'priority', stage: 'stage',
  owner_id: 'owner', start_date: 'start date', due_date: 'due date', key_date: 'key date', venue: 'venue',
  city: 'city', budget: 'budget', description: 'description', tags: 'tags', stages: 'stages',
};

route('PATCH', '/projects/:id', (ctx) => {
  const { db, body } = ctx;
  const p = getProjectRaw(ctx, ctx.params.id);
  if (!canEditProject(ctx.user, p)) throw forbidden('Only the project owner or a vertical manager can edit this project');
  const f = readProjectFields(body);
  if (body.vertical_id !== undefined && Number(body.vertical_id) !== p.vertical_id) {
    const nv = Number(body.vertical_id);
    if (!canManageVertical(ctx.user, p.vertical_id) || !canManageVertical(ctx.user, nv)) throw forbidden('Only managers of both verticals can move a project');
    f.vertical_id = nv;
  }
  const vId = f.vertical_id || p.vertical_id;
  if (f.owner_id !== undefined && f.owner_id !== p.owner_id) {
    if (!f.owner_id) throw bad('A project needs an owner');
    assertAssignable(ctx, f.owner_id, vId);
  }
  const merged = { ...p, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) };
  checkDates(merged);
  if (f.status !== undefined || f.vertical_id !== undefined) {
    assertStatusFits(merged.status, db.get('SELECT short, ready_label FROM verticals WHERE id = ?', vId));
  }
  if (f.stages !== undefined) {
    const st = JSON.parse(f.stages);
    if (!st.includes(merged.stage)) f.stage = st[0];
  } else if (f.stage !== undefined && f.stage && !parseJSON(p.stages, []).includes(f.stage)) {
    throw bad('Unknown stage');
  }
  if (f.status !== undefined && f.status !== p.status) {
    f.completed_at = f.status === 'completed' ? ctx.now : null;
  }
  const sets = Object.entries(f).filter(([, v]) => v !== undefined);
  if (!sets.length) return getProjectFull(ctx, p.id);
  return db.tx(() => {
    db.run(`UPDATE projects SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...sets.map(([, v]) => v), ctx.now, p.id);
    const changed = sets.filter(([k, v]) => k !== 'completed_at' && String(p[k] ?? '') !== String(v ?? '')).map(([k]) => k);
    if (changed.includes('status')) log(ctx, p.id, 'status', f.status);
    if (changed.includes('stage')) log(ctx, p.id, 'stage', f.stage);
    if (changed.includes('health')) log(ctx, p.id, 'health', f.health);
    if (changed.includes('owner_id')) {
      const o = userBrief(db, f.owner_id);
      log(ctx, p.id, 'owner', o?.name || '');
      notify(ctx, f.owner_id, p.id, `${ctx.user.name} made you the owner of ${p.code} · ${merged.name}`);
    }
    if (changed.includes('vertical_id')) {
      const v = db.get('SELECT short FROM verticals WHERE id = ?', f.vertical_id);
      log(ctx, p.id, 'moved', v?.short || '');
    }
    const other = changed.filter((k) => !['status', 'stage', 'health', 'owner_id', 'vertical_id', 'board_sort'].includes(k));
    if (other.length) log(ctx, p.id, 'updated', other.map((k) => FIELD_LABELS[k] || k).join(', '));
    return getProjectFull(ctx, p.id);
  });
});

route('DELETE', '/projects/:id', async (ctx) => {
  const p = getProjectRaw(ctx, ctx.params.id);
  if (!isAdmin(ctx.user)) throw forbidden('Only admins can delete projects. Close it instead to keep its history.');
  const keys = ctx.db.all("SELECT storage_key FROM files WHERE project_id = ? AND kind = 'file' AND storage_key IS NOT NULL", p.id).map((r) => r.storage_key);
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM notifications WHERE project_id = ?', p.id);
    ctx.db.run('DELETE FROM projects WHERE id = ?', p.id);
  });
  for (const k of keys) await ctx.services.removeStored?.(k);
  return { ok: true };
});

route('PUT', '/projects/:id/members', (ctx) => {
  const p = getProjectRaw(ctx, ctx.params.id);
  if (!canEditProject(ctx.user, p)) throw forbidden();
  const ids = [...new Set((ctx.body.user_ids || []).map(Number).filter(Boolean))];
  for (const id of ids) assertCanSee(ctx, id, p.vertical_id);
  const before = new Set(ctx.db.all('SELECT user_id FROM project_members WHERE project_id = ?', p.id).map((r) => r.user_id));
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM project_members WHERE project_id = ?', p.id);
    for (const id of ids) ctx.db.run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', p.id, id);
    const added = ids.filter((id) => !before.has(id));
    for (const id of added) notify(ctx, id, p.id, `${ctx.user.name} added you to ${p.code} · ${p.name}`);
    if (added.length || before.size !== ids.length) log(ctx, p.id, 'team', `${ids.length} people`);
  });
  return { members: ctx.db.all('SELECT u.id, u.name, u.title, u.color, u.email FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY u.name', p.id) };
});

route('GET', '/projects/:id/activity', (ctx) => {
  const p = getProjectRaw(ctx, ctx.params.id);
  const comments = ctx.db.all(
    `SELECT ${COMMENT_COLS}, t.title AS task_title FROM comments c
     LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users d ON d.id = c.delete_decided_by LEFT JOIN tasks t ON t.id = c.task_id
     WHERE c.project_id = ? ORDER BY c.id DESC LIMIT 200`,
    p.id,
  );
  return { comments: comments.map((c) => shapeComment(ctx, c, p)), activity: recentActivity(ctx, null, p.id, 200) };
});

// ---------------------------------------------------------------- tasks

route('GET', '/projects/:id/tasks', (ctx) => {
  const p = getProjectRaw(ctx, ctx.params.id);
  const items = ctx.db.all(
    `SELECT ${TASK_COLS} FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.project_id = ? ORDER BY t.sort, t.id`,
    p.id,
  ).map((t) => shapeTask(t, ctx.today));
  return { items };
});

function readTaskFields(body, { creating = false } = {}) {
  const f = {
    title: text(body.title, { max: 240, label: 'Task title', required: creating }),
    description: text(body.description, { max: 10000, label: 'Description' }),
    status: oneOf(body.status, TASK_STATUSES, 'Status'),
    priority: oneOf(body.priority, PRIORITIES, 'Priority'),
    assignee_id: optId(body.assignee_id),
    stage: text(body.stage, { max: 80, label: 'Stage' }),
    start_date: optDate(body.start_date, 'Start date'),
    due_date: optDate(body.due_date, 'Due date'),
  };
  if (body.title !== undefined && !f.title) throw bad('Task title is required');
  if (body.sort !== undefined) {
    const n = Number(body.sort);
    if (!Number.isFinite(n)) throw bad('Invalid order');
    f.sort = n;
  }
  if (body.checklist !== undefined) {
    if (!Array.isArray(body.checklist)) throw bad('Checklist must be a list');
    f.checklist = JSON.stringify(
      body.checklist.slice(0, 50).map((c) => ({ text: String(c.text || '').slice(0, 300), done: !!c.done })).filter((c) => c.text.trim()),
    );
  }
  return f;
}

route('POST', '/projects/:id/tasks', (ctx) => {
  const { db } = ctx;
  const p = getProjectRaw(ctx, ctx.params.id);
  if (!canContribute(ctx.user, p)) throw forbidden('You have view-only access to this vertical');
  const f = readTaskFields(ctx.body, { creating: true });
  if (f.start_date && f.due_date && f.due_date < f.start_date) throw bad('Due date cannot be before the start date');
  assertAssignable(ctx, f.assignee_id, p.vertical_id);
  const stages = parseJSON(p.stages, []);
  const sort = f.sort ?? (db.get('SELECT MAX(sort) AS m FROM tasks WHERE project_id = ?', p.id).m || 0) + 1;
  return db.tx(() => {
    const status = f.status || 'todo';
    const { id } = db.run(
      `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, stage, start_date, due_date, checklist, sort, created_by, created_at, updated_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      p.id, f.title, f.description || '', status, f.priority || 'medium', f.assignee_id ?? null,
      f.stage && stages.includes(f.stage) ? f.stage : p.stage || stages[0] || '', f.start_date ?? null, f.due_date ?? null,
      f.checklist || '[]', sort, uid(ctx), ctx.now, ctx.now, status === 'done' ? ctx.now : null,
    );
    log(ctx, p.id, 'task_added', f.title, id);
    if (f.assignee_id) notify(ctx, f.assignee_id, p.id, `${ctx.user.name} assigned you “${f.title}” in ${p.code}`, id);
    return taskDetail(ctx, id);
  });
});

function taskDetail(ctx, id) {
  const t = ctx.db.get(`SELECT ${TASK_COLS} FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.id = ?`, id);
  return shapeTask(t, ctx.today);
}

route('GET', '/tasks/:id', (ctx) => {
  const { task, project } = getTaskRaw(ctx, ctx.params.id);
  const comments = ctx.db.all(
    `SELECT ${COMMENT_COLS} FROM comments c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users d ON d.id = c.delete_decided_by WHERE c.task_id = ? ORDER BY c.id`,
    task.id,
  ).map((c) => shapeComment(ctx, c, project));
  const files = ctx.db.all('SELECT f.*, u.name AS uploader_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.task_id = ? ORDER BY f.id DESC', task.id);
  const history = ctx.db.all(
    'SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id DESC LIMIT 30',
    task.id,
  );
  const v = ctx.db.get('SELECT short, color FROM verticals WHERE id = ?', project.vertical_id);
  return {
    ...taskDetail(ctx, task.id),
    comments, files, history,
    created_by_user: userBrief(ctx.db, task.created_by),
    project: { id: project.id, code: project.code, name: project.name, vertical_id: project.vertical_id, vertical: v.short, vertical_color: v.color, stages: parseJSON(project.stages, []), status: project.status },
    permissions: { edit: canContribute(ctx.user, project), delete: canEditProject(ctx.user, project) || task.created_by === uid(ctx) && canContribute(ctx.user, project) },
  };
});

const STATUS_WORDS = { todo: 'To do', in_progress: 'In progress', review: 'In review', blocked: 'Blocked', done: 'Done' };

route('PATCH', '/tasks/:id', (ctx) => {
  const { db } = ctx;
  const { task, project } = getTaskRaw(ctx, ctx.params.id);
  if (!canContribute(ctx.user, project)) throw forbidden('You have view-only access to this vertical');
  const f = readTaskFields(ctx.body);
  if (f.assignee_id !== undefined && f.assignee_id !== task.assignee_id) assertAssignable(ctx, f.assignee_id, project.vertical_id);
  if (f.stage) {
    const stages = parseJSON(project.stages, []);
    if (!stages.includes(f.stage)) throw bad('Unknown stage');
  }
  const merged = { ...task, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) };
  if (merged.start_date && merged.due_date && merged.due_date < merged.start_date) throw bad('Due date cannot be before the start date');
  if (f.status !== undefined && f.status !== task.status) f.completed_at = f.status === 'done' ? ctx.now : null;
  const sets = Object.entries(f).filter(([, v]) => v !== undefined);
  if (!sets.length) return taskDetail(ctx, task.id);
  return db.tx(() => {
    db.run(`UPDATE tasks SET ${sets.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...sets.map(([, v]) => v), ctx.now, task.id);
    if (f.status !== undefined && f.status !== task.status) {
      log(ctx, project.id, f.status === 'done' ? 'task_done' : 'task_status', `${merged.title} → ${STATUS_WORDS[f.status]}`, task.id);
      if (f.status === 'done' && task.created_by && task.created_by !== task.assignee_id) {
        notify(ctx, task.created_by, project.id, `${ctx.user.name} completed “${merged.title}” in ${project.code}`, task.id);
      }
    }
    if (f.assignee_id !== undefined && f.assignee_id !== task.assignee_id) {
      const a = userBrief(db, f.assignee_id);
      log(ctx, project.id, 'task_assigned', `${merged.title} → ${a?.name || 'Unassigned'}`, task.id);
      if (f.assignee_id) notify(ctx, f.assignee_id, project.id, `${ctx.user.name} assigned you “${merged.title}” in ${project.code}`, task.id);
    }
    if (f.due_date !== undefined && f.due_date !== task.due_date) {
      log(ctx, project.id, 'task_due', `${merged.title} → ${f.due_date || 'no date'}`, task.id);
      if (task.assignee_id && f.assignee_id === undefined) {
        notify(ctx, task.assignee_id, project.id, `${ctx.user.name} changed the due date of “${merged.title}” to ${f.due_date || 'no date'}`, task.id);
      }
    }
    if (f.title !== undefined && f.title !== task.title) log(ctx, project.id, 'task_renamed', `${task.title} → ${f.title}`, task.id);
    db.run('UPDATE projects SET updated_at = ? WHERE id = ?', ctx.now, project.id);
    return taskDetail(ctx, task.id);
  });
});

route('DELETE', '/tasks/:id', (ctx) => {
  const { task, project } = getTaskRaw(ctx, ctx.params.id);
  const allowed = canEditProject(ctx.user, project) || (task.created_by === uid(ctx) && canContribute(ctx.user, project));
  if (!allowed) throw forbidden('Only the person who added this task, the project owner or a manager can delete it');
  ctx.db.tx(() => {
    ctx.db.run('UPDATE files SET task_id = NULL WHERE task_id = ?', task.id);
    ctx.db.run('DELETE FROM tasks WHERE id = ?', task.id);
    log(ctx, project.id, 'task_deleted', task.title);
  });
  return { ok: true };
});

// Cross-project task list: My work, calendar and filters.
route('GET', '/tasks', (ctx) => {
  const { db, query: q, today } = ctx;
  const vids = scopeVerticals(ctx);
  if (!vids.length) return { items: [] };
  const where = [`p.vertical_id IN (${placeholders(vids)})`];
  const params = [...vids];
  if (q.assignee === 'me') { where.push('t.assignee_id = ?'); params.push(uid(ctx)); }
  else if (q.assignee === 'none') where.push('t.assignee_id IS NULL');
  else if (q.assignee) { where.push('t.assignee_id = ?'); params.push(Number(q.assignee)); }
  if (q.created === 'me') { where.push('t.created_by = ?'); params.push(uid(ctx)); }
  if (q.project) { where.push('t.project_id = ?'); params.push(Number(q.project)); }
  const scope = q.scope || 'open';
  if (scope === 'open') where.push(`t.status != 'done' AND p.status IN ${OPEN_IN}`);
  else if (scope === 'done') where.push(`t.status = 'done'`);
  if (q.from && isDate(q.from)) { where.push('t.due_date >= ?'); params.push(q.from); }
  if (q.to && isDate(q.to)) { where.push('t.due_date <= ?'); params.push(q.to); }
  if (q.q) { where.push('(t.title LIKE ? OR p.name LIKE ? OR p.code LIKE ?)'); const l = `%${q.q}%`; params.push(l, l, l); }
  const order = scope === 'done' ? 't.completed_at DESC' : 't.due_date IS NULL, t.due_date, t.sort';
  const items = db.all(
    `SELECT ${TASK_COLS}, p.code, p.name AS project_name, p.client, p.vertical_id, v.short AS vertical, v.color AS vertical_color
     FROM tasks t JOIN projects p ON p.id = t.project_id JOIN verticals v ON v.id = p.vertical_id LEFT JOIN users u ON u.id = t.assignee_id
     WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 600`,
    ...params,
  ).map((t) => shapeTask(t, today));
  return { items };
});

// ---------------------------------------------------------------- milestones

route('POST', '/projects/:id/milestones', (ctx) => {
  const p = getProjectRaw(ctx, ctx.params.id);
  if (!canContribute(ctx.user, p)) throw forbidden('You have view-only access to this vertical');
  const title = text(ctx.body.title, { max: 200, label: 'Milestone', required: true });
  const due = optDate(ctx.body.due_date, 'Date') ?? null;
  const sort = (ctx.db.get('SELECT MAX(sort) AS m FROM milestones WHERE project_id = ?', p.id).m || 0) + 1;
  const { id } = ctx.db.run('INSERT INTO milestones (project_id, title, due_date, sort) VALUES (?,?,?,?)', p.id, title, due, sort);
  log(ctx, p.id, 'milestone_added', title);
  return ctx.db.get('SELECT * FROM milestones WHERE id = ?', id);
});

function getMilestone(ctx) {
  const m = ctx.db.get('SELECT * FROM milestones WHERE id = ?', toId(ctx.params.id, 'Milestone'));
  if (!m) throw notFound('Milestone');
  const p = ctx.db.get('SELECT * FROM projects WHERE id = ?', m.project_id);
  if (!canView(ctx.user, p)) throw notFound('Milestone');
  if (!canContribute(ctx.user, p)) throw forbidden('You have view-only access to this vertical');
  return { m, p };
}

route('PATCH', '/milestones/:id', (ctx) => {
  const { m, p } = getMilestone(ctx);
  const title = text(ctx.body.title, { max: 200, label: 'Milestone' });
  if (title === '') throw bad('Milestone needs a name');
  const due = optDate(ctx.body.due_date, 'Date');
  const done = ctx.body.done === undefined ? undefined : ctx.body.done ? 1 : 0;
  ctx.db.run(
    'UPDATE milestones SET title = COALESCE(?, title), due_date = CASE WHEN ? THEN ? ELSE due_date END, done = COALESCE(?, done), done_at = CASE WHEN ? IS NULL THEN done_at WHEN ? = 1 THEN ? ELSE NULL END WHERE id = ?',
    title ?? null, due !== undefined ? 1 : 0, due ?? null, done ?? null, done ?? null, done ?? null, ctx.now, m.id,
  );
  if (done === 1 && !m.done) log(ctx, p.id, 'milestone_done', m.title);
  return ctx.db.get('SELECT * FROM milestones WHERE id = ?', m.id);
});

route('DELETE', '/milestones/:id', (ctx) => {
  const { m, p } = getMilestone(ctx);
  ctx.db.run('DELETE FROM milestones WHERE id = ?', m.id);
  log(ctx, p.id, 'milestone_deleted', m.title);
  return { ok: true };
});

// ---------------------------------------------------------------- files & assets

const FILE_COLS = `f.*, u.name AS uploader_name, p.code, p.name AS project_name, p.client, p.vertical_id, p.status AS project_status,
  COALESCE(p.key_date, p.due_date, p.start_date) AS project_date, v.short AS vertical, v.color AS vertical_color, t.title AS task_title`;
const FILE_FROM = `FROM files f JOIN projects p ON p.id = f.project_id JOIN verticals v ON v.id = p.vertical_id
  LEFT JOIN users u ON u.id = f.uploaded_by LEFT JOIN tasks t ON t.id = f.task_id`;

route('GET', '/projects/:id/files', (ctx) => {
  const p = getProjectRaw(ctx, ctx.params.id);
  return { items: ctx.db.all(`SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.project_id = ? ORDER BY f.is_final DESC, f.id DESC`, p.id) };
});

route('POST', '/projects/:id/files', (ctx) => {
  const p = getProjectRaw(ctx, ctx.params.id);
  if (!canContribute(ctx.user, p)) throw forbidden('You have view-only access to this vertical');
  const b = ctx.body;
  const category = FILE_CATEGORIES.includes(b.category) ? b.category : 'Other';
  let taskId = optId(b.task_id) ?? null;
  if (taskId && !ctx.db.get('SELECT 1 AS x FROM tasks WHERE id = ? AND project_id = ?', taskId, p.id)) taskId = null;
  const isFinal = b.is_final === true || b.is_final === 'true' || b.is_final === '1' ? 1 : 0;
  const note = text(b.note, { max: 500, label: 'Note' }) || '';
  let row;
  if (ctx.upload) {
    const u = ctx.upload;
    const name = text(b.name || u.name, { max: 240, label: 'File name', required: true });
    row = ctx.db.run(
      `INSERT INTO files (project_id, task_id, kind, name, mime, size, category, storage_key, is_final, note, uploaded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      p.id, taskId, 'file', name, u.mime || '', u.size || 0, category, u.storage_key, isFinal, note, uid(ctx), ctx.now,
    );
  } else {
    const url = text(b.url, { max: 2000, label: 'Link', required: true });
    if (!/^https?:\/\//i.test(url)) throw bad('Links must start with http:// or https://');
    const name = text(b.name, { max: 240, label: 'Name' }) || url.replace(/^https?:\/\//i, '').slice(0, 80);
    row = ctx.db.run(
      `INSERT INTO files (project_id, task_id, kind, name, url, category, is_final, note, uploaded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      p.id, taskId, 'link', name, url, category, isFinal, note, uid(ctx), ctx.now,
    );
  }
  const f = ctx.db.get(`SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.id = ?`, row.id);
  log(ctx, p.id, f.kind === 'link' ? 'link_added' : 'file_added', f.name, taskId);
  return f;
});

function getFileChecked(ctx, id) {
  const f = ctx.db.get(`SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.id = ?`, toId(id, 'File'));
  if (!f) throw notFound('File');
  const p = ctx.db.get('SELECT * FROM projects WHERE id = ?', f.project_id);
  if (!canView(ctx.user, p)) throw notFound('File');
  return { f, p };
}

// Used by adapters before streaming bytes.
export function fileForDownload(ctx, id) {
  return getFileChecked(ctx, id).f;
}

route('PATCH', '/files/:id', (ctx) => {
  const { f, p } = getFileChecked(ctx, ctx.params.id);
  if (!canContribute(ctx.user, p)) throw forbidden('You have view-only access to this vertical');
  const b = ctx.body;
  const name = text(b.name, { max: 240, label: 'Name' });
  if (name === '') throw bad('Name is required');
  const category = b.category === undefined ? undefined : FILE_CATEGORIES.includes(b.category) ? b.category : 'Other';
  const isFinal = b.is_final === undefined ? undefined : b.is_final ? 1 : 0;
  const note = text(b.note, { max: 500, label: 'Note' });
  ctx.db.run(
    'UPDATE files SET name = COALESCE(?, name), category = COALESCE(?, category), is_final = COALESCE(?, is_final), note = COALESCE(?, note) WHERE id = ?',
    name ?? null, category ?? null, isFinal ?? null, note ?? null, f.id,
  );
  if (isFinal === 1 && !f.is_final) log(ctx, p.id, 'file_final', f.name);
  return ctx.db.get(`SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.id = ?`, f.id);
});

route('DELETE', '/files/:id', async (ctx) => {
  const { f, p } = getFileChecked(ctx, ctx.params.id);
  const allowed = canEditProject(ctx.user, p) || (f.uploaded_by === uid(ctx) && canContribute(ctx.user, p));
  if (!allowed) throw forbidden('Only the uploader, the project owner or a manager can delete this file');
  ctx.db.run('DELETE FROM files WHERE id = ?', f.id);
  log(ctx, p.id, 'file_deleted', f.name);
  if (f.kind === 'file' && f.storage_key) await ctx.services.removeStored?.(f.storage_key);
  return { ok: true };
});

// Asset library across every project the viewer can see, current and past.
route('GET', '/files', (ctx) => {
  const { db, query: q } = ctx;
  const vids = scopeVerticals(ctx);
  if (!vids.length) return { items: [], total: 0 };
  const where = [`p.vertical_id IN (${placeholders(vids)})`];
  const params = [...vids];
  if (q.category && FILE_CATEGORIES.includes(q.category)) { where.push('f.category = ?'); params.push(q.category); }
  if (q.final === '1') where.push('f.is_final = 1');
  if (q.kind === 'image') where.push("f.mime LIKE 'image/%'");
  else if (q.kind === 'video') where.push("f.mime LIKE 'video/%'");
  else if (q.kind === 'doc') where.push("f.kind = 'file' AND f.mime NOT LIKE 'image/%' AND f.mime NOT LIKE 'video/%'");
  else if (q.kind === 'link') where.push("f.kind = 'link'");
  if (q.scope === 'past') where.push(`p.status IN ('completed','cancelled')`);
  else if (q.scope === 'open') where.push(`p.status IN ${OPEN_IN}`);
  if (q.year && /^\d{4}$/.test(q.year)) { where.push('substr(COALESCE(p.key_date, p.due_date, p.start_date, f.created_at), 1, 4) = ?'); params.push(q.year); }
  if (q.client) { where.push('p.client = ?'); params.push(q.client); }
  if (q.q) {
    const l = `%${q.q}%`;
    where.push('(f.name LIKE ? OR f.note LIKE ? OR p.name LIKE ? OR p.code LIKE ? OR p.client LIKE ? OR p.tags LIKE ?)');
    params.push(l, l, l, l, l, l);
  }
  const limit = Math.min(Number(q.limit) || 300, 1000);
  const items = db.all(`SELECT ${FILE_COLS} ${FILE_FROM} WHERE ${where.join(' AND ')} ORDER BY f.is_final DESC, f.id DESC LIMIT ?`, ...params, limit);
  const total = db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(f.size), 0) AS bytes ${FILE_FROM} WHERE ${where.join(' AND ')}`, ...params);
  return { items, total: total.n, bytes: total.bytes };
});

// ---------------------------------------------------------------- comments

const COMMENT_COLS = 'c.*, u.name AS user_name, u.color AS user_color, d.name AS decided_by_name';

// Vertical managers and admins: the people who approve deleting old comments.
function headsOf(db, verticalId) {
  const ids = new Set(db.all("SELECT id FROM users WHERE role = 'admin' AND active = 1").map((r) => r.id));
  for (const r of db.all("SELECT uv.user_id FROM user_verticals uv JOIN users u ON u.id = uv.user_id WHERE uv.vertical_id = ? AND uv.level = 'manager' AND u.active = 1", verticalId)) ids.add(r.user_id);
  return [...ids];
}

function shapeComment(ctx, c, project) {
  const mine = c.user_id === uid(ctx);
  const left = Math.max(0, DELETE_WINDOW_MS - (Date.parse(ctx.now) - Date.parse(c.created_at)));
  return {
    ...c,
    mine,
    delete_ms_left: mine ? left : 0,
    can_delete: mine && (left > 0 || c.delete_status === 'approved'),
    can_request_delete: mine && left === 0 && c.delete_status !== 'requested' && c.delete_status !== 'approved',
    can_decide: !mine && c.delete_status === 'requested' && canManageVertical(ctx.user, project.vertical_id),
  };
}

function commentById(ctx, id, project) {
  const c = ctx.db.get(`SELECT ${COMMENT_COLS} FROM comments c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users d ON d.id = c.delete_decided_by WHERE c.id = ?`, id);
  return shapeComment(ctx, c, project);
}

route('POST', '/projects/:id/comments', (ctx) => {
  const { db } = ctx;
  const p = getProjectRaw(ctx, ctx.params.id);
  if (!canContribute(ctx.user, p)) throw forbidden('You have view-only access to this vertical');
  const body = text(ctx.body.body, { max: 5000, label: 'Comment', required: true });
  let task = null;
  if (ctx.body.task_id) {
    task = db.get('SELECT * FROM tasks WHERE id = ? AND project_id = ?', Number(ctx.body.task_id), p.id);
    if (!task) throw bad('That task is not part of this project');
  }
  const { id } = db.run('INSERT INTO comments (project_id, task_id, user_id, body, created_at) VALUES (?,?,?,?,?)', p.id, task?.id ?? null, uid(ctx), body, ctx.now);
  const where = task ? `on “${task.title}”` : `on ${p.code}`;
  const told = new Set();
  // @mentions of people who can see this vertical
  const lower = body.toLowerCase();
  for (const u of db.all('SELECT id, name FROM users WHERE active = 1')) {
    const first = u.name.split(' ')[0].toLowerCase();
    if (lower.includes('@' + u.name.toLowerCase()) || new RegExp(`@${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      const lu = loadUser(db, u.id);
      if (lu && levelFor(lu, p.vertical_id)) { notify(ctx, u.id, p.id, `${ctx.user.name} mentioned you ${where}`, task?.id); told.add(u.id); }
    }
  }
  if (task?.assignee_id && !told.has(task.assignee_id)) { notify(ctx, task.assignee_id, p.id, `${ctx.user.name} commented ${where}`, task.id); told.add(task.assignee_id); }
  if (p.owner_id && !told.has(p.owner_id)) notify(ctx, p.owner_id, p.id, `${ctx.user.name} commented ${where}`, task?.id);
  return commentById(ctx, id, p);
});

// Comments are permanent records once the 15-second window has passed: the author
// can ask a head (vertical manager or admin) to approve the deletion, and only then delete it.
function getComment(ctx) {
  const c = ctx.db.get('SELECT * FROM comments WHERE id = ?', toId(ctx.params.id, 'Comment'));
  if (!c) throw notFound('Comment');
  const p = ctx.db.get('SELECT * FROM projects WHERE id = ?', c.project_id);
  if (!canView(ctx.user, p)) throw notFound('Comment');
  return { c, p };
}

route('DELETE', '/comments/:id', async (ctx) => {
  const { c, p } = getComment(ctx);
  if (c.user_id !== uid(ctx)) throw forbidden('You can only delete your own comments');
  const age = Date.parse(ctx.now) - Date.parse(c.created_at);
  if (age > DELETE_WINDOW_MS + DELETE_GRACE_MS && c.delete_status !== 'approved') {
    throw forbidden('Comments can only be deleted within 15 seconds of posting. Ask a head to approve the deletion.');
  }
  const approver = c.delete_status === 'approved' ? userBrief(ctx.db, c.delete_decided_by) : null;
  ctx.db.tx(() => {
    ctx.db.run('DELETE FROM comments WHERE id = ?', c.id);
    if (approver) log(ctx, p.id, 'comment_deleted', approver.name, c.task_id);
  });
  return { ok: true };
});

route('POST', '/comments/:id/delete-request', (ctx) => {
  const { c, p } = getComment(ctx);
  if (c.user_id !== uid(ctx)) throw forbidden('You can only ask to delete your own comments');
  if (c.delete_status === 'requested') throw bad('A head has already been asked to approve this');
  if (c.delete_status === 'approved') throw bad('Deletion is already approved. You can delete the comment now.');
  ctx.db.tx(() => {
    ctx.db.run("UPDATE comments SET delete_status = 'requested', delete_requested_at = ?, delete_decided_by = NULL, delete_decided_at = NULL WHERE id = ?", ctx.now, c.id);
    const snippet = c.body.length > 60 ? c.body.slice(0, 57) + '…' : c.body;
    for (const h of headsOf(ctx.db, p.vertical_id)) {
      notify(ctx, h, p.id, `${ctx.user.name} asks to delete a comment in ${p.code}: “${snippet}”`, c.task_id);
    }
  });
  return commentById(ctx, c.id, p);
});

route('POST', '/comments/:id/delete-decision', (ctx) => {
  const { c, p } = getComment(ctx);
  if (!canManageVertical(ctx.user, p.vertical_id)) throw forbidden('Only a head of this vertical can approve deleting comments');
  if (c.user_id === uid(ctx)) throw forbidden('Another head has to approve deleting your own comment');
  if (c.delete_status !== 'requested') throw bad('There is no pending request for this comment');
  const approve = !!ctx.body.approve;
  ctx.db.tx(() => {
    ctx.db.run('UPDATE comments SET delete_status = ?, delete_decided_by = ?, delete_decided_at = ? WHERE id = ?', approve ? 'approved' : 'declined', uid(ctx), ctx.now, c.id);
    notify(ctx, c.user_id, p.id, approve
      ? `${ctx.user.name} approved deleting your comment in ${p.code}. You can delete it now.`
      : `${ctx.user.name} asked to keep your comment in ${p.code}.`, c.task_id);
  });
  return commentById(ctx, c.id, p);
});

// ---------------------------------------------------------------- calendar, search, notifications

route('GET', '/calendar', (ctx) => {
  const { db, query: q, today } = ctx;
  const vids = scopeVerticals(ctx);
  if (!vids.length || !isDate(q.from) || !isDate(q.to)) return { items: [] };
  const inV = `p.vertical_id IN (${placeholders(vids)})`;
  const items = [];
  for (const p of db.all(
    `SELECT p.id, p.code, p.name, p.status, p.key_date, p.due_date, p.start_date, v.short AS vertical, v.color AS vertical_color, v.key_date_label
     FROM projects p JOIN verticals v ON v.id = p.vertical_id
     WHERE ${inV} AND p.status != 'cancelled' AND ((p.key_date BETWEEN ? AND ?) OR (p.due_date BETWEEN ? AND ?))`,
    ...vids, q.from, q.to, q.from, q.to,
  )) {
    if (p.key_date && p.key_date >= q.from && p.key_date <= q.to) items.push({ type: 'key', date: p.key_date, title: p.name, label: p.key_date_label, project_id: p.id, code: p.code, color: p.vertical_color, vertical: p.vertical });
    if (p.due_date && p.due_date >= q.from && p.due_date <= q.to && p.due_date !== p.key_date) items.push({ type: 'due', date: p.due_date, title: p.name, label: 'Project due', project_id: p.id, code: p.code, color: p.vertical_color, vertical: p.vertical });
  }
  for (const m of db.all(
    `SELECT m.*, p.code, p.name AS project_name, v.color AS vertical_color, v.short AS vertical FROM milestones m
     JOIN projects p ON p.id = m.project_id JOIN verticals v ON v.id = p.vertical_id
     WHERE ${inV} AND p.status != 'cancelled' AND m.due_date BETWEEN ? AND ? AND (p.key_date IS NULL OR m.due_date != p.key_date)`,
    ...vids, q.from, q.to,
  )) items.push({ type: 'milestone', date: m.due_date, title: m.title, done: !!m.done, project_id: m.project_id, code: m.code, project_name: m.project_name, color: m.vertical_color, vertical: m.vertical });
  const taskWhere = [inV, 't.due_date BETWEEN ? AND ?', `p.status IN ${OPEN_IN}`];
  const tParams = [...vids, q.from, q.to];
  if (q.tasks === 'mine') { taskWhere.push('t.assignee_id = ?'); tParams.push(uid(ctx)); }
  if (q.tasks !== 'none') {
    for (const t of db.all(
      `SELECT t.id, t.title, t.status, t.due_date, t.project_id, t.priority, p.code, p.name AS project_name, v.color AS vertical_color, v.short AS vertical, u.name AS assignee_name
       FROM tasks t JOIN projects p ON p.id = t.project_id JOIN verticals v ON v.id = p.vertical_id LEFT JOIN users u ON u.id = t.assignee_id
       WHERE ${taskWhere.join(' AND ')} LIMIT 1500`,
      ...tParams,
    )) items.push({ type: 'task', date: t.due_date, title: t.title, task_id: t.id, done: t.status === 'done', overdue: t.status !== 'done' && t.due_date < today, project_id: t.project_id, code: t.code, project_name: t.project_name, color: t.vertical_color, vertical: t.vertical, assignee_name: t.assignee_name, priority: t.priority });
  }
  const rank = { key: 0, due: 1, milestone: 2, task: 3 };
  items.sort((a, b) => a.date.localeCompare(b.date) || rank[a.type] - rank[b.type]);
  return { items };
});

route('GET', '/search', (ctx) => {
  const { db } = ctx;
  const term = String(ctx.query.q || '').trim();
  const vids = visibleVerticalIds(ctx.user);
  if (term.length < 2 || !vids.length) return { results: [] };
  const l = `%${term}%`;
  const inV = `p.vertical_id IN (${placeholders(vids)})`;
  const results = [];
  for (const p of db.all(
    `SELECT p.id, p.code, p.name, p.client, p.status, v.short AS vertical, v.color AS vertical_color FROM projects p JOIN verticals v ON v.id = p.vertical_id
     WHERE ${inV} AND (p.name LIKE ? OR p.code LIKE ? OR p.client LIKE ? OR p.tags LIKE ? OR p.venue LIKE ?) ORDER BY p.status IN ('completed','cancelled'), p.id DESC LIMIT 6`,
    ...vids, l, l, l, l, l,
  )) results.push({ type: 'project', id: p.id, title: p.name, sub: [p.code, p.client, p.status === 'completed' ? 'Completed' : p.status === 'cancelled' ? 'Cancelled' : ''].filter(Boolean).join(' · '), color: p.vertical_color, link: `/projects/${p.id}` });
  for (const t of db.all(
    `SELECT t.id, t.title, t.project_id, p.code, v.color AS vertical_color FROM tasks t JOIN projects p ON p.id = t.project_id JOIN verticals v ON v.id = p.vertical_id
     WHERE ${inV} AND t.title LIKE ? ORDER BY t.status = 'done', t.id DESC LIMIT 6`,
    ...vids, l,
  )) results.push({ type: 'task', id: t.id, title: t.title, sub: t.code, color: t.vertical_color, link: `/projects/${t.project_id}/tasks/${t.id}` });
  for (const f of db.all(
    `SELECT f.id, f.name, f.project_id, p.code, v.color AS vertical_color FROM files f JOIN projects p ON p.id = f.project_id JOIN verticals v ON v.id = p.vertical_id
     WHERE ${inV} AND (f.name LIKE ? OR f.note LIKE ?) ORDER BY f.id DESC LIMIT 5`,
    ...vids, l, l,
  )) results.push({ type: 'file', id: f.id, title: f.name, sub: f.code, color: f.vertical_color, link: `/projects/${f.project_id}/files` });
  return { results };
});

route('GET', '/notifications', (ctx) => {
  const vids = visibleVerticalIds(ctx.user);
  const items = ctx.db.all(
    `SELECT n.*, p.code, p.vertical_id, v.color AS vertical_color FROM notifications n LEFT JOIN projects p ON p.id = n.project_id LEFT JOIN verticals v ON v.id = p.vertical_id
     WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 40`,
    uid(ctx),
  ).filter((n) => !n.project_id || vids.includes(n.vertical_id));
  const unread = ctx.db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', uid(ctx)).n;
  return { items, unread };
});

route('POST', '/notifications/read', (ctx) => {
  if (ctx.body.id) ctx.db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', Number(ctx.body.id), uid(ctx));
  else ctx.db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', uid(ctx));
  return { ok: true };
});

// ---------------------------------------------------------------- templates (vertical managers)

function shapeTemplate(t) {
  return { ...t, stages: parseJSON(t.stages, []), tasks: parseJSON(t.tasks, []), milestones: parseJSON(t.milestones, []) };
}

route('GET', '/templates', (ctx) => {
  const vids = scopeVerticals(ctx);
  if (!vids.length) return { items: [] };
  return {
    items: ctx.db.all(`SELECT t.*, v.short AS vertical, v.color AS vertical_color FROM templates t JOIN verticals v ON v.id = t.vertical_id WHERE t.vertical_id IN (${placeholders(vids)}) ORDER BY v.sort, t.name`, ...vids)
      .map(shapeTemplate)
      .map((t) => ({ ...t, can_edit: canManageVertical(ctx.user, t.vertical_id) })),
  };
});

function readTemplate(body) {
  const name = text(body.name, { max: 120, label: 'Template name', required: true });
  const description = text(body.description, { max: 500, label: 'Description' }) || '';
  const stages = (Array.isArray(body.stages) ? body.stages : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 15);
  if (!stages.length) throw bad('Add at least one stage');
  const tasks = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 200).map((t) => ({
    title: String(t.title || '').trim().slice(0, 240),
    stage: stages.includes(t.stage) ? t.stage : stages[0],
    offset: Math.max(-365, Math.min(365, Math.round(Number(t.offset) || 0))),
    priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
  })).filter((t) => t.title);
  const milestones = (Array.isArray(body.milestones) ? body.milestones : []).slice(0, 50).map((m) => ({
    title: String(m.title || '').trim().slice(0, 200),
    offset: Math.max(-365, Math.min(365, Math.round(Number(m.offset) || 0))),
  })).filter((m) => m.title);
  return { name, description, stages: JSON.stringify(stages), tasks: JSON.stringify(tasks), milestones: JSON.stringify(milestones) };
}

route('POST', '/templates', (ctx) => {
  const vId = Number(ctx.body.vertical_id);
  if (!levelFor(ctx.user, vId) || !canManageVertical(ctx.user, vId)) throw forbidden('Only vertical managers can add templates');
  const t = readTemplate(ctx.body);
  const { id } = ctx.db.run('INSERT INTO templates (vertical_id, name, description, stages, tasks, milestones, created_at) VALUES (?,?,?,?,?,?,?)', vId, t.name, t.description, t.stages, t.tasks, t.milestones, ctx.now);
  return shapeTemplate(ctx.db.get('SELECT * FROM templates WHERE id = ?', id));
});

function getTemplateForEdit(ctx) {
  const t = ctx.db.get('SELECT * FROM templates WHERE id = ?', toId(ctx.params.id, 'Template'));
  if (!t || !levelFor(ctx.user, t.vertical_id)) throw notFound('Template');
  if (!canManageVertical(ctx.user, t.vertical_id)) throw forbidden('Only vertical managers can change templates');
  return t;
}

route('PATCH', '/templates/:id', (ctx) => {
  const old = getTemplateForEdit(ctx);
  const t = readTemplate(ctx.body);
  ctx.db.run('UPDATE templates SET name = ?, description = ?, stages = ?, tasks = ?, milestones = ? WHERE id = ?', t.name, t.description, t.stages, t.tasks, t.milestones, old.id);
  return shapeTemplate(ctx.db.get('SELECT * FROM templates WHERE id = ?', old.id));
});

route('DELETE', '/templates/:id', (ctx) => {
  const t = getTemplateForEdit(ctx);
  ctx.db.run('DELETE FROM templates WHERE id = ?', t.id);
  return { ok: true };
});

// Save an existing project's plan as a reusable template.
route('POST', '/projects/:id/save-template', (ctx) => {
  const p = getProjectRaw(ctx, ctx.params.id);
  if (!canManageVertical(ctx.user, p.vertical_id)) throw forbidden('Only vertical managers can add templates');
  const anchor = anchorOf(p);
  const off = (d) => (anchor && d ? daysBetween(anchor, d) : 0);
  const tasks = ctx.db.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort, id', p.id).map((t) => ({ title: t.title, stage: t.stage, offset: off(t.due_date), priority: t.priority }));
  const milestones = ctx.db.all('SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date, sort', p.id).map((m) => ({ title: m.title, offset: off(m.due_date) }));
  const t = readTemplate({ name: ctx.body.name || `${p.name} (template)`, description: ctx.body.description || `Based on ${p.code}`, stages: parseJSON(p.stages, DEFAULT_STAGES), tasks, milestones });
  const { id } = ctx.db.run('INSERT INTO templates (vertical_id, name, description, stages, tasks, milestones, created_at) VALUES (?,?,?,?,?,?,?)', p.vertical_id, t.name, t.description, t.stages, t.tasks, t.milestones, ctx.now);
  return shapeTemplate(ctx.db.get('SELECT * FROM templates WHERE id = ?', id));
});

// ---------------------------------------------------------------- admin: people, access, verticals, settings

function requireAdmin(ctx) {
  if (!isAdmin(ctx.user)) throw forbidden('Only admins can manage people and verticals');
}

function adminUser(db, id) {
  const u = db.get('SELECT id, name, email, role, title, phone, color, active, created_at, last_login_at, must_change_password FROM users WHERE id = ?', id);
  if (!u) return null;
  u.access = Object.fromEntries(db.all('SELECT vertical_id, level FROM user_verticals WHERE user_id = ?', id).map((r) => [r.vertical_id, r.level]));
  u.open_tasks = db.get(`SELECT COUNT(*) AS n FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.assignee_id = ? AND t.status != 'done' AND p.status IN ${OPEN_IN}`, id).n;
  return u;
}

route('GET', '/admin/users', (ctx) => {
  requireAdmin(ctx);
  return { items: ctx.db.all('SELECT id FROM users ORDER BY active DESC, name').map((r) => adminUser(ctx.db, r.id)) };
});

function writeAccess(db, userId, access) {
  if (access === undefined) return;
  if (typeof access !== 'object' || access === null) throw bad('Invalid access list');
  const valid = new Set(db.all('SELECT id FROM verticals').map((v) => v.id));
  db.run('DELETE FROM user_verticals WHERE user_id = ?', userId);
  for (const [vid, level] of Object.entries(access)) {
    if (!level) continue;
    if (!valid.has(Number(vid))) throw bad('Unknown vertical');
    if (!LEVELS.includes(level)) throw bad('Access must be viewer, member or manager');
    db.run('INSERT INTO user_verticals (user_id, vertical_id, level) VALUES (?,?,?)', userId, Number(vid), level);
  }
}

function readPerson(body, creating) {
  const f = {
    name: text(body.name, { max: 120, label: 'Name', required: creating }),
    email: text(body.email, { max: 200, label: 'Email', required: creating })?.toLowerCase(),
    title: text(body.title, { max: 120, label: 'Job title' }),
    phone: text(body.phone, { max: 40, label: 'Phone' }),
    role: oneOf(body.role, ['admin', 'member'], 'Role'),
    color: body.color && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : undefined,
  };
  if (f.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw bad('Enter a valid email address');
  if (body.name !== undefined && !f.name) throw bad('Name is required');
  return f;
}

const PALETTE = ['#1f2b7b', '#e31b3b', '#1a6df0', '#1fa855', '#f2a600', '#7c5cfc', '#ef4778', '#1fb2d6', '#0f766e', '#b45309'];

route('POST', '/admin/users', async (ctx) => {
  requireAdmin(ctx);
  const { db, body } = ctx;
  const f = readPerson(body, true);
  if (db.get('SELECT 1 AS x FROM users WHERE email = ?', f.email)) throw bad('Someone with this email already exists');
  if (typeof body.password !== 'string' || body.password.length < 8) throw bad('Set a temporary password of at least 8 characters');
  const hash = await ctx.services.hashPassword(body.password);
  const count = db.get('SELECT COUNT(*) AS n FROM users').n;
  return db.tx(() => {
    const { id } = db.run(
      'INSERT INTO users (name, email, password_hash, role, title, phone, color, active, must_change_password, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      f.name, f.email, hash, f.role || 'member', f.title || '', f.phone || '', f.color || PALETTE[count % PALETTE.length], 1, 1, ctx.now,
    );
    writeAccess(db, id, body.access || {});
    return adminUser(db, id);
  });
});

route('PATCH', '/admin/users/:id', async (ctx) => {
  requireAdmin(ctx);
  const { db, body } = ctx;
  const id = toId(ctx.params.id, 'Person');
  const u = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('Person');
  const f = readPerson(body, false);
  if (f.email && f.email !== u.email && db.get('SELECT 1 AS x FROM users WHERE email = ? AND id != ?', f.email, id)) throw bad('Someone with this email already exists');
  if (body.active !== undefined) f.active = body.active ? 1 : 0;
  const admins = db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n;
  const losingAdmin = u.role === 'admin' && u.active && ((f.role && f.role !== 'admin') || f.active === 0);
  if (losingAdmin && admins <= 1) throw bad('Keep at least one active admin');
  if (id === uid(ctx) && f.active === 0) throw bad('You cannot deactivate your own account');
  if (body.password) {
    if (String(body.password).length < 8) throw bad('Use at least 8 characters for the password');
    f.password_hash = await ctx.services.hashPassword(String(body.password));
    f.must_change_password = 1;
  }
  return db.tx(() => {
    const sets = Object.entries(f).filter(([, v]) => v !== undefined);
    if (sets.length) db.run(`UPDATE users SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v), id);
    writeAccess(db, id, body.access);
    if (f.active === 0) db.run('DELETE FROM sessions WHERE user_id = ?', id);
    return adminUser(db, id);
  });
});

route('GET', '/admin/verticals', (ctx) => {
  requireAdmin(ctx);
  return {
    items: ctx.db.all(
      `SELECT v.*, (SELECT COUNT(*) FROM projects p WHERE p.vertical_id = v.id) AS projects,
        (SELECT COUNT(*) FROM user_verticals uv WHERE uv.vertical_id = v.id) AS people FROM verticals v ORDER BY v.sort, v.id`,
    ),
  };
});

function readVertical(body, creating) {
  const f = {
    name: text(body.name, { max: 80, label: 'Name', required: creating }),
    short: text(body.short, { max: 30, label: 'Short name', required: creating }),
    code: text(body.code, { max: 6, label: 'Code', required: creating })?.toUpperCase(),
    tagline: text(body.tagline, { max: 120, label: 'Tagline' }),
    key_date_label: text(body.key_date_label, { max: 40, label: 'Key date label' }),
    ready_label: text(body.ready_label, { max: 60, label: 'Final board column' }),
    color: body.color === undefined ? undefined : /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#1a6df0',
    sort: body.sort === undefined ? undefined : Number(body.sort) || 0,
    active: body.active === undefined ? undefined : body.active ? 1 : 0,
  };
  if (f.code !== undefined && !/^[A-Z0-9]{2,6}$/.test(f.code)) throw bad('Code must be 2 to 6 letters or digits, like EXH');
  return f;
}

route('POST', '/admin/verticals', (ctx) => {
  requireAdmin(ctx);
  const f = readVertical(ctx.body, true);
  if (ctx.db.get('SELECT 1 AS x FROM verticals WHERE code = ?', f.code)) throw bad('Another vertical already uses that code');
  const sort = (ctx.db.get('SELECT MAX(sort) AS m FROM verticals').m || 0) + 1;
  const { id } = ctx.db.run(
    'INSERT INTO verticals (name, short, code, tagline, color, key_date_label, ready_label, sort, active) VALUES (?,?,?,?,?,?,?,?,1)',
    f.name, f.short, f.code, f.tagline || '', f.color || '#1a6df0', f.key_date_label || 'Key date', f.ready_label || '', f.sort ?? sort,
  );
  return ctx.db.get('SELECT * FROM verticals WHERE id = ?', id);
});

route('PATCH', '/admin/verticals/:id', (ctx) => {
  requireAdmin(ctx);
  const id = toId(ctx.params.id, 'Vertical');
  if (!ctx.db.get('SELECT 1 AS x FROM verticals WHERE id = ?', id)) throw notFound('Vertical');
  const f = readVertical(ctx.body, false);
  if (f.code && ctx.db.get('SELECT 1 AS x FROM verticals WHERE code = ? AND id != ?', f.code, id)) throw bad('Another vertical already uses that code');
  for (const k of ['name', 'short', 'code']) if (f[k] === '') throw bad(`${k} is required`);
  const sets = Object.entries(f).filter(([, v]) => v !== undefined);
  ctx.db.tx(() => {
    if (sets.length) ctx.db.run(`UPDATE verticals SET ${sets.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v), id);
    if (f.ready_label === '') ctx.db.run("UPDATE projects SET status = 'active', updated_at = ? WHERE vertical_id = ? AND status = 'ready'", ctx.now, id);
  });
  return ctx.db.get('SELECT * FROM verticals WHERE id = ?', id);
});

route('PATCH', '/admin/settings', (ctx) => {
  requireAdmin(ctx);
  const name = text(ctx.body.company_name, { max: 80, label: 'Company name' });
  if (name) ctx.db.run("INSERT INTO settings (key, value) VALUES ('company_name', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", name);
  return { ok: true };
});
