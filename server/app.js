import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { openDb } from './db.js';
import { sessionMiddleware } from './auth.js';
import { HttpError, fail, today as companyToday } from './core.js';
import { generateShortfalls } from './services/workday.js';
import { seedDemo, seedEmpty, hasData } from './seed.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import dashboardRoutes from './routes/dashboard.js';
import employeeRoutes from './routes/employees.js';
import leaveRoutes from './routes/leave.js';
import attendanceRoutes from './routes/attendance.js';
import policyRoutes from './routes/policies.js';
import payrollRoutes from './routes/payroll.js';
import hiringRoutes from './routes/hiring.js';
import screenerRoutes from './routes/screener.js';
import passkeyRoutes from './routes/passkeys.js';
import trainingRoutes from './routes/training.js';
import { ensureTraining } from './services/training.js';
import { deviceMiddleware } from './services/devices.js';
import resignationRoutes from './routes/resignations.js';
import performanceRoutes from './routes/performance.js';
import reportRoutes from './routes/reports.js';
import settingsRoutes from './routes/settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Builds the Express app: opens the database, seeds it if empty and mounts all routes.
export function createApp({ dbFile, dataDir, seed = 'demo', serveClient = true, today } = {}) {
  const db = openDb(dbFile);
  const uploads = path.join(dataDir, 'uploads');
  // Lets the demo seed store sample files (employee documents).
  const saveFile = (kind, name, bytes) => {
    fs.mkdirSync(path.join(uploads, kind), { recursive: true });
    fs.writeFileSync(path.join(uploads, kind, path.basename(name)), bytes);
  };
  // First run: load demo data, or create a lone admin (random password unless ADMIN_PASSWORD).
  if (!hasData(db) && !db.value('SELECT COUNT(*) FROM users')) {
    if (seed === 'demo') seedDemo(db, { today, saveFile });
    else {
      const adminEmail = (process.env.ADMIN_EMAIL || 'admin@brainadz.com').toLowerCase();
      const adminPassword =
        process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
      seedEmpty(db, { adminEmail, adminPassword });
      if (!process.env.ADMIN_PASSWORD)
        console.log(
          `\n  First admin login: ${adminEmail} / ${adminPassword}\n  (you will be asked to change it)\n`,
        );
    }
  }

  // Built-in POSH awareness course; older databases move their POSH completions into Training.
  ensureTraining(db, companyToday(db));

  // Closes work clocks left running overnight and raises short-hours alerts
  // for earlier days. Runs at start and every 30 minutes.
  const shortHoursCheck = () => {
    try {
      generateShortfalls(db, { today: companyToday(db) });
    } catch (e) {
      console.error('Short-hours check failed', e);
    }
  };
  shortHoursCheck();
  setInterval(shortHoursCheck, 30 * 60000).unref();

  fs.mkdirSync(uploads, { recursive: true });
  // Multer instance per upload kind; files land in data/uploads/<kind>/ with random names.
  const upload = (kind, { maxMb = 10, exts = null } = {}) => {
    const dir = path.join(uploads, kind);
    fs.mkdirSync(dir, { recursive: true });
    return multer({
      storage: multer.diskStorage({
        destination: dir,
        filename: (_req, file, cb) =>
          cb(
            null,
            `${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname).toLowerCase().slice(0, 8)}`,
          ),
      }),
      limits: { fileSize: maxMb * 1024 * 1024, files: 25 },
      fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (exts && !exts.includes(ext))
          cb(new HttpError(400, `Unsupported file type ${ext || ''}. Allowed: ${exts.join(', ')}`));
        else cb(null, true);
      },
    });
  };
  const ctx = { db, uploads, upload, here, saveFile };

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  // Security headers on every response.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
    );
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionMiddleware(db));
  // Device cookie, to spot new sign-ins and one phone checking in two people.
  app.use('/api', deviceMiddleware());
  // CSRF guard: state-changing API calls must carry a custom header, which a
  // cross-site form or image request cannot add.
  app.use('/api', (req, res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('X-Requested-With') !== 'hrms'
    ) {
      return res.status(403).json({ error: 'Request blocked (missing X-Requested-With header)' });
    }
    if (req.method === 'GET') res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Auth routes, mounted before the sign-in check so they work without a session.
  const pub = express.Router();
  authRoutes(pub, ctx);
  app.use('/api', pub);

  // Everything else under /api requires a signed-in user.
  const api = express.Router();
  api.use((req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in'))));
  for (const register of [
    metaRoutes,
    dashboardRoutes,
    employeeRoutes,
    leaveRoutes,
    attendanceRoutes,
    policyRoutes,
    payrollRoutes,
    hiringRoutes,
    screenerRoutes,
    resignationRoutes,
    performanceRoutes,
    reportRoutes,
    settingsRoutes,
    passkeyRoutes,
    trainingRoutes,
  ]) {
    register(api, ctx);
  }
  api.use((_req, _res, next) => next(new HttpError(404, 'API route not found')));
  app.use('/api', api);

  // Play Store app link: tells Android that the app with this package and signing key belongs to
  // this site, so it opens full screen with no address bar. Off until both settings are filled in.
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const pkg = (process.env.ANDROID_PACKAGE || '').trim();
    // One or more SHA-256 signing-key fingerprints, comma separated (AB:CD:...).
    const prints = (process.env.ANDROID_CERT_SHA256 || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
    if (!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(pkg) || !prints.length)
      return res.status(404).json([]);
    res.json([
      {
        // Open this site full screen, and offer saved passkeys and passwords to the app.
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
      },
    ]);
  });

  // Serves the built React client, falling back to index.html for client-side routes.
  if (serveClient) {
    const dist = path.join(here, '..', 'client', 'dist');
    app.use(
      express.static(dist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, file) => {
          const name = path.basename(file);
          // The installed app checks these for updates, so they must never be stale.
          if (name === 'sw.js' || name === 'manifest.webmanifest')
            res.setHeader('Cache-Control', 'no-cache');
          // Hashed build files never change.
          else if (file.includes(`${path.sep}assets${path.sep}`))
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      const index = path.join(dist, 'index.html');
      if (!fs.existsSync(index))
        return res.status(503).send('Client not built. Run "npm run build" first.');
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(index);
    });
  }

  // Turns thrown errors into JSON { error }; unexpected ones are logged and hidden.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message || 'Something went wrong';
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : message;
    } else if (err.type === 'entity.parse.failed') {
      status = 400;
      message = 'Invalid JSON body';
    } else if (/UNIQUE constraint failed/.test(message)) {
      status = 409;
      message = 'A record with these details already exists';
    } else if (!(err instanceof HttpError) && status === 500) {
      console.error(err);
      message = 'Something went wrong on the server';
    }
    res.status(status).json({ error: message });
  });

  return { app, db };
}

export { fail };
