// Builds the claude.ai web demo into hospitality/web/dist/:
//   page.html       the artifact page (no <html>/<head>/<body>: the host adds the skeleton)
//   index.html      the same page in a full document, for local testing
//   sql-wasm.wasm   SQLite compiled to WebAssembly (fetched by the page)
//   demo-db-N.txt   the compact seeded demo database, gzip-compressed, base64 in parts
// Usage: npm run hos:web
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import { templateDb } from '../tests/helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
const require = createRequire(import.meta.url);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

process.env.VITE_WEB_DEMO = '1';
await build({ configFile: path.join(here, 'vite.config.js'), logLevel: 'warn' });
const js = fs.readFileSync(path.join(here, 'dist-vite', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(here, 'dist-vite', 'app.css'), 'utf8');
// Inline script content must not close the element or open an HTML comment early.
const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const monogram = fs.readFileSync(path.join(here, '..', 'client', 'public', 'favicon.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
const page = `<title>BrainADZ Hospitality OS</title>
<meta name="description" content="Working demo of BrainADZ Hospitality OS running in the browser, with fictional demo data.">
<style>${css}
#boot-card .boot-mark svg { width: 48px; height: 48px; }
#boot-card.boot-failed #boot-status { color: var(--danger, #b42318); }
</style>
<div id="root">
  <div class="login-wrap">
    <div class="login-card" id="boot-card" style="text-align:center">
      <div class="boot-mark" aria-hidden="true">${monogram}</div>
      <h1 style="font-size:20px;margin:14px 0 6px">BrainADZ Hospitality OS</h1>
      <p class="muted">A working demo running entirely in your browser: five fictional hotels with bookings, front desk, housekeeping, folios and finance. Nothing you do here leaves this page.</p>
      <div class="progress" style="margin:20px 0 8px;height:8px"><span id="boot-bar" style="width:4%"></span></div>
      <div class="small muted num" id="boot-status">Loading…</div>
    </div>
  </div>
</div>
<script type="module">${safeJs}</script>
`;
fs.writeFileSync(path.join(out, 'page.html'), page);
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${page}</body></html>`,
);
fs.copyFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'), path.join(out, 'sql-wasm.wasm'));

// Demo database: the compact profile, without sessions, in rollback-journal mode for sql.js.
const tmp = path.join(out, 'demo.db');
fs.copyFileSync(await templateDb('test'), tmp);
const db = new DatabaseSync(tmp);
db.exec("DELETE FROM sessions; DELETE FROM mfa_challenges; DELETE FROM idempotency_keys; PRAGMA journal_mode = DELETE; VACUUM;");
db.close();
// claude.ai serves data as text, so the compressed database ships as base64 in parts.
const b64 = zlib.gzipSync(fs.readFileSync(tmp), { level: 9 }).toString('base64');
const PART = 8 * 1024 * 1024;
const parts = [];
for (let i = 0; i < b64.length; i += PART) {
  const name = `demo-db-${parts.length + 1}.txt`;
  fs.writeFileSync(path.join(out, name), b64.slice(i, i + PART));
  parts.push(name);
}
fs.rmSync(tmp);
const manifest = `<script>window.BHOS_DEMO_DB = ${JSON.stringify({ parts, size: b64.length })};</script>\n`;
for (const f of ['page.html', 'index.html']) {
  const file = path.join(out, f);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<script type="module">', `${manifest}<script type="module">`));
}
fs.rmSync(path.join(here, 'dist-vite'), { recursive: true, force: true });

for (const f of fs.readdirSync(out)) console.log(`${(fs.statSync(path.join(out, f)).size / 1048576).toFixed(2).padStart(6)} MB  ${f}`);
