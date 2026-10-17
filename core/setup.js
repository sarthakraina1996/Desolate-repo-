// Creates tables and the starting verticals and templates on a fresh database,
// and upgrades databases created by earlier versions.
import { SCHEMA, SCHEMA_VERSION, DEFAULT_VERTICALS, DEFAULT_TEMPLATES, projectsTable } from './schema.js';

const hasColumn = (db, table, col) => db.all(`PRAGMA table_info(${table})`).some((c) => c.name === col);

function addColumn(db, table, col, def) {
  if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
}

// Version 2: "ready" project status, board ordering, comment deletion approvals.
function upgradeTo2(db) {
  addColumn(db, 'verticals', 'ready_label', "TEXT DEFAULT ''");
  addColumn(db, 'comments', 'delete_status', 'TEXT');
  addColumn(db, 'comments', 'delete_requested_at', 'TEXT');
  addColumn(db, 'comments', 'delete_decided_by', 'INTEGER');
  addColumn(db, 'comments', 'delete_decided_at', 'TEXT');

  // SQLite cannot change a CHECK constraint in place, so rebuild the projects table.
  const def = db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'projects'")?.sql || '';
  if (!def.includes("'ready'")) {
    const cols = db.all('PRAGMA table_info(projects)').map((c) => c.name);
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.tx(() => {
        db.exec(projectsTable('projects_v2'));
        db.exec(`INSERT INTO projects_v2 (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM projects;`);
        db.exec('DROP TABLE projects;');
        db.exec('ALTER TABLE projects_v2 RENAME TO projects;');
        db.exec('CREATE INDEX IF NOT EXISTS idx_projects_vertical ON projects(vertical_id, status);');
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  } else {
    addColumn(db, 'projects', 'board_sort', 'REAL');
  }
  db.run("UPDATE verticals SET ready_label = 'Ready for Event / Exhibition' WHERE code = 'EXH' AND (ready_label IS NULL OR ready_label = '')");
}

// Version 3: "new since you last looked" counts and assignment times.
function upgradeTo3(db) {
  addColumn(db, 'tasks', 'assigned_at', 'TEXT');
  addColumn(db, 'tasks', 'assigned_by', 'INTEGER');
  db.run('UPDATE tasks SET assigned_at = created_at, assigned_by = created_by WHERE assignee_id IS NOT NULL AND assigned_at IS NULL');
  // Everything that existed before the upgrade counts as already seen.
  const now = new Date().toISOString();
  db.tx(() => {
    for (const u of db.all('SELECT id FROM users')) {
      db.run('INSERT OR IGNORE INTO seen (user_id, scope, seen_at) VALUES (?, ?, ?)', u.id, 'mywork', now);
      for (const p of db.all('SELECT id FROM projects')) {
        for (const tab of SEEN_TABS) db.run('INSERT OR IGNORE INTO seen (user_id, scope, seen_at) VALUES (?, ?, ?)', u.id, `project:${p.id}:${tab}`, now);
      }
    }
  });
}

// Version 4: team group chats (the table itself comes from SCHEMA) and notification links.
function upgradeTo4(db) {
  addColumn(db, 'notifications', 'link', "TEXT DEFAULT ''");
}

export const SEEN_TABS = ['tasks', 'files', 'discussion'];

export function migrate(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  const fresh = !db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'");
  db.exec(SCHEMA);
  const row = db.get("SELECT value FROM settings WHERE key = 'schema_version'");
  const version = fresh ? SCHEMA_VERSION : Number(row?.value || 1);
  if (version < 2) upgradeTo2(db);
  if (version < 3) upgradeTo3(db);
  if (version < 4) upgradeTo4(db);
  db.run(
    "INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    String(SCHEMA_VERSION),
  );
}

export function seedBasics(db, now = new Date().toISOString()) {
  if (db.get('SELECT COUNT(*) AS n FROM verticals').n > 0) return false;
  db.tx(() => {
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('company_name', 'BrainADZ')");
    for (const v of DEFAULT_VERTICALS) {
      const { id } = db.run(
        'INSERT INTO verticals (name, short, code, tagline, color, key_date_label, ready_label, sort, active) VALUES (?,?,?,?,?,?,?,?,1)',
        v.name, v.short, v.code, v.tagline, v.color, v.key_date_label, v.ready_label || '', v.sort,
      );
      for (const t of DEFAULT_TEMPLATES[v.short] || []) {
        db.run(
          'INSERT INTO templates (vertical_id, name, description, stages, tasks, milestones, created_at) VALUES (?,?,?,?,?,?,?)',
          id, t.name, t.description, JSON.stringify(t.stages), JSON.stringify(t.tasks), JSON.stringify(t.milestones), now,
        );
      }
    }
  });
  return true;
}
