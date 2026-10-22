import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { lanAddresses } from './lib/network.js';

// Server entry point: builds the app from env settings and listens on all interfaces.
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, '..', 'data');
const { app } = createApp({
  dbFile: process.env.DB_FILE || path.join(dataDir, 'hrms.db'),
  dataDir,
  seed: process.env.SEED === 'empty' ? 'empty' : 'demo',
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
// Prints the local and office Wi-Fi URLs so staff can open the app from other devices.
app.listen(port, host, () => {
  console.log('\n  BrainADZ HRMS is running.\n');
  console.log(`  On this computer:   http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  On the office Wi-Fi: http://${ip}:${port}`);
  console.log('\n  Keep this window open. Press Ctrl+C to stop.\n');
});
