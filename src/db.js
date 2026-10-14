import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  `
  CREATE TABLE clients (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT,
    company     TEXT,
    phone       TEXT,
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE subscriptions (
    id             INTEGER PRIMARY KEY,
    name           TEXT NOT NULL,
    vendor         TEXT,
    plan           TEXT,
    client_id      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    billing_cycle  TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly')),
    amount         REAL NOT NULL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'USD',
    start_date     TEXT NOT NULL,
    reminder_days  TEXT NOT NULL,
    notify_owner   INTEGER NOT NULL DEFAULT 1,
    notify_client  INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    notes          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE reminder_log (
    id                 INTEGER PRIMARY KEY,
    subscription_id    INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
    subscription_name  TEXT NOT NULL,
    renewal_date       TEXT NOT NULL,
    days_before        INTEGER,
    recipient_type     TEXT NOT NULL CHECK (recipient_type IN ('owner', 'client')),
    recipient_email    TEXT NOT NULL,
    manual             INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
    error              TEXT,
    sent_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX reminder_log_lookup
    ON reminder_log (subscription_id, renewal_date, days_before, recipient_type, status);

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
];

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}
