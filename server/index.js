import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { migrate, seedBasics } from '../core/setup.js';
import { hashPassword } from './auth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const dataDir = path.resolve(root, env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });

const db = openDb(path.join(dataDir, 'projects.db'));
migrate(db);
seedBasics(db);

// First run: create the first admin so someone can sign in.
if (db.get('SELECT COUNT(*) AS n FROM users').n === 0) {
  const email = (env.ADMIN_EMAIL || 'admin@brainadz.com').toLowerCase();
  const password = env.ADMIN_PASSWORD || randomBytes(6).toString('base64url');
  db.run(
    "INSERT INTO users (name, email, password_hash, role, title, color, active, must_change_password, created_at) VALUES (?,?,?,'admin',?,?,1,?,?)",
    env.ADMIN_NAME || 'Admin', email, await hashPassword(password), 'Administrator', '#1f2b7b', env.ADMIN_PASSWORD ? 0 : 1, new Date().toISOString(),
  );
  console.log('\n  First admin account created');
  console.log(`  Email:    ${email}`);
  if (!env.ADMIN_PASSWORD) console.log(`  Password: ${password}   (you will be asked to change it after signing in)`);
  console.log('');
}

const { app } = createApp({
  db,
  dataDir,
  distDir: path.join(root, 'dist'),
  timeZone: env.TIMEZONE || 'Asia/Kolkata',
  secureCookies: env.SECURE_COOKIES === '1',
  maxUploadMb: Number(env.MAX_UPLOAD_MB) || 200,
});

const port = Number(env.PORT) || 3000;
app.listen(port, () => console.log(`BrainADZ Projects is running on http://localhost:${port}`));
