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

const config = loadConfig();
const store = createStore(openDatabase(config.databasePath), { settingsDefaults: config.settingsDefaults });
const mailer = createMailer(config.smtp);
const app = createApp({ store, mailer, config });

app.listen(config.port, () => {
  console.log(`Subscription Manager running at http://localhost:${config.port}`);
  console.log(`Reminders are checked daily at ${config.reminderTime} (${config.timezone}).`);
  if (!mailer.configured) console.warn('Email is not configured yet — add SMTP settings to .env to send reminders.');
  if (!config.appPassword) console.warn('APP_PASSWORD is not set — anyone who can reach this server can use the app.');
});

startScheduler({ store, mailer, config });
