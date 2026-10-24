// Deletes the hospitality database so the next start creates a fresh demo (or empty) setup.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const file = process.env.DB_FILE || path.join(dataDir, 'hospitality.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
console.log(`Removed ${file}. Start the server to create a new demo.`);
