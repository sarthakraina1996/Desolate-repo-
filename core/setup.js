// Creates tables and the starting verticals and templates on a fresh database.
import { SCHEMA, SCHEMA_VERSION, DEFAULT_VERTICALS, DEFAULT_TEMPLATES } from './schema.js';

export function migrate(db) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const row = db.get("SELECT value FROM settings WHERE key = 'schema_version'");
  if (!row) db.run("INSERT INTO settings (key, value) VALUES ('schema_version', ?)", String(SCHEMA_VERSION));
}

export function seedBasics(db, now = new Date().toISOString()) {
  if (db.get('SELECT COUNT(*) AS n FROM verticals').n > 0) return false;
  db.tx(() => {
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('company_name', 'BrainADZ')");
    for (const v of DEFAULT_VERTICALS) {
      const { id } = db.run(
        'INSERT INTO verticals (name, short, code, tagline, color, key_date_label, sort, active) VALUES (?,?,?,?,?,?,?,1)',
        v.name, v.short, v.code, v.tagline, v.color, v.key_date_label, v.sort,
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
