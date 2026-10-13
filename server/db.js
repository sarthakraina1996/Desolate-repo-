import { DatabaseSync } from 'node:sqlite';

// Thin wrapper over node:sqlite with the interface core/api.js expects.
export function openDb(file) {
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const cache = new Map();
  const prep = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const clean = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  let depth = 0;
  return {
    all: (sql, ...p) => prep(sql).all(...clean(p)).map((r) => ({ ...r })),
    get: (sql, ...p) => {
      const r = prep(sql).get(...clean(p));
      return r ? { ...r } : undefined;
    },
    run: (sql, ...p) => {
      const r = prep(sql).run(...clean(p));
      return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    exec: (sql) => raw.exec(sql),
    tx(fn) {
      if (depth) return fn();
      depth++;
      raw.exec('BEGIN');
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
    close: () => raw.close(),
  };
}
