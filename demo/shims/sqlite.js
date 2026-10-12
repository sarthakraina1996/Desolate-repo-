// Stand-in for node:sqlite's DatabaseSync on top of sql.js (SQLite compiled
// to JavaScript), covering what server/db.js uses. Call setSqlJs() with the
// initialised sql.js module before opening a database.
let SQL = null;
export function setSqlJs(mod) { SQL = mod; }

// node:sqlite binds { key } to :key; sql.js wants the prefix in the key.
function bindArgs(params) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)) {
    const out = {};
    for (const [k, v] of Object.entries(params[0])) out[/^[:@$]/.test(k) ? k : `:${k}`] = v;
    return out;
  }
  return params;
}

class Statement {
  constructor(owner, sql) {
    this.owner = owner;
    this.stmt = owner.db.prepare(sql);
  }
  bind(params) {
    this.stmt.reset();
    const args = bindArgs(params);
    if (Array.isArray(args) ? args.length : Object.keys(args).length) this.stmt.bind(args);
  }
  all(...params) {
    this.bind(params);
    const rows = [];
    while (this.stmt.step()) rows.push(this.stmt.getAsObject());
    this.stmt.reset();
    return rows;
  }
  get(...params) {
    this.bind(params);
    const row = this.stmt.step() ? this.stmt.getAsObject() : undefined;
    this.stmt.reset();
    return row;
  }
  run(...params) {
    this.bind(params);
    this.stmt.step();
    this.stmt.reset();
    return { changes: this.owner.db.getRowsModified(), lastInsertRowid: this.owner.lastId.get().id };
  }
}

export class DatabaseSync {
  constructor() {
    if (!SQL) throw new Error('sql.js is not initialised');
    this.db = new SQL.Database();
    const s = this.db.prepare('SELECT last_insert_rowid() AS id');
    this.lastId = { get: () => { s.step(); const r = s.getAsObject(); s.reset(); return r; } };
  }
  exec(sql) { this.db.exec(sql); }
  prepare(sql) { return new Statement(this, sql); }
  close() { this.db.close(); }
}
