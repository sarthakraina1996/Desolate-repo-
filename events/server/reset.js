// Seed command: deletes the database and uploads, then loads the demo again (npm run seed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
for (const f of ['events.db', 'events.db-wal', 'events.db-shm']) fs.rmSync(path.join(dataDir, f), { force: true });
fs.rmSync(path.join(dataDir, 'uploads'), { recursive: true, force: true });
const { db } = createApp({ dbFile: path.join(dataDir, 'events.db'), dataDir, seed: 'demo', serveClient: false });
console.log(
  `Demo data loaded: ${db.value('SELECT COUNT(*) FROM registrations')} registrations, ${db.value('SELECT COUNT(*) FROM exhibitors')} exhibitors.`,
);
db.close();
