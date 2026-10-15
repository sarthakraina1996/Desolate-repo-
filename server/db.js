// SQLite access through Node's built-in node:sqlite driver (no native build).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS verticals (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, short TEXT NOT NULL,
  tagline TEXT, color TEXT NOT NULL DEFAULT '#1A6DF0'
);
CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT, gender TEXT, dob TEXT, photo TEXT,
  vertical_id INTEGER REFERENCES verticals(id),
  department_id INTEGER REFERENCES departments(id),
  designation TEXT, grade TEXT,
  manager_id INTEGER REFERENCES employees(id),
  employment_type TEXT NOT NULL DEFAULT 'Full-time',
  location_id INTEGER REFERENCES locations(id),
  join_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  exit_date TEXT,
  about TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  certifications TEXT NOT NULL DEFAULT '[]',
  ctc INTEGER NOT NULL DEFAULT 0,
  monthly_tds INTEGER NOT NULL DEFAULT 0,
  pan TEXT, uan TEXT, bank_name TEXT, bank_account TEXT, ifsc TEXT,
  address TEXT, emergency_contact TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_emp_manager ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_emp_status ON employees(status);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','hr','manager','employee')),
  employee_id INTEGER UNIQUE REFERENCES employees(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  annual_quota REAL,
  accrual TEXT NOT NULL DEFAULT 'annual',
  carry_forward_max REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 1,
  calendar_days INTEGER NOT NULL DEFAULT 0,
  gender TEXT,
  kind TEXT NOT NULL DEFAULT 'leave',
  color TEXT NOT NULL DEFAULT '#1A6DF0',
  icon TEXT NOT NULL DEFAULT 'calendar',
  rule TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  half_day INTEGER NOT NULL DEFAULT 0,
  days REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT, decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id, from_date);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_requests(from_date, to_date);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Company', UNIQUE(date, name)
);

CREATE TABLE IF NOT EXISTS attendance (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL,
  check_in TEXT, check_out TEXT, note TEXT,
  updated_by INTEGER,
  PRIMARY KEY (employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);

-- A day can have several work sessions (check in, step out, check in again).
-- gap_reason/gap_note explain the time away before the session started.
CREATE TABLE IF NOT EXISTS work_sessions (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_at TEXT NOT NULL, end_at TEXT,
  mode TEXT NOT NULL DEFAULT 'office',
  ended_by TEXT,
  gap_reason TEXT, gap_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_ws_emp_date ON work_sessions(employee_id, date);

-- Days worked short of the required hours, explained by the employee and
-- approved or rejected by their reporting manager or an administrator.
CREATE TABLE IF NOT EXISTS hour_shortfalls (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  worked_minutes INTEGER NOT NULL,
  required_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Awaiting explanation',
  reason TEXT, explained_at TEXT,
  decided_by INTEGER REFERENCES users(id), decided_at TEXT, decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_short_status ON hour_shortfalls(status);

-- Offices for the sign-in location check: a point with a radius, and
-- optional network addresses (public IP or LAN ranges, comma separated).
CREATE TABLE IF NOT EXISTS office_sites (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 300,
  ip_ranges TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- Where people were when they signed in, checked in, or while their work
-- clock was running, and sign-ins refused for being outside an office.
CREATE TABLE IF NOT EXISTS location_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  event TEXT NOT NULL,
  result TEXT NOT NULL,
  site_id INTEGER REFERENCES office_sites(id) ON DELETE SET NULL,
  site_name TEXT,
  distance_m INTEGER, lat REAL, lng REAL, accuracy_m INTEGER,
  ip TEXT, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_loclog_at ON location_log(at);
CREATE INDEX IF NOT EXISTS idx_loclog_emp ON location_log(employee_id, at);

CREATE TABLE IF NOT EXISTS policies (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General',
  version TEXT NOT NULL DEFAULT '1.0', summary TEXT, content TEXT,
  file TEXT, file_name TEXT,
  requires_ack INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS policy_acks (
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  version TEXT NOT NULL, acked_at TEXT NOT NULL,
  PRIMARY KEY (policy_id, employee_id)
);

CREATE TABLE IF NOT EXISTS posh_training (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posh_complaints (
  id INTEGER PRIMARY KEY, ref_no TEXT NOT NULL UNIQUE,
  complainant_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  respondent TEXT, incident_date TEXT, place TEXT, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Received',
  due_date TEXT,
  updates TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT, kind TEXT NOT NULL DEFAULT 'general',
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, link TEXT, read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  vertical_id INTEGER REFERENCES verticals(id),
  department_id INTEGER REFERENCES departments(id),
  location_id INTEGER REFERENCES locations(id),
  employment_type TEXT NOT NULL DEFAULT 'Full-time',
  work_mode TEXT NOT NULL DEFAULT 'Onsite',
  openings INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Active',
  posted_on TEXT NOT NULL, closed_on TEXT,
  description TEXT,
  must_have TEXT NOT NULL DEFAULT '[]',
  nice_to_have TEXT NOT NULL DEFAULT '[]',
  exp_min REAL, exp_max REAL, education TEXT,
  salary_min REAL, salary_max REAL,
  knockout TEXT NOT NULL DEFAULT '[]',
  hiring_manager_id INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  name TEXT NOT NULL, email TEXT, phone TEXT, location TEXT,
  current_company TEXT, current_title TEXT,
  experience REAL, education TEXT,
  current_ctc REAL, expected_ctc REAL, notice_days INTEGER,
  linkedin TEXT, skills TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'Company Website',
  stage TEXT NOT NULL DEFAULT 'Applied',
  max_stage INTEGER NOT NULL DEFAULT 0,
  screen_status TEXT, screen_error TEXT,
  ai_score INTEGER, ai TEXT, ai_engine TEXT,
  decision TEXT,
  resume_file TEXT, resume_name TEXT, resume_mime TEXT, resume_text TEXT,
  applied_on TEXT NOT NULL,
  offer_ctc REAL, offer_date TEXT, offer_status TEXT, joining_date TEXT,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  reject_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cand_job ON candidates(job_id, stage);
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  round TEXT NOT NULL, scheduled_at TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'Virtual',
  interviewer_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled',
  rating REAL, recommendation TEXT, feedback TEXT
);
CREATE INDEX IF NOT EXISTS idx_int_time ON interviews(scheduled_at);
CREATE TABLE IF NOT EXISTS candidate_activity (
  id INTEGER PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  text TEXT NOT NULL, by_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, done_at TEXT, sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY, month TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'In Review',
  steps TEXT NOT NULL DEFAULT '{}',
  approvals TEXT NOT NULL DEFAULT '[]',
  bank_batch TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  gross INTEGER NOT NULL, deductions INTEGER NOT NULL, net INTEGER NOT NULL,
  employer_cost INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Processed',
  UNIQUE (run_id, employee_id)
);
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  month TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resignations (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  submitted_on TEXT NOT NULL,
  reason_category TEXT NOT NULL, reason TEXT,
  notice_days INTEGER NOT NULL, last_working_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  steps TEXT NOT NULL DEFAULT '{}',
  checklist TEXT NOT NULL DEFAULT '{}',
  clearance TEXT NOT NULL DEFAULT '{}',
  exit_interview TEXT,
  settlement TEXT,
  rehire_eligible INTEGER,
  letters TEXT NOT NULL DEFAULT '{}',
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_cycles (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT,
  weight INTEGER NOT NULL DEFAULT 25, progress INTEGER NOT NULL DEFAULT 0,
  due_date TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  cycle_id INTEGER NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  self_rating REAL, self_comments TEXT,
  manager_rating REAL, manager_comments TEXT,
  final_rating REAL,
  status TEXT NOT NULL DEFAULT 'Not Started',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (cycle_id, employee_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  type TEXT NOT NULL, name TEXT NOT NULL, serial TEXT,
  issued_on TEXT, returned_on TEXT, status TEXT NOT NULL DEFAULT 'Issued'
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other',
  file TEXT NOT NULL, mime TEXT, size INTEGER,
  uploaded_by INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category TEXT NOT NULL, subject TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'Open', response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
  detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function bindable(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

function normalize(params) {
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object'
    && !Array.isArray(params[0]) && !(params[0] instanceof Uint8Array)) {
    const out = {};
    for (const [k, v] of Object.entries(params[0])) out[k] = bindable(v);
    return [out];
  }
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map(bindable);
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  raw.exec(SCHEMA);
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  let depth = 0;
  const db = {
    raw,
    all: (sql, ...p) => stmt(sql).all(...normalize(p)),
    get: (sql, ...p) => stmt(sql).get(...normalize(p)),
    run: (sql, ...p) => stmt(sql).run(...normalize(p)),
    exec: (sql) => raw.exec(sql),
    value: (sql, ...p) => {
      const row = stmt(sql).get(...normalize(p));
      return row ? Object.values(row)[0] : undefined;
    },
    // Nested calls join the outer transaction.
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    insert(table, row) {
      const keys = Object.keys(row);
      const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => `:${k}`).join(',')})`;
      return Number(stmt(sql).run(normalize([row])[0]).lastInsertRowid);
    },
    update(table, id, row) {
      const keys = Object.keys(row);
      if (!keys.length) return;
      const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :__id`;
      stmt(sql).run(normalize([{ ...row, __id: id }])[0]);
    },
    close: () => raw.close(),
  };
  return db;
}

export function json(v, fallback) {
  if (v == null || v === '') return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
