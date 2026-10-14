import { nowInTimeZone } from './dates.js';
import { runReminderCheck } from './reminders.js';

// Runs the reminder check once a day at REMINDER_TIME (in APP_TIMEZONE). If the app
// starts after that time, it runs straight away so a restart never skips a day.
export function startScheduler({ store, mailer, config, logger = console, intervalMs = 60_000 }) {
  let lastRunDate = null;

  const tick = async () => {
    const { date, time } = nowInTimeZone(config.timezone);
    if (time < config.reminderTime || lastRunDate === date) return;
    lastRunDate = date;
    try {
      const summary = await runReminderCheck({ store, mailer, today: date, appUrl: config.appUrl });
      if (summary.skipped) logger.warn(`[reminders] ${date}: skipped — ${summary.skipped}`);
      else logger.log(`[reminders] ${date}: ${summary.sent} sent, ${summary.failed} failed`);
    } catch (err) {
      logger.error('[reminders] check failed:', err);
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
