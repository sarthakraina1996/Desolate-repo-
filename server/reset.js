// Deletes the local database so the next start re-creates it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const dbFile = process.env.DB_FILE || path.join(dataDir, 'hrms.db');
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
console.log(`Removed ${dbFile}. Start the server to create fresh demo data.`);
