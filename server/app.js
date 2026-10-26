import express from 'express';
import multer from 'multer';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, unlink } from 'node:fs';
import path from 'node:path';
import { handle, fileForDownload } from '../core/api.js';
import { loadUser } from '../core/access.js';
import { HttpError, todayIn } from '../core/util.js';
import { hashPassword, verifyPassword, newToken, loginGuard } from './auth.js';
import { hrmsLink, hrmsLinkProblem, readPass } from './sso.js';

const COOKIE = 'bpm_session';
const SESSION_DAYS = 30;
// Types the browser may show inline. Everything else downloads as a file.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'text/plain']);

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function flatQuery(q) {
  const out = {};
  for (const [k, v] of Object.entries(q || {})) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
  }
  return out;
}

export function createApp({ db, dataDir, distDir, timeZone = 'Asia/Kolkata', secureCookies = false, maxUploadMb = 200 }) {
  const uploadsDir = path.join(dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  const storagePath = (key) => {
    const p = path.resolve(uploadsDir, key);
    if (!p.startsWith(path.resolve(uploadsDir) + path.sep)) throw new HttpError(400, 'Invalid file path');
    return p;
  };

  const services = {
    today: () => todayIn(timeZone),
    now: () => new Date().toISOString(),
    hashPassword,
    verifyPassword,
    removeStored: (key) =>
      new Promise((resolve) => {
        if (!key || key.startsWith('sample:')) return resolve();
        try {
          unlink(storagePath(key), () => resolve());
        } catch {
          resolve();
        }
      }),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  // Writes must carry a custom header, which a cross-site form cannot send.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-bpm') !== '1') {
      return res.status(403).json({ error: 'Missing request header', code: 'csrf' });
    }
    next();
  });

  const send = (res, err) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Files can be up to ${maxUploadMb} MB`, code: 'too_large' });
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server', code: 'server_error' });
  };

  // ---------------------------------------------------------------- auth

  // One sign-in with the BrainADZ HRMS, when HRMS_URL and SSO_SECRET are set.
  const hrms = hrmsLink();
  const ssoProblem = hrmsLinkProblem();
  if (ssoProblem) console.warn(`Sign-in with the BrainADZ HRMS is off: ${ssoProblem}.`);
  // Passes already used, so a copied one can't sign anyone in again.
  if (hrms) db.run('CREATE TABLE IF NOT EXISTS sso_passes (jti TEXT PRIMARY KEY, expires_at TEXT)');

  // Starts a session for a person and sets its cookie.
  const startSession = (res, userId) => {
    const token = newToken();
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400000);
    db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)', token, userId, now.toISOString(), expires.toISOString());
    db.run('UPDATE users SET last_login_at = ? WHERE id = ?', now.toISOString(), userId);
    db.run('DELETE FROM sessions WHERE expires_at < ?', now.toISOString());
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, expires, path: '/' });
  };

  app.get('/api/auth/config', (req, res) => {
    const name = db.get("SELECT value FROM settings WHERE key = 'company_name'")?.value || 'BrainADZ';
    res.json({ company_name: name, hrms_url: hrms?.url || null });
  });

  // Signs in with a one-time pass from the HRMS, as the Projects account with the same email.
  app.post('/api/auth/sso', (req, res) => {
    try {
      if (!hrms) throw new HttpError(404, 'Sign-in with the BrainADZ HRMS is not set up');
      const claims = readPass(hrms.secret, req.body?.pass);
      const now = new Date().toISOString();
      db.run('DELETE FROM sso_passes WHERE expires_at < ?', now);
      const fresh = claims && !db.get('SELECT 1 FROM sso_passes WHERE jti = ?', claims.jti);
      if (!fresh) {
        // A forged pass and two different secrets look the same from here; say so for whoever set it up.
        if (!claims) console.warn('Refused a sign-in pass from the HRMS: expired, or signed with a different SSO_SECRET.');
        throw new HttpError(401, 'That sign-in link has expired. Sign in again.', 'bad_pass');
      }
      db.run('INSERT INTO sso_passes (jti, expires_at) VALUES (?,?)', claims.jti, new Date((claims.exp + 60) * 1000).toISOString());
      const email = String(claims.email).trim().toLowerCase();
      const row = db.get('SELECT id, active FROM users WHERE email = ?', email);
      if (!row || !row.active) throw new HttpError(403, `${email} doesn't have access to BrainADZ Projects yet. Ask a Projects admin to add you under Team & Access.`, 'no_account');
      // An unchanged temporary password is no longer needed: cancel it rather than ask for a new one.
      db.run('UPDATE users SET password_hash = NULL, must_change_password = 0 WHERE id = ? AND must_change_password = 1', row.id);
      startSession(res, row.id);
      res.json({ ok: true });
    } catch (e) {
      send(res, e);
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const key = `${req.ip}|${email}`;
      if (loginGuard.blocked(key)) throw new HttpError(429, 'Too many attempts. Try again in 10 minutes.');
      const row = db.get('SELECT id, password_hash, active FROM users WHERE email = ?', email);
      if (!row || !row.active || !(await verifyPassword(password, row.password_hash))) {
        loginGuard.failed(key);
        throw new HttpError(401, 'Incorrect email or password', 'bad_login');
      }
      loginGuard.succeeded(key);
      startSession(res, row.id);
      res.json({ ok: true });
    } catch (e) {
      send(res, e);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) db.run('DELETE FROM sessions WHERE token = ?', token);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Everything below needs a signed-in person.
  app.use('/api', (req, res, next) => {
    const token = readCookie(req, COOKIE);
    const s = token && db.get('SELECT user_id, expires_at FROM sessions WHERE token = ?', token);
    const user = s && s.expires_at > new Date().toISOString() ? loadUser(db, s.user_id) : null;
    if (!user) return res.status(401).json({ error: 'Please sign in', code: 'unauthenticated' });
    req.user = user;
    next();
  });

  const ctxFor = (req, extra = {}) => ({ db, user: req.user, query: flatQuery(req.query), body: req.body || {}, services, ...extra });

  // ---------------------------------------------------------------- files

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const d = new Date();
        const sub = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const dir = path.join(uploadsDir, sub);
        mkdirSync(dir, { recursive: true });
        req.uploadSub = sub;
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, randomBytes(16).toString('hex')),
    }),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1, fields: 10 },
  });

  app.post('/api/projects/:id/upload', (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) return send(res, err);
      if (!req.file) return send(res, new HttpError(400, 'Choose a file to upload'));
      const storage_key = `${req.uploadSub}/${req.file.filename}`;
      // Browsers send non-ASCII file names as latin1 in multipart headers.
      const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      try {
        const out = await handle(
          ctxFor(req, { upload: { storage_key, name, mime: req.file.mimetype, size: req.file.size } }),
          'POST',
          `/projects/${req.params.id}/files`,
        );
        res.json(out);
      } catch (e) {
        await services.removeStored(storage_key);
        send(res, e);
      }
    });
  });

  app.get('/api/files/:id/download', (req, res) => {
    try {
      const f = fileForDownload(ctxFor(req), req.params.id);
      if (f.kind === 'link') return res.redirect(f.url);
      if (!f.storage_key || f.storage_key.startsWith('sample:')) throw new HttpError(404, 'This is a sample record from the demo data. It has no file attached.');
      const p = storagePath(f.storage_key);
      if (!existsSync(p)) throw new HttpError(404, 'The stored file is missing');
      const inline = req.query.inline === '1' && INLINE_TYPES.has(f.mime);
      const encoded = encodeURIComponent(f.name).replace(/['()]/g, escape);
      res.setHeader('Content-Type', inline ? f.mime : f.mime && INLINE_TYPES.has(f.mime) ? f.mime : 'application/octet-stream');
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encoded}`);
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.sendFile(p);
    } catch (e) {
      send(res, e);
    }
  });

  // ---------------------------------------------------------------- core API

  app.all('/api/*', async (req, res) => {
    try {
      const out = await handle(ctxFor(req), req.method, req.path.slice(4));
      res.json(out);
    } catch (e) {
      send(res, e);
    }
  });

  // ---------------------------------------------------------------- web app

  if (distDir && existsSync(distDir)) {
    app.use(express.static(distDir, {
      index: false,
      maxAge: '1h',
      // The installed app checks these for updates, so they must never be served stale.
      setHeaders: (res, file) => {
        if (/(sw\.js|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
        if (file.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');
      },
    }));
    app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else {
    app.get('/', (req, res) => res.type('text').send('API is running. Build the web app with `npm run build`, or use `npm run dev` during development.'));
  }

  return { app, services };
}
