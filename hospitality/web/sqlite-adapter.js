// node:sqlite's DatabaseSync surface (exec, prepare → all/get/run, close) over a sql.js
// Database, so the server's db/connection.js runs unchanged in the browser.

// sql.js binds named parameters by their full name (":id"); node:sqlite takes bare keys.
function bindArgs(params) {
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)) {
    const out = {};
    for (const [k, v] of Object.entries(params[0])) out[/^[:@$]/.test(k) ? k : `:${k}`] = v;
    return out;
  }
  return params;
}

class Statement {
  constructor(adapter, sql) {
    this.adapter = adapter;
    this.stmt = adapter.db.prepare(sql);
  }
  bind(params) {
    this.stmt.reset();
    const args = bindArgs(params);
    if (Array.isArray(args) ? args.length : Object.keys(args).length) this.stmt.bind(args);
  }
  all(...params) {
    this.bind(params);
    const rows = [];
    try {
      while (this.stmt.step()) rows.push(this.stmt.getAsObject());
    } finally {
      this.stmt.reset();
    }
    return rows;
  }
  get(...params) {
    this.bind(params);
    try {
      return this.stmt.step() ? this.stmt.getAsObject() : undefined;
    } finally {
      this.stmt.reset();
    }
  }
  run(...params) {
    this.bind(params);
    try {
      while (this.stmt.step());
    } finally {
      this.stmt.reset();
    }
    const db = this.adapter.db;
    return { changes: db.getRowsModified(), lastInsertRowid: this.adapter.lastId.get().id };
  }
}

export class SqlJsDatabase {
  constructor(db) {
    this.db = db;
    this.lastId = new Statement(this, 'SELECT last_insert_rowid() AS id');
  }
  exec(sql) {
    this.db.exec(sql);
  }
  prepare(sql) {
    return new Statement(this, sql);
  }
  close() {
    this.db.close();
  }
}
