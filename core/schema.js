// Database schema shared by the Node server (node:sqlite) and the in-browser demo (sql.js).
// Both run SQLite, so the same SQL works everywhere.

export const SCHEMA_VERSION = 1;

export const SCHEMA = `
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

export const FILE_CATEGORIES = [
  'Brief',
  'Design',
  'Contract & PO',
  'Quotes & Invoices',
  'Production',
  'Photos & Videos',
  'Final deliverables',
  'Reports',
  'Other',
];

export const DEFAULT_VERTICALS = [
  { name: 'BrainADZ Live', short: 'Live', code: 'LIV', tagline: 'From Vision to Visibility', color: '#E5243B', key_date_label: 'Event date', sort: 1 },
  { name: 'BrainADZ Marketing', short: 'Marketing', code: 'MKT', tagline: 'Ideas That Spark Momentum', color: '#1FB2D6', key_date_label: 'Launch date', sort: 2 },
  { name: 'BrainADZ Exhibits', short: 'Exhibits', code: 'EXH', tagline: 'Where Elegance Meets Execution', color: '#8CC63F', key_date_label: 'Show opens', sort: 3 },
];

// Starter templates. Task offsets are days relative to the project's key date
// (event / launch / show), or to the due date when no key date is set.
export const DEFAULT_TEMPLATES = {
  Live: [
    {
      name: 'Corporate event',
      description: 'Conferences, award nights, dealer meets and annual days.',
      stages: ['Brief', 'Concept & Budget', 'Pre-production', 'Event day', 'Wrap-up'],
      milestones: [
        { title: 'Concept and budget approved', offset: -35 },
        { title: 'Venue and vendors locked', offset: -25 },
        { title: 'Final run-of-show signed off', offset: -5 },
        { title: 'Event day', offset: 0 },
        { title: 'Client report shared', offset: 10 },
      ],
      tasks: [
        { title: 'Client brief and objectives call', stage: 'Brief', offset: -45, priority: 'high' },
        { title: 'Venue recce and shortlist', stage: 'Brief', offset: -40 },
        { title: 'Creative concept deck', stage: 'Concept & Budget', offset: -38, priority: 'high' },
        { title: 'Costing sheet and budget approval', stage: 'Concept & Budget', offset: -35, priority: 'high' },
        { title: 'Vendor quotes: AV, stage, decor', stage: 'Pre-production', offset: -28 },
        { title: 'Artist and emcee bookings', stage: 'Pre-production', offset: -25 },
        { title: 'Stage and backdrop design files', stage: 'Pre-production', offset: -18 },
        { title: 'Invites and RSVP tracking', stage: 'Pre-production', offset: -15 },
        { title: 'Permissions and licences (PPL, police, fire)', stage: 'Pre-production', offset: -12, priority: 'high' },
        { title: 'Run-of-show and cue sheet', stage: 'Pre-production', offset: -5 },
        { title: 'Technical rehearsal', stage: 'Event day', offset: -1, priority: 'high' },
        { title: 'Event day execution', stage: 'Event day', offset: 0, priority: 'urgent' },
        { title: 'Photos and video handover', stage: 'Wrap-up', offset: 5 },
        { title: 'Vendor settlement and invoicing', stage: 'Wrap-up', offset: 10 },
        { title: 'Post-event report to client', stage: 'Wrap-up', offset: 10 },
      ],
    },
    {
      name: 'Concert / public show',
      description: 'Ticketed shows, brand activations and festivals.',
      stages: ['Planning', 'Permissions', 'Production', 'Show day', 'Settlement'],
      milestones: [
        { title: 'Artist contract signed', offset: -45 },
        { title: 'All permissions in hand', offset: -10 },
        { title: 'Show day', offset: 0 },
      ],
      tasks: [
        { title: 'Artist availability and contract', stage: 'Planning', offset: -60, priority: 'high' },
        { title: 'Ticketing partner set-up', stage: 'Planning', offset: -45 },
        { title: 'Police, fire and excise permissions', stage: 'Permissions', offset: -20, priority: 'urgent' },
        { title: 'Crowd management and security plan', stage: 'Permissions', offset: -15 },
        { title: 'Stage, sound and lights production', stage: 'Production', offset: -7 },
        { title: 'Show day execution', stage: 'Show day', offset: 0, priority: 'urgent' },
        { title: 'Box office reconciliation', stage: 'Settlement', offset: 7 },
      ],
    },
  ],
  Marketing: [
    {
      name: 'Integrated campaign',
      description: 'Multi-channel brand or product campaign.',
      stages: ['Brief', 'Strategy', 'Creative', 'Approvals', 'Live', 'Reporting'],
      milestones: [
        { title: 'Strategy signed off', offset: -30 },
        { title: 'Creatives approved', offset: -10 },
        { title: 'Campaign live', offset: 0 },
        { title: 'Campaign report', offset: 30 },
      ],
      tasks: [
        { title: 'Brief and KPIs agreed', stage: 'Brief', offset: -40, priority: 'high' },
        { title: 'Audience and competitor research', stage: 'Strategy', offset: -35 },
        { title: 'Media plan and budget split', stage: 'Strategy', offset: -30, priority: 'high' },
        { title: 'Key visual and copy routes', stage: 'Creative', offset: -22 },
        { title: 'Adaptations: social, print, OOH', stage: 'Creative', offset: -14 },
        { title: 'Client approvals round', stage: 'Approvals', offset: -10, priority: 'high' },
        { title: 'Ads set up and tracking checked', stage: 'Live', offset: -2 },
        { title: 'Campaign go-live', stage: 'Live', offset: 0, priority: 'urgent' },
        { title: 'Weekly performance check-in', stage: 'Live', offset: 7 },
        { title: 'Final campaign report', stage: 'Reporting', offset: 30 },
      ],
    },
    {
      name: 'Social media retainer (monthly)',
      description: 'Monthly content calendar for an always-on account.',
      stages: ['Calendar', 'Production', 'Publishing', 'Report'],
      milestones: [
        { title: 'Content calendar approved', offset: -20 },
        { title: 'Month starts', offset: 0 },
        { title: 'Monthly report', offset: 30 },
      ],
      tasks: [
        { title: 'Content calendar for the month', stage: 'Calendar', offset: -25, priority: 'high' },
        { title: 'Design and copy for posts', stage: 'Production', offset: -12 },
        { title: 'Reels shoot and edit', stage: 'Production', offset: -8 },
        { title: 'Schedule posts', stage: 'Publishing', offset: -1 },
        { title: 'Community management', stage: 'Publishing', offset: 15 },
        { title: 'Monthly analytics report', stage: 'Report', offset: 30 },
      ],
    },
  ],
  Exhibits: [
    {
      name: 'Exhibition stall',
      description: 'Custom-built booth at a trade show.',
      stages: ['Brief', 'Design', 'Approval', 'Fabrication', 'Installation', 'Show', 'Dismantle'],
      milestones: [
        { title: 'Design approved by client', offset: -30 },
        { title: 'Organiser drawings submitted', offset: -21 },
        { title: 'Fabrication complete', offset: -6 },
        { title: 'Handover to client', offset: -1 },
        { title: 'Show opens', offset: 0 },
      ],
      tasks: [
        { title: 'Client brief, stall size and hall plan', stage: 'Brief', offset: -50, priority: 'high' },
        { title: '3D design, first draft', stage: 'Design', offset: -42, priority: 'high' },
        { title: 'Design revisions', stage: 'Design', offset: -35 },
        { title: 'Costing and BOQ', stage: 'Approval', offset: -32, priority: 'high' },
        { title: 'Client sign-off on design and cost', stage: 'Approval', offset: -30, priority: 'urgent' },
        { title: 'Structural drawings to organiser', stage: 'Approval', offset: -21 },
        { title: 'Graphics and branding artwork', stage: 'Fabrication', offset: -14 },
        { title: 'Fabrication at workshop', stage: 'Fabrication', offset: -6 },
        { title: 'Logistics to venue', stage: 'Installation', offset: -4 },
        { title: 'On-site build and electricals', stage: 'Installation', offset: -2, priority: 'high' },
        { title: 'Handover walk-through', stage: 'Installation', offset: -1, priority: 'high' },
        { title: 'Show-time support', stage: 'Show', offset: 0 },
        { title: 'Dismantle and material return', stage: 'Dismantle', offset: 4 },
        { title: 'Final photos and invoice', stage: 'Dismantle', offset: 7 },
      ],
    },
    {
      name: 'Pavilion / large format',
      description: 'Country, state or brand pavilions with multiple co-exhibitors.',
      stages: ['Brief', 'Design', 'Approval', 'Fabrication', 'Installation', 'Show', 'Dismantle'],
      milestones: [
        { title: 'Master design approved', offset: -45 },
        { title: 'Co-exhibitor booths allotted', offset: -30 },
        { title: 'Show opens', offset: 0 },
      ],
      tasks: [
        { title: 'Master plan and zoning', stage: 'Design', offset: -60, priority: 'high' },
        { title: 'Co-exhibitor requirements form', stage: 'Brief', offset: -50 },
        { title: 'Pavilion facade and theme design', stage: 'Design', offset: -50 },
        { title: 'Budget approval', stage: 'Approval', offset: -45, priority: 'urgent' },
        { title: 'Fabrication', stage: 'Fabrication', offset: -8 },
        { title: 'Installation and power', stage: 'Installation', offset: -2 },
        { title: 'Dismantle', stage: 'Dismantle', offset: 4 },
      ],
    },
  ],
};
