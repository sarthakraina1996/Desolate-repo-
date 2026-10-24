// Server entry point: reads settings from the environment, opens the database in DATA_DIR and
// listens on all interfaces (the property Master Hub serves browsers on the LAN).
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const seed = process.env.SEED === 'empty' ? 'empty' : 'demo';
const { app, seeding } = createApp({
  dbFile: process.env.DB_FILE || path.join(dataDir, 'hospitality.db'),
  dataDir,
  seed,
  seedMode: 'background',
  seedOptions: { log: true, profile: process.env.DEMO_PROFILE === 'test' ? 'test' : 'full' },
  log: process.env.LOG_REQUESTS === '1',
});

const port = Number(process.env.PORT) || 3100;
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log('\n  BrainADZ Hospitality OS is running.\n');
  console.log(`  On this computer:  http://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  On the network:    http://${a.address}:${port}`);
  if (seeding.active) console.log('\n  Preparing the demo environment (first start only)…');
  console.log('');
});
