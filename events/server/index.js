import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

// Server entry point: builds the app from env settings and listens on all interfaces.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const { app } = createApp({
  dbFile: process.env.DB_FILE || path.join(dataDir, 'events.db'),
  dataDir,
  seed: process.env.SEED === 'empty' ? 'empty' : 'demo',
});

const port = Number(process.env.PORT) || 3100;
const host = process.env.HOST || '0.0.0.0';
// Prints the local and venue Wi-Fi URLs so phones and displays can reach this computer.
app.listen(port, host, () => {
  console.log('\n  BrainADZ Events is running.\n');
  console.log(`  On this computer:  http://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || [])
      if (a.family === 'IPv4' && !a.internal) console.log(`  On the venue Wi-Fi: http://${a.address}:${port}`);
  console.log('\n  Keep this window open. Press Ctrl+C to stop.\n');
});
