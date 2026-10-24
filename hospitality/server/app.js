// BrainADZ Hospitality OS — Express application factory: security headers, sessions, CSRF
// guard, idempotency, module routes, static client and JSON error handling.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { openDb } from './db/connection.js';
import { HttpError } from './core/errors.js';
import { idempotency } from './core/idempotency.js';
import { sessionMiddleware } from './modules/auth/service.js';
import { publicAuthRoutes, authRoutes } from './modules/auth/routes.js';
import propertyRoutes from './modules/properties/routes.js';
import roomRoutes from './modules/rooms/routes.js';
import rateRoutes from './modules/rates/routes.js';
import guestRoutes from './modules/guests/routes.js';
import reservationRoutes from './modules/reservations/routes.js';
import calendarRoutes from './modules/calendar/routes.js';
import frontdeskRoutes from './modules/frontdesk/routes.js';
import housekeepingRoutes from './modules/housekeeping/routes.js';
import folioRoutes from './modules/folios/routes.js';
import financeRoutes from './modules/finance/routes.js';
import nightAuditRoutes from './modules/nightaudit/routes.js';
import metricRoutes from './modules/metrics/routes.js';
import dashboardRoutes from './modules/dashboard/routes.js';
import systemRoutes, { publicSystemRoutes } from './modules/system/routes.js';
import userRoutes from './modules/users/routes.js';
import { seedDemo, seedDemoInBackground } from './seed/demo.js';
import { seedEmpty } from './seed/empty.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// seedMode 'sync' seeds before returning (tests); 'background' returns at once and seeds in
// slices while API calls get a 503 with progress (first start of the full demo).
export function createApp({ dbFile = ':memory:', dataDir, seed = 'demo', seedOptions = {}, seedMode = 'sync', serveClient = true, log = false } = {}) {
  const db = openDb(dbFile);
  const dir = dataDir || path.join(here, '..', 'data');
  const uploads = path.join(dir, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const seeding = { active: false, done: 0, total: 0, phase: null, error: null, promise: null };
  if (!db.value('SELECT COUNT(*) FROM organizations')) {
    if (seed === 'demo' && seedMode === 'background') {
      seeding.active = true;
      seeding.promise = seedDemoInBackground(db, seedOptions, (p) => Object.assign(seeding, p))
        .then(() => {
          seeding.active = false;
        })
        .catch((e) => {
          seeding.error = e.message;
          console.error('Demo seed failed', e);
        });
    } else if (seed === 'demo') seedDemo(db, seedOptions);
    else if (seed === 'empty') seedEmpty(db);
  }

  const upload = (kind, { maxMb = 10, exts = null } = {}) => {
    const target = path.join(uploads, kind);
    fs.mkdirSync(target, { recursive: true });
    return multer({
      storage: multer.diskStorage({
        destination: target,
        filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname).toLowerCase().slice(0, 8)}`),
      }),
      limits: { fileSize: maxMb * 1024 * 1024, files: 10 },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (exts && !exts.includes(ext)) cb(new HttpError(400, `Unsupported file type ${ext}. Allowed: ${exts.join(', ')}`));
        else cb(null, true);
      },
    });
  };
  const ctx = { db, uploads, upload, seeding };

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    );
    if (log) {
      const t = Date.now();
      res.on('finish', () => {
        if (req.path.startsWith('/api')) console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t}ms`);
      });
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionMiddleware(db));
  // CSRF: state-changing API calls must carry a header a cross-site form cannot set.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'bhos')
      return res.status(403).json({ error: 'Request blocked (missing X-Requested-With header)', code: 'csrf' });
    if (req.method === 'GET') res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // While the demo is being generated, the API reports progress instead of partial data.
  app.use('/api', (req, res, next) => {
    if (!seeding.active || req.path === '/system/health') return next();
    res.status(503).json({
      error: seeding.error ? `Demo data could not be prepared: ${seeding.error}` : 'Preparing the demo environment…',
      code: 'seeding',
      progress: { done: seeding.done, total: seeding.total, phase: seeding.phase },
    });
  });

  const pub = express.Router();
  publicAuthRoutes(pub, ctx);
  publicSystemRoutes(pub, ctx);
  app.use('/api', pub);

  const api = express.Router();
  api.use((req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in', { code: 'unauthenticated' }))));
  authRoutes(api, ctx);
  // Until a privileged user enrols in MFA (when policy requires it), only /auth routes work.
  api.use((req, _res, next) =>
    req.user.mfaSetupRequired ? next(new HttpError(403, 'Set up two-step sign-in to continue', { code: 'mfa_setup_required' })) : next(),
  );
  api.use(idempotency(db));
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
    register(api, ctx);
  api.use((_req, _res, next) => next(new HttpError(404, 'API route not found', { code: 'not_found' })));
  app.use('/api', api);

  if (serveClient) {
    const dist = path.join(here, '..', 'client', 'dist');
    app.use(
      express.static(dist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, file) => {
          if (path.basename(file) === 'sw.js') res.setHeader('Cache-Control', 'no-cache');
          else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      const index = path.join(dist, 'index.html');
      if (!fs.existsSync(index)) return res.status(503).send('Client not built. Run "npm run hos:build" first.');
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message || 'Something went wrong';
    let code = err.code && typeof err.code === 'string' && !err.code.startsWith('ERR_') ? err.code : undefined;
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : message;
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      message = 'Invalid JSON body';
    } else if (/UNIQUE constraint failed/.test(message)) {
      status = 409;
      message = 'A record with these details already exists';
      code = 'duplicate';
    } else if (/immutable|append-only|cannot be deleted/.test(message)) {
      status = 409;
      code = 'immutable';
    } else if (!(err instanceof HttpError) && status === 500) {
      console.error(err);
      message = 'Something went wrong on the server';
    }
    res.status(status).json({ error: message, code, details: err.details });
  });

  return { app, db, seeding };
}
