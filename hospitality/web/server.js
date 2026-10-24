// The Hospitality OS API running inside the browser for the claude.ai web demo: the same
// module routes, session, idempotency and error handling as server/app.js, dispatched by a
// small Express-compatible router instead of an HTTP server.
import { wrapDb } from '../server/db/connection.js';
import { HttpError } from '../server/core/errors.js';
import { idempotency } from '../server/core/idempotency.js';
import { sessionMiddleware } from '../server/modules/auth/service.js';
import { publicAuthRoutes, authRoutes } from '../server/modules/auth/routes.js';
import propertyRoutes from '../server/modules/properties/routes.js';
import roomRoutes from '../server/modules/rooms/routes.js';
import rateRoutes from '../server/modules/rates/routes.js';
import guestRoutes from '../server/modules/guests/routes.js';
import reservationRoutes from '../server/modules/reservations/routes.js';
import calendarRoutes from '../server/modules/calendar/routes.js';
import frontdeskRoutes from '../server/modules/frontdesk/routes.js';
import housekeepingRoutes from '../server/modules/housekeeping/routes.js';
import folioRoutes from '../server/modules/folios/routes.js';
import financeRoutes from '../server/modules/finance/routes.js';
import nightAuditRoutes from '../server/modules/nightaudit/routes.js';
import metricRoutes from '../server/modules/metrics/routes.js';
import dashboardRoutes from '../server/modules/dashboard/routes.js';
import systemRoutes, { publicSystemRoutes } from '../server/modules/system/routes.js';
import userRoutes from '../server/modules/users/routes.js';

// Collects middleware and routes in registration order, like an Express router.
function router(layers) {
  const route = (method) => (path, ...handlers) => {
    const keys = [];
    const re = new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/:(\w+)/g, (_m, k) => (keys.push(k), '/([^/]+)'))}/?$`);
    layers.push({ method, re, keys, handlers });
  };
  return {
    use: (fn) => layers.push({ handlers: [fn] }),
    get: route('GET'),
    post: route('POST'),
    put: route('PUT'),
    delete: route('DELETE'),
    patch: route('PATCH'),
  };
}

function parseQuery(search) {
  const q = {};
  for (const [k, v] of new URLSearchParams(search)) q[k] = k in q ? [].concat(q[k], v) : v;
  return q;
}

export function createWebServer(raw) {
  const db = wrapDb(raw);
  // Stands in for multer: any upload route answers that files cannot be stored here.
  const refuse = (_req, _res, next) => next(new HttpError(501, 'Uploading files is not available in the web demo', { code: 'not_available' }));
  const noUploads = () => ({ single: () => refuse, array: () => refuse, fields: () => refuse, any: () => refuse });
  const ctx = { db, uploads: null, upload: noUploads, seeding: { active: false } };

  const layers = [];
  const app = router(layers);
  app.use(sessionMiddleware(db));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'bhos')
      return res.status(403).json({ error: 'Request blocked (missing X-Requested-With header)', code: 'csrf' });
    next();
  });
  publicAuthRoutes(app, ctx);
  publicSystemRoutes(app, ctx);
  app.use((req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in', { code: 'unauthenticated' }))));
  authRoutes(app, ctx);
  app.use((req, _res, next) =>
    req.user.mfaSetupRequired ? next(new HttpError(403, 'Set up two-step sign-in to continue', { code: 'mfa_setup_required' })) : next(),
  );
  app.use(idempotency(db));
  for (const register of [
    propertyRoutes,
    roomRoutes,
    rateRoutes,
    guestRoutes,
    reservationRoutes,
    calendarRoutes,
    frontdeskRoutes,
    housekeepingRoutes,
    folioRoutes,
    financeRoutes,
    nightAuditRoutes,
    metricRoutes,
    dashboardRoutes,
    systemRoutes,
    userRoutes,
  ])
    register(app, ctx);

  // Same mapping as the Express error handler in server/app.js.
  function errorBody(err) {
    let status = err.status || err.statusCode || 500;
    let message = err.message || 'Something went wrong';
    let code = err.code && typeof err.code === 'string' && !err.code.startsWith('ERR_') ? err.code : undefined;
    if (/UNIQUE constraint failed/.test(message)) {
      status = 409;
      message = 'A record with these details already exists';
      code = 'duplicate';
    } else if (/immutable|append-only|cannot be deleted/.test(message)) {
      status = 409;
      code = 'immutable';
    } else if (!(err instanceof HttpError) && status === 500) {
      console.error(err);
      message = 'Something went wrong in the demo engine';
    }
    return { status, body: { error: message, code, details: err.details } };
  }

  // Handles one API request: { method, url ('/api/…?…'), headers, body } → { status, headers, body }.
  async function handle({ method = 'GET', url, headers = {}, body }) {
    const u = new URL(url, 'http://demo');
    const path = u.pathname.replace(/^\/api/, '') || '/';
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const req = {
      method,
      url: path + u.search,
      originalUrl: u.pathname + u.search,
      path,
      query: parseQuery(u.search),
      params: {},
      headers: lower,
      body,
      ip: '127.0.0.1',
      secure: true,
      get: (name) => lower[name.toLowerCase()],
    };
    const out = { status: 200, headers: {}, body: undefined, done: false };
    const res = {
      get statusCode() {
        return out.status;
      },
      set statusCode(v) {
        out.status = v;
      },
      status(code) {
        out.status = code;
        return res;
      },
      setHeader(k, v) {
        out.headers[k.toLowerCase()] = v;
      },
      getHeader: (k) => out.headers[k.toLowerCase()],
      json(b) {
        out.headers['content-type'] = 'application/json';
        out.body = JSON.stringify(b ?? null);
        out.done = true;
        return res;
      },
      send(b) {
        out.body = typeof b === 'string' ? b : JSON.stringify(b);
        out.done = true;
        return res;
      },
      end() {
        out.done = true;
      },
      sendFile() {
        throw new HttpError(404, 'Files are not available in the web demo');
      },
    };

    let i = 0;
    let error = null;
    // Walks the layers in order; handlers call next() (or next(err)) or end the response.
    async function walk() {
      while (i < layers.length && !out.done) {
        const layer = layers[i++];
        if (layer.re) {
          if (layer.method !== method) continue;
          const m = layer.re.exec(path);
          if (!m) continue;
          if (error) continue;
          req.params = Object.fromEntries(layer.keys.map((k, j) => [k, decodeURIComponent(m[j + 1])]));
        } else if (error) continue;
        for (const h of layer.handlers) {
          let called = false;
          let passed;
          const next = (err) => {
            called = true;
            passed = err;
          };
          try {
            await h(req, res, next);
          } catch (e) {
            error = e;
            break;
          }
          if (out.done) return;
          if (passed) {
            error = passed;
            break;
          }
          if (!called) return; // handler neither answered nor passed on
        }
        if (error) break;
      }
    }
    await walk();
    if (error) {
      const e = errorBody(error);
      return { status: e.status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(e.body) };
    }
    if (!out.done) return { status: 404, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'API route not found', code: 'not_found' }) };
    return { status: out.status, headers: out.headers, body: out.body };
  }

  return { db, handle };
}
