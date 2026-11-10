// SQLite access through Node's built-in node:sqlite driver, with versioned migrations.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, 'migrations');

// node:sqlite rejects undefined and booleans; map them to NULL and 0/1.
const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
function normalize(params) {
  return params.map((p) => {
    if (p && typeof p === 'object' && !Buffer.isBuffer(p)) {
      const out = {};
      for (const [k, v] of Object.entries(p)) out[k] = clean(v);
      return out;
    }
    return clean(p);
  });
}

// Applies every migrations/NNN_name.sql file that has not run yet, each in its own
// transaction, and records it in schema_migrations. Returns the versions applied.
export function migrate(raw) {
  raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set(
    raw
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => r.version),
  );
  const applied = [];
  for (const file of fs.readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith('.sql')) continue;
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    raw.exec('BEGIN');
    try {
      raw.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      raw.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${e.message}`);
    }
    applied.push(version);
  }
  return applied;
}

// Opens (or creates) the database, migrates it and returns a small query helper API.
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const applied = migrate(raw);
  // Prepared statements are cached by SQL text so repeated queries skip re-preparing.
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;
  const db = {
    raw,
    applied,
    all: (sql, ...p) => stmt(sql).all(...normalize(p)),
    get: (sql, ...p) => stmt(sql).get(...normalize(p)),
    run: (sql, ...p) => stmt(sql).run(...normalize(p)),
    exec: (sql) => raw.exec(sql),
    // Returns the first column of the first row, or undefined.
    value: (sql, ...p) => {
      const row = stmt(sql).get(...normalize(p));
      return row ? Object.values(row)[0] : undefined;
    },
    // Runs fn in a write transaction. BEGIN IMMEDIATE takes the write lock up front, so two
    // overlapping approvals or payments queue behind each other instead of failing late.
    // Nested calls join the outer transaction.
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    // Inserts a row from an object and returns the new id.
    insert(table, row) {
      const keys = Object.keys(row);
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => `:${k}`).join(',')})`;
      return Number(stmt(sql).run(normalize([row])[0]).lastInsertRowid);
    },
    // Updates the given columns on the row with this id; no-op when row is empty.
    update(table, id, row) {
      const keys = Object.keys(row);
      if (!keys.length) return;
      const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :__id`;
      stmt(sql).run(normalize([{ ...row, __id: id }])[0]);
    },
    close: () => raw.close(),
  };
  return db;
}

// Parses a JSON column, returning `fallback` when it is empty or malformed.
export function json(v, fallback) {
  if (v == null || v === '') return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

// True when an insert failed on a UNIQUE index: the signal that a concurrent request won.
export const isUniqueViolation = (e) => /UNIQUE constraint failed/i.test(String(e?.message));
