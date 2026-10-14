// All database reads and writes live here.

const SUBSCRIPTION_COLUMNS = [
  'name', 'vendor', 'plan', 'client_id', 'billing_cycle', 'amount', 'currency',
  'start_date', 'reminder_days', 'notify_owner', 'notify_client', 'status', 'notes',
];

const CLIENT_COLUMNS = ['name', 'email', 'company', 'phone', 'notes'];

const SUBSCRIPTION_SELECT = `
  SELECT s.*,
         c.name    AS client_name,
         c.email   AS client_email,
         c.company AS client_company,
         (SELECT MAX(l.sent_at) FROM reminder_log l
           WHERE l.subscription_id = s.id AND l.status = 'sent') AS last_reminder_at
    FROM subscriptions s
    LEFT JOIN clients c ON c.id = s.client_id`;

function toBool(row, ...keys) {
  if (!row) return row;
  const out = { ...row };
  for (const key of keys) out[key] = Boolean(out[key]);
  return out;
}

const subscriptionRow = (row) => toBool(row, 'notify_owner', 'notify_client');

export function createStore(db, { settingsDefaults = {} } = {}) {
  const defaults = {
    business_name: 'My Business',
    owner_email: '',
    default_currency: 'USD',
    client_note: '',
    ...settingsDefaults,
  };

  return {
    getSettings() {
      const settings = { ...defaults };
      for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
        if (key in defaults) settings[key] = value;
      }
      return settings;
    },

    updateSettings(patch) {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      );
      for (const [key, value] of Object.entries(patch)) {
        if (key in defaults) upsert.run(key, String(value));
      }
      return this.getSettings();
    },

    listClients() {
      return db.prepare(`
        SELECT c.*,
               (SELECT COUNT(*) FROM subscriptions s WHERE s.client_id = c.id AND s.status = 'active') AS active_subscriptions
          FROM clients c
         ORDER BY c.name COLLATE NOCASE`).all();
    },

    getClient(id) {
      return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    },

    createClient(data) {
      const cols = CLIENT_COLUMNS;
      const { lastInsertRowid } = db
        .prepare(`INSERT INTO clients (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => data[c] ?? null));
      return this.getClient(lastInsertRowid);
    },

    updateClient(id, data) {
      db.prepare(`UPDATE clients SET ${CLIENT_COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...CLIENT_COLUMNS.map((c) => data[c] ?? null), id);
      return this.getClient(id);
    },

    deleteClient(id) {
      return db.prepare('DELETE FROM clients WHERE id = ?').run(id).changes > 0;
    },

    listSubscriptions({ status } = {}) {
      const rows = status
        ? db.prepare(`${SUBSCRIPTION_SELECT} WHERE s.status = ? ORDER BY s.name COLLATE NOCASE`).all(status)
        : db.prepare(`${SUBSCRIPTION_SELECT} ORDER BY s.name COLLATE NOCASE`).all();
      return rows.map(subscriptionRow);
    },

    getSubscription(id) {
      return subscriptionRow(db.prepare(`${SUBSCRIPTION_SELECT} WHERE s.id = ?`).get(id));
    },

    createSubscription(data) {
      const cols = SUBSCRIPTION_COLUMNS;
      const { lastInsertRowid } = db
        .prepare(`INSERT INTO subscriptions (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => toSql(data[c])));
      return this.getSubscription(lastInsertRowid);
    },

    updateSubscription(id, data) {
      db.prepare(`UPDATE subscriptions SET ${SUBSCRIPTION_COLUMNS.map((c) => `${c} = ?`).join(', ')},
                  updated_at = datetime('now') WHERE id = ?`)
        .run(...SUBSCRIPTION_COLUMNS.map((c) => toSql(data[c])), id);
      return this.getSubscription(id);
    },

    deleteSubscription(id) {
      return db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id).changes > 0;
    },

    hasSentReminder({ subscriptionId, renewalDate, daysBefore, recipientType }) {
      return Boolean(db.prepare(`
        SELECT 1 FROM reminder_log
         WHERE subscription_id = ? AND renewal_date = ? AND days_before = ?
           AND recipient_type = ? AND status = 'sent' AND manual = 0
         LIMIT 1`).get(subscriptionId, renewalDate, daysBefore, recipientType));
    },

    logReminder(entry) {
      db.prepare(`
        INSERT INTO reminder_log
          (subscription_id, subscription_name, renewal_date, days_before, recipient_type,
           recipient_email, manual, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        entry.subscriptionId,
        entry.subscriptionName,
        entry.renewalDate,
        entry.daysBefore ?? null,
        entry.recipientType,
        entry.recipientEmail,
        entry.manual ? 1 : 0,
        entry.status,
        entry.error ?? null,
      );
    },

    listReminderLog(limit = 200) {
      return db.prepare('SELECT * FROM reminder_log ORDER BY id DESC LIMIT ?').all(limit).map((r) => toBool(r, 'manual'));
    },
  };
}

function toSql(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value ?? null;
}
