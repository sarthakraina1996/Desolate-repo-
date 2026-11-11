// The Events server running inside the page for the claude.ai demo: the real routes,
// database, seed data and rules; requests arrive from a patched fetch() instead of HTTP.
import fs from './shims/fs.js';
import { randomBytes } from './shims/crypto.js';
import { openDb } from '../server/db.js';
import { sessionMiddleware } from '../server/auth.js';
import { HttpError, fail } from '../server/core.js';
import { createAdapters } from '../server/adapters/index.js';
import { seedDemo } from '../server/seed.js';
import authRoutes from '../server/routes/auth.js';
import publicRoutes from '../server/routes/public.js';
import exhibitorRoutes from '../server/routes/exhibitor.js';
import gateRoutes from '../server/routes/gate.js';
import orgRoutes from '../server/routes/org.js';

const ext = (name) => (/\.[a-z0-9]+$/i.exec(name) || [''])[0].toLowerCase();

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    finished: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return this.headers[k.toLowerCase()];
    },
    json(o) {
      this.setHeader('Content-Type', 'application/json');
      this.body = JSON.stringify(o);
      this.finished = true;
      return this;
    },
    send(b) {
      if (!this.headers['content-type']) this.setHeader('Content-Type', 'text/plain; charset=utf-8');
      this.body = b;
      this.finished = true;
      return this;
    },
    download(file) {
      this.setHeader('Content-Type', 'application/octet-stream');
      this.body = fs.readFileSync(file);
      this.finished = true;
    },
  };
}

// multer stand-in: takes the file from the request's FormData into the in-memory store.
const upload = (kind, { maxMb = 10, exts = null } = {}) => ({
  single: (field) => async (req, _res, next) => {
    const f = req.formData?.get(field);
    if (f && typeof f !== 'string') {
      if (exts && !exts.includes(ext(f.name))) fail(400, `File type not allowed. Use ${exts.join(', ')}`);
      if (f.size > maxMb * 1048576) fail(400, 'File is too large');
      const filename = `${randomBytes(12).toString('hex')}${ext(f.name)}`;
      fs.writeFileSync(`/data/uploads/${kind}/${filename}`, new Uint8Array(await f.arrayBuffer()));
      req.file = { originalname: f.name, filename, size: f.size, mimetype: f.type };
    }
    next();
  },
});

export function createDemoServer() {
  const db = openDb(':memory:');
  const ctx = {
    db,
    adapters: createAdapters(db, {}),
    secret: 'in-browser-demo',
    uploadsDir: '/data/uploads',
    upload,
    baseUrl: '',
    demo: true,
  };
  seedDemo(ctx);
  const routers = [authRoutes, publicRoutes, exhibitorRoutes, gateRoutes, orgRoutes].map((r) => r(ctx));
  const session = sessionMiddleware(db);

  // Handles one request the way server/app.js does. req: { method, path, query, headers, body, formData }
  return async function handle(req) {
    const res = makeRes();
    req.ip = '127.0.0.1';
    req.protocol = 'https';
    req.get = (h) => req.headers[h.toLowerCase()];
    try {
      session(req, res, () => {});
      let hit = null;
      for (const r of routers) if ((hit = r.match(req.method, req.path))) break;
      if (!hit) throw new HttpError(404, 'Not found');
      req.params = hit.params;
      for (const fn of hit.fns) {
        let advanced = false;
        let error = null;
        await fn(req, res, (e) => {
          advanced = true;
          error = e || null;
        });
        if (error) throw error;
        if (!advanced || res.finished) break;
      }
    } catch (err) {
      const known = err instanceof HttpError || (err.status && err.status < 500);
      if (!known) console.error(err);
      res.headers = {};
      res.status(known ? err.status : 500).json({ error: known ? err.message : 'Something went wrong', code: err.code });
    }
    return res;
  };
}
