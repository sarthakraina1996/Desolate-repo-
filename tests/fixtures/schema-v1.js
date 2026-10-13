// Schema as shipped in the first release (schema version 1), used to test upgrades.
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS verticals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  code TEXT NOT NULL,
  tagline TEXT DEFAULT '',
  color TEXT DEFAULT '#1a6df0',
  key_date_label TEXT DEFAULT 'Key date',
  sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  title TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  color TEXT DEFAULT '#1f2b7b',
  active INTEGER DEFAULT 1,
  must_change_password INTEGER DEFAULT 0,
  created_at TEXT,
  last_login_at TEXT
);

-- Which verticals a person can see, and what they can do there.
-- manager: create, edit, close and re-open projects in the vertical
-- member:  work on projects (tasks, files, milestones, comments)
-- viewer:  read only
CREATE TABLE IF NOT EXISTS user_verticals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vertical_id INTEGER NOT NULL REFERENCES verticals(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('manager','member','viewer')),
  PRIMARY KEY (user_id, vertical_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY,
  vertical_id INTEGER NOT NULL REFERENCES verticals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  stages TEXT DEFAULT '[]',
  tasks TEXT DEFAULT '[]',
  milestones TEXT DEFAULT '[]',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  vertical_id INTEGER NOT NULL REFERENCES verticals(id),
  name TEXT NOT NULL,
  client TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','on_hold','completed','cancelled')),
  health TEXT NOT NULL DEFAULT 'on_track' CHECK (health IN ('on_track','at_risk','off_track')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  stages TEXT DEFAULT '[]',
  stage TEXT DEFAULT '',
  owner_id INTEGER REFERENCES users(id),
  start_date TEXT,
  due_date TEXT,
  key_date TEXT,
  venue TEXT DEFAULT '',
  city TEXT DEFAULT '',
  budget REAL,
  tags TEXT DEFAULT '',
  template_id INTEGER,
  completed_at TEXT,
  created_by INTEGER,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_vertical ON projects(vertical_id, status);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER DEFAULT 0,
  done_at TEXT,
  sort INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','blocked','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  assignee_id INTEGER REFERENCES users(id),
  stage TEXT DEFAULT '',
  start_date TEXT,
  due_date TEXT,
  checklist TEXT DEFAULT '[]',
  sort REAL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT,
  updated_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'file' CHECK (kind IN ('file','link')),
  name TEXT NOT NULL,
  url TEXT,
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  category TEXT DEFAULT 'Other',
  storage_key TEXT,
  is_final INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  uploaded_by INTEGER,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER,
  text TEXT NOT NULL,
  read INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
`;
