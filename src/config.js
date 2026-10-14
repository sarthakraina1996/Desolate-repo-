export function loadConfig(env = process.env) {
  const timezone = env.APP_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`APP_TIMEZONE "${timezone}" is not a valid time zone. Use a name like "Asia/Kolkata" or "America/New_York".`);
  }

  const reminderTime = env.REMINDER_TIME || '09:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) {
    throw new Error(`REMINDER_TIME "${reminderTime}" must be in 24-hour HH:MM format, e.g. 09:00.`);
  }

  const smtpPort = Number(env.SMTP_PORT) || 587;

  return {
    port: Number(env.PORT) || 3000,
    databasePath: env.DATABASE_PATH || 'data/subscriptions.db',
    timezone,
    reminderTime,
    appPassword: env.APP_PASSWORD || '',
    appUrl: (env.APP_URL || '').replace(/\/+$/, ''),
    smtp: {
      host: env.SMTP_HOST || '',
      port: smtpPort,
      secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : smtpPort === 465,
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.MAIL_FROM || env.SMTP_USER || '',
    },
    // Starting values for the Settings page; they can be changed in the app afterwards.
    settingsDefaults: {
      business_name: env.BUSINESS_NAME || 'My Business',
      owner_email: env.OWNER_EMAIL || '',
      default_currency: (env.DEFAULT_CURRENCY || 'USD').toUpperCase(),
      client_note: '',
    },
  };
}
