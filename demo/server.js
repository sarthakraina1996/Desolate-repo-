// The HRMS server running inside the browser for the claude.ai demo. It
// reuses the real route modules, database code and seed; only the transport
// differs: a small router replaces Express and requests arrive through a
// patched fetch() instead of HTTP.
import fs from './shims/fs.js';
import path from './shims/path.js';
import { randomBytes } from './shims/crypto.js';
import { openDb } from '../server/db.js';
import { sessionMiddleware } from '../server/auth.js';
import { HttpError, fail, getSettings, setSetting } from '../server/core.js';
import { seedDemo } from '../server/seed.js';
import authRoutes from '../server/routes/auth.js';
import metaRoutes from '../server/routes/meta.js';
import dashboardRoutes from '../server/routes/dashboard.js';
import employeeRoutes from '../server/routes/employees.js';
import leaveRoutes from '../server/routes/leave.js';
import attendanceRoutes from '../server/routes/attendance.js';
import policyRoutes from '../server/routes/policies.js';
import payrollRoutes from '../server/routes/payroll.js';
import hiringRoutes from '../server/routes/hiring.js';
import screenerRoutes from '../server/routes/screener.js';
import resignationRoutes from '../server/routes/resignations.js';
import performanceRoutes from '../server/routes/performance.js';
import reportRoutes from '../server/routes/reports.js';
import settingsRoutes from '../server/routes/settings.js';

const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.txt': 'text/plain', '.csv': 'text/csv',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';

// Express-style router: r.get('/employees/:id', ...handlers).
class Router {
  constructor() { this.routes = []; }
  add(method, pattern, fns) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/[.]/g, '\\.').replace(/:([A-Za-z_]\w*)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`, 'i');
    this.routes.push({ method, re, keys, fns });
  }
  get(p, ...fns) { this.add('GET', p, fns); }
  post(p, ...fns) { this.add('POST', p, fns); }
  put(p, ...fns) { this.add('PUT', p, fns); }
  patch(p, ...fns) { this.add('PATCH', p, fns); }
  delete(p, ...fns) { this.add('DELETE', p, fns); }
  match(method, p) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(p);
      if (m) return { fns: r.fns, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

// Runs handlers in order; each either answers, calls next(), or throws.
async function runChain(fns, req, res) {
  for (const fn of fns) {
    let advanced = false;
    let error = null;
    const out = fn(req, res, (err) => { advanced = true; error = err || null; });
    if (out && typeof out.then === 'function') await out;
    if (error) throw error;
    if (!advanced || res.finished) return;
  }
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    finished: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    json(obj) { this.setHeader('Content-Type', 'application/json'); this.body = JSON.stringify(obj); this.finished = true; return this; },
    send(b) {
      if (b !== null && typeof b === 'object' && !(b instanceof Uint8Array)) return this.json(b);
      if (!this.headers['content-type']) this.setHeader('Content-Type', 'text/plain; charset=utf-8');
      this.body = b;
      this.finished = true;
      return this;
    },
    sendFile(file) { this.setHeader('Content-Type', mimeOf(file)); this.body = fs.readFileSync(file); this.finished = true; },
    download(file, name) {
      this.setHeader('Content-Type', mimeOf(name || file));
      this.setHeader('Content-Disposition', `attachment; filename="${String(name || path.basename(file)).replace(/"/g, '')}"`);
      this.body = fs.readFileSync(file);
      this.finished = true;
    },
    end() { this.finished = true; },
  };
}

// multer stand-in: reads files from the request's FormData into the
// in-memory store and sets req.file / req.files / req.body like multer does.
function makeUpload(uploads) {
  return (kind, { maxMb = 10, exts = null } = {}) => {
    const dir = path.join(uploads, kind);
    const middleware = (field, max) => async (req, _res, next) => {
      const body = {};
      const files = [];
      if (req.formData) {
        for (const [k, v] of req.formData.entries()) {
          if (typeof v === 'string') body[k] = v;
          else if (k === field) files.push(v);
          else fail(400, 'Unexpected file field');
        }
      }
      if (files.length > max) fail(400, 'Too many files');
      const saved = [];
      for (const f of files) {
        const ext = path.extname(f.name).toLowerCase();
        if (exts && !exts.includes(ext)) fail(400, `Unsupported file type ${ext || ''}. Allowed: ${exts.join(', ')}`);
        if (f.size > maxMb * 1024 * 1024) fail(400, 'File is too large');
        const filename = `${randomBytes(12).toString('hex')}${ext.slice(0, 8)}`;
        fs.writeFileSync(path.join(dir, filename), new Uint8Array(await f.arrayBuffer()));
        saved.push({ fieldname: field, originalname: f.name, filename, size: f.size, mimetype: f.type, destination: dir, path: path.join(dir, filename) });
      }
      req.body = body;
      if (max > 1) req.files = saved;
      else req.file = saved[0];
      next();
    };
    return { single: (field) => middleware(field, 1), array: (field, n = 25) => middleware(field, n) };
  };
}

export function createDemoServer() {
  const db = openDb(':memory:');
  const uploads = '/data/uploads';
  const saveFile = (kind, name, bytes) => fs.writeFileSync(path.join(uploads, kind, path.basename(name)), bytes);
  seedDemo(db, { saveFile });
  // The demo shows office-only sign-in; the corner switcher sets where you are.
  setSetting(db, 'geofence', { ...getSettings(db).geofence, mode: 'login' });
  const ctx = { db, uploads, upload: makeUpload(uploads), here: '/server', saveFile };

  const pub = new Router();
  authRoutes(pub, ctx);
  const api = new Router();
  for (const register of [metaRoutes, dashboardRoutes, employeeRoutes, leaveRoutes, attendanceRoutes, policyRoutes, payrollRoutes, hiringRoutes, screenerRoutes, resignationRoutes, performanceRoutes, reportRoutes, settingsRoutes]) {
    register(api, ctx);
  }
  const session = sessionMiddleware(db);

  // req: { method, path, query, headers, body, formData }
  async function handle(req) {
    const res = makeRes();
    req.params = {};
    req.ip = '127.0.0.1';
    req.secure = false;
    req.get = (h) => req.headers[h.toLowerCase()];
    try {
      session(req, res, () => {});
      if (!['GET', 'HEAD'].includes(req.method) && req.get('x-requested-with') !== 'hrms') throw new HttpError(403, 'Request blocked (missing X-Requested-With header)');
      let hit = pub.match(req.method, req.path);
      if (!hit) {
        if (!req.user) throw new HttpError(401, 'Please sign in');
        hit = api.match(req.method, req.path);
        if (!hit) throw new HttpError(404, 'API route not found');
      }
      req.params = hit.params;
      await runChain(hit.fns, req, res);
      if (!res.finished) res.status(204).end();
    } catch (err) {
      let status = err.status || err.statusCode || 500;
      let message = err.message || 'Something went wrong';
      if (/UNIQUE constraint failed/.test(message)) {
        status = 409;
        message = 'A record with these details already exists';
      } else if (!(err instanceof HttpError) && status === 500) {
        console.error(err);
        message = 'Something went wrong';
      }
      res.headers = {};
      res.status(status).json({ error: message });
    }
    return res;
  }

  // Synchronous lookup of an uploaded photo for <img> tags: the stored file
  // name (changes when the photo is replaced) and its contents.
  function photo(employeeId) {
    const row = db.get('SELECT photo FROM employees WHERE id = ?', Number(employeeId));
    const file = row?.photo ? path.join(uploads, 'photos', path.basename(row.photo)) : null;
    return file && fs.existsSync(file) ? { key: row.photo, blob: new Blob([fs.readFileSync(file)], { type: mimeOf(file) }) } : null;
  }

  return { db, handle, photo };
}
