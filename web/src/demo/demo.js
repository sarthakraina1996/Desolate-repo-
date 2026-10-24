// Browser demo: runs the real core API against SQLite compiled to WebAssembly, so the
// published demo behaves like the server app. Data stays in this browser only.
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import wasmB64 from 'virtual:sql-wasm';
import { migrate, seedBasics } from '../../../core/setup.js';
import { seedDemo, seedGroupChats, seedPayments, DEMO_ACCOUNTS, DEMO_PEOPLE, demoEmail } from '../../../core/demo-seed.js';
import { handle } from '../../../core/api.js';
import { loadUser } from '../../../core/access.js';
import { todayIn } from '../../../core/util.js';

const IDB_NAME = 'brainadz-projects-demo';
const DB_KEY = 'db-v1';
const USER_KEY = 'bpm.demo.user';
const MAX_DEMO_FILE = 25 * 1024 * 1024;
// Extensions the artifact viewer lets a page hand to the viewer as a download.
const SAVE_OK = /\.(gif|png|jpe?g|webp|mp4|webm|txt|json|md|docx|pptx|epub|csv|ttf|html|svg|pdf|xlsx|zip)$/i;

// ---------------------------------------------------------------- IndexedDB (best effort)

let idbPromise = null;
function idb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return idbPromise;
}
async function idbGet(store, key) {
  const db = await idb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}
async function idbSet(store, key, value) {
  const db = await idb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      if (value === undefined) tx.objectStore(store).delete(key);
      else tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
async function idbClear() {
  const db = await idb();
  if (!db) return;
  await Promise.all(['kv', 'files'].map((s) => new Promise((resolve) => {
    try {
      const tx = db.transaction(s, 'readwrite');
      tx.objectStore(s).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  })));
}

const pref = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
};

// ---------------------------------------------------------------- sql.js adapter

function adapter(raw) {
  const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  let depth = 0;
  const all = (sql, ...p) => {
    const st = raw.prepare(sql);
    try {
      st.bind(clean(p));
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally {
      st.free();
    }
  };
  return {
    all,
    get: (sql, ...p) => all(sql, ...p)[0],
    run(sql, ...p) {
      raw.run(sql, clean(p));
      const changes = raw.getRowsModified();
      const id = raw.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
      return { id: Number(id), changes };
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
  };
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- boot

export async function startDemo() {
  const SQL = await initSqlJs({ wasmBinary: b64ToBytes(wasmB64).buffer });
  const today = () => todayIn('Asia/Kolkata');
  let raw;
  let db;
  const memFiles = new Map(); // storage_key -> Blob (when IndexedDB is unavailable)
  const urls = new Map();

  async function open(fresh = false) {
    const saved = fresh ? null : await idbGet('kv', DB_KEY);
    raw = saved ? new SQL.Database(saved) : new SQL.Database();
    db = adapter(raw);
    const before = saved ? Number(db.get("SELECT value FROM settings WHERE key = 'schema_version'")?.value || 1) : 0;
    migrate(db);
    // Sample data saved before team groups existed gets sample chats too.
    if (saved && before < 4 && seedGroupChats(db, { today: today() })) await persist();
    // ...and sample client payments, saved before payments existed.
    if (saved && before < 6 && seedPayments(db, { today: today() })) await persist();
    if (!saved) {
      seedBasics(db);
      seedDemo(db, { today: today(), passwordHash: 'demo' });
      await persist();
    }
  }

  let saveTimer = null;
  async function persist() {
    const bytes = raw.export();
    raw.exec('PRAGMA foreign_keys = ON;'); // export() reopens the database and resets pragmas
    await idbSet('kv', DB_KEY, bytes);
  }
  const schedulePersist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist().catch(() => {}), 400);
  };

  await open();

  const services = {
    today,
    now: () => new Date().toISOString(),
    hashPassword: async () => 'demo',
    verifyPassword: async () => true,
    removeStored: async (key) => {
      memFiles.delete(key);
      await idbSet('files', key, undefined);
    },
  };

  const currentUser = () => {
    const email = pref.get(USER_KEY);
    if (!email) return null;
    const row = db.get('SELECT id FROM users WHERE email = ? AND active = 1', email);
    return row ? loadUser(db, row.id) : null;
  };
  const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

  async function request(method, path, { query, body } = {}) {
    const user = currentUser();
    if (!user) throw fail(401, 'Choose who you are to start the demo', 'unauthenticated');
    try {
      const out = await handle({ db, user, query: query || {}, body: body ? JSON.parse(JSON.stringify(body)) : {}, services }, method, path);
      if (method !== 'GET') schedulePersist();
      return out === undefined ? out : JSON.parse(JSON.stringify(out));
    } catch (e) {
      if (e.status) throw e;
      console.error(e);
      throw fail(500, 'Something went wrong in the demo', 'server_error');
    }
  }

  async function getBlob(key) {
    return memFiles.get(key) || (await idbGet('files', key));
  }

  window.__pmDemo = {
    request,
    accounts: () => DEMO_ACCOUNTS.map((a) => {
      const p = DEMO_PEOPLE.find((x) => x.key === a.key);
      return { ...a, email: demoEmail(a.key), name: p.name, title: p.title, color: p.color };
    }),
    current: () => pref.get(USER_KEY),
    signIn(email) {
      pref.set(USER_KEY, email);
    },
    signOut() {
      pref.set(USER_KEY, null);
    },
    people: () => db.all('SELECT id, name, email, title, color, role FROM users WHERE active = 1 ORDER BY name'),
    async reset() {
      clearTimeout(saveTimer);
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
      memFiles.clear();
      await idbClear();
      await open(true);
    },
    async upload(projectId, file, fields = {}) {
      const user = currentUser();
      if (!user) throw fail(401, 'Choose who you are to start the demo');
      if (file.size > MAX_DEMO_FILE) throw fail(413, 'In the demo, files can be up to 25 MB. The full app takes much larger files.');
      const key = `demo/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const blob = file.slice(0, file.size, file.type);
      const stored = await idbSet('files', key, blob);
      if (!stored) memFiles.set(key, blob);
      try {
        const out = await handle(
          { db, user, query: {}, body: { ...fields }, upload: { storage_key: key, name: file.name, mime: file.type || '', size: file.size }, services },
          'POST', `/projects/${projectId}/files`,
        );
        schedulePersist();
        return JSON.parse(JSON.stringify(out));
      } catch (e) {
        await services.removeStored(key);
        throw e;
      }
    },
    async blobUrl(file) {
      if (urls.has(file.storage_key)) return urls.get(file.storage_key);
      const blob = await getBlob(file.storage_key);
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      urls.set(file.storage_key, u);
      return u;
    },
    async download(file) {
      const blob = await getBlob(file.storage_key);
      if (!blob) throw fail(404, 'This file is no longer stored in this browser.');
      await saveViaViewer(file.name, blob);
    },
    async saveText(filename, text) {
      await saveViaViewer(filename, text);
    },
  };
}

async function saveViaViewer(filename, data) {
  const downloads = await window.claude?.use?.('downloads');
  if (downloads) {
    if (!SAVE_OK.test(filename)) throw Object.assign(new Error('This file type cannot be downloaded from the demo. In the full app every file type downloads normally.'), { status: 400 });
    try {
      await downloads.save({ filename, data });
    } catch (e) {
      if (e?.code === 'declined') return;
      throw Object.assign(new Error(e?.message || 'Download is not available here'), { status: 400 });
    }
    return;
  }
  // Opened outside the artifact viewer: plain browser download.
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
