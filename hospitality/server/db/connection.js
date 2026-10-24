// SQLite access through Node's built-in node:sqlite driver (no native build), the same
// approach as the BrainADZ HRMS. Adds versioned migrations, automatic `uid` values for
// syncable tables and nested transactions.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations/index.js';
import { uuidv7 } from '../core/ids.js';

// Converts a JS value into something node:sqlite can bind (booleans to 0/1, objects to JSON).
function bindable(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

// Accepts either one named-params object or positional args (spread or as an array).
function normalize(params) {
  if (
    params.length === 1 &&
    params[0] !== null &&
    typeof params[0] === 'object' &&
    !Array.isArray(params[0]) &&
    !(params[0] instanceof Uint8Array)
  ) {
    const out = {};
    for (const [k, v] of Object.entries(params[0])) out[k] = bindable(v);
    return [out];
  }
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map(bindable);
}

// Applies every migration not yet recorded in schema_migrations, each in its own transaction.
function migrate(raw) {
  raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const done = new Set(
    raw
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    raw.exec('BEGIN');
    try {
      raw.exec(m.sql);
      raw.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${e.message}`);
    }
  }
}

// Opens (or creates) the database, applies migrations and returns a small query helper API.
export function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA cache_size = -65536; PRAGMA temp_store = MEMORY;',
  );
  return wrapDb(raw);
}

// Query helpers over any driver with node:sqlite's DatabaseSync surface (exec, prepare →
// all/get/run, close). The browser demo passes an adapter over sql.js here.
export function wrapDb(raw) {
  migrate(raw);

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
  // Tables that carry a sync `uid` column, discovered once from the schema.
  const uidTables = new Set();
  for (const { name } of raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()) {
    const cols = raw.prepare(`PRAGMA table_info(${name})`).all();
    if (cols.some((c) => c.name === 'uid')) uidTables.add(name);
  }

  let depth = 0;
  const db = {
    raw,
    all: (sql, ...p) => stmt(sql).all(...normalize(p)),
    get: (sql, ...p) => stmt(sql).get(...normalize(p)),
    run: (sql, ...p) => stmt(sql).run(...normalize(p)),
    exec: (sql) => raw.exec(sql),
    // Returns the first column of the first row, or undefined.
    value: (sql, ...p) => {
      const row = stmt(sql).get(...normalize(p));
      return row ? Object.values(row)[0] : undefined;
    },
    // Runs fn in a transaction. IMMEDIATE takes the write lock up front so check-then-write
    // logic (inventory, numbering) cannot interleave with another process writing the file.
    // Nested calls run in a savepoint: if they throw, only their own writes are undone.
    tx(fn) {
      if (depth > 0) {
        const sp = `sp${depth}`;
        depth++;
        raw.exec(`SAVEPOINT ${sp}`);
        try {
          const out = fn();
          raw.exec(`RELEASE ${sp}`);
          return out;
        } catch (e) {
          raw.exec(`ROLLBACK TO ${sp}`);
          raw.exec(`RELEASE ${sp}`);
          throw e;
        } finally {
          depth--;
        }
      }
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
    inTx: () => depth > 0,
    // Inserts a row from an object and returns the new id. Syncable tables get a uid.
    insert(table, row) {
      const data = uidTables.has(table) && !row.uid ? { uid: uuidv7(), ...row } : row;
      const keys = Object.keys(data);
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => `:${k}`).join(',')})`;
      return Number(stmt(sql).run(normalize([data])[0]).lastInsertRowid);
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
