import { spawn } from 'node:child_process';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createMailer } from './mailer.js';
import { startScheduler } from './scheduler.js';
import { createStore } from './store.js';

try {
  process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

// Used by the double-click start files so the app opens in the browser by itself.
function openBrowser(url) {
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

const config = loadConfig();
const store = createStore(openDatabase(config.databasePath), { settingsDefaults: config.settingsDefaults });
const mailer = createMailer(config.smtp);
const app = createApp({ store, mailer, config });
const url = `http://localhost:${config.port}`;

app.listen(config.port, (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`
  Port ${config.port} is already in use. Either Subscription Manager is already running
  (open ${url} in your browser), or another program is using that port —
  in that case add a line like PORT=3001 to your .env file and start again.
`);
    process.exit(1);
  }
  if (err) throw err;

  console.log(`
  Subscription Manager is running.
  Open ${url} in your browser.
  Keep this window open — closing it stops the app and its daily reminders.
`);
  console.log(`Reminders are checked daily at ${config.reminderTime} (${config.timezone}).`);
  if (!mailer.configured) console.warn('Email is not configured yet — add SMTP settings to .env to send reminders.');
  if (!config.appPassword) console.warn('APP_PASSWORD is not set — anyone who can reach this server can use the app.');
  if (process.env.OPEN_BROWSER === '1') openBrowser(url);

  startScheduler({ store, mailer, config });
});
