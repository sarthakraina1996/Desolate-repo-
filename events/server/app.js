import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { openDb } from './db.js';
import { csrfGuard, sessionMiddleware } from './auth.js';
import { HttpError } from './core.js';
import { createAdapters } from './adapters/index.js';
import { seedDemo, seedEmpty } from './seed.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import exhibitorRoutes from './routes/exhibitor.js';
import gateRoutes from './routes/gate.js';
import orgRoutes from './routes/org.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Builds the Express app: opens and migrates the database, seeds it if empty, mounts the
// versioned API under /api/v1 and serves the web app.
export function createApp({ dbFile, dataDir, seed = 'demo', serveClient = true, env = process.env } = {}) {
  const db = openDb(dbFile);
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Signing secret for order links: from the environment, or generated once and kept.
  let secret = env.APP_SECRET || db.value("SELECT value FROM app_settings WHERE key = 'secret'");
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    db.run("INSERT INTO app_settings (key, value) VALUES ('secret', ?)", secret);
  }

  // Multer instance per upload kind; files land in private storage with random names.
  const upload = (kind, { maxMb = 10, exts = null } = {}) => {
    const dir = path.join(uploadsDir, kind);
    fs.mkdirSync(dir, { recursive: true });
    return multer({
      storage: multer.diskStorage({
        destination: dir,
        filename: (_req, file, cb) =>
          cb(null, `${crypto.randomBytes(12).toString('hex')}${path.extname(file.originalname).toLowerCase().slice(0, 8)}`),
      }),
      limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ok = !exts || exts.includes(path.extname(file.originalname).toLowerCase());
        cb(ok ? null : new HttpError(400, `File type not allowed. Use ${exts.join(', ')}`), ok);
      },
    });
  };

  const ctx = {
    db,
    adapters: createAdapters(db, env),
    secret,
    uploadsDir,
    upload,
    baseUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    demo: false,
  };

  if (!db.value('SELECT COUNT(*) FROM organisers')) {
    if (seed === 'demo') seedDemo(ctx);
    else if (seed === 'empty') seedEmpty(ctx, env);
  }
  ctx.demo = Boolean(db.value("SELECT value FROM app_settings WHERE key = 'demo'"));

  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', Number(env.TRUST_PROXY) || env.TRUST_PROXY);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Without PUBLIC_URL, links in emails use the address the server was reached on.
    if (!env.PUBLIC_URL) ctx.baseUrl = `${req.protocol}://${req.get('host')}`;
    next();
  });

  // Payment callbacks need the raw body for signature checks, so JSON parsing skips them.
  const jsonBody = express.json({ limit: '1mb' });
  app.use('/api', (req, res, next) => (req.path.startsWith('/v1/webhooks/') ? next() : jsonBody(req, res, next)));
  app.use('/api', sessionMiddleware(db), csrfGuard);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  for (const routes of [authRoutes, publicRoutes, exhibitorRoutes, gateRoutes, orgRoutes]) app.use('/api/v1', routes(ctx));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // App-link verification files, so pass and invitation links open the installed apps.
  app.get('/.well-known/apple-app-site-association', (_req, res) => {
    res.json({
      applinks: {
        details: [{ appIDs: [env.IOS_APP_ID || 'TEAMID.com.brainadz.events'], components: [{ '/': '/p/*' }, { '/': '/e/*' }, { '/': '/signin' }] }],
      },
    });
  });
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: env.ANDROID_PACKAGE || 'com.brainadz.events',
          sha256_cert_fingerprints: (env.ANDROID_CERT_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean),
        },
      },
    ]);
  });

  if (serveClient) {
    const dist = path.join(here, '..', 'web', 'dist');
    if (fs.existsSync(dist)) {
      app.use(
        express.static(dist, {
          index: false,
          setHeaders: (res, file) => {
            const immutable = file.includes(`${path.sep}assets${path.sep}`);
            res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
          },
        }),
      );
      app.get(/.*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(dist, 'index.html'));
      });
    } else {
      app.get(/.*/, (_req, res) => res.status(503).send('Web app not built. Run: npm run build'));
    }
  }

  // Central error handler: HttpErrors and upload errors become JSON with their status.
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError || (err.status && err.status < 500))
      return res.status(err.status).json({ error: err.message, code: err.code });
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : `Upload failed: ${err.message}`;
      return res.status(400).json({ error: msg });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return { app, db, ctx };
}
