// Applies pending migrations without starting the server (npm run migrate).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const db = openDb(process.env.DB_FILE || path.join(dataDir, 'events.db'));
console.log(db.applied.length ? `Applied: ${db.applied.join(', ')}` : 'Database is up to date.');
db.close();
