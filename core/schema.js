// Database schema shared by the Node server (node:sqlite) and the in-browser demo (sql.js).
// Both run SQLite, so the same SQL works everywhere.

export const SCHEMA_VERSION = 9;

// Kept as a function so a migration can rebuild the table with the same definition.
export function projectsTable(name) {
  return `
CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  vertical_id INTEGER NOT NULL REFERENCES verticals(id),
  name TEXT NOT NULL,
  client TEXT DEFAULT '',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','on_hold','ready','completed','cancelled')),
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
  board_sort REAL,
  completed_at TEXT,
  group_started_at TEXT, -- when the project's team group started (it starts with the project); NULL while there is none
  created_by INTEGER,
  created_at TEXT,
  updated_at TEXT
);
`;
}

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
  -- Optional last board column before a project is delivered, e.g. "Ready for Event / Exhibition".
  ready_label TEXT DEFAULT '',
  -- What this business calls a project's place or medium: Venue, Platform, Channels.
  venue_label TEXT DEFAULT 'Venue',
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

${projectsTable('projects')}
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
  assigned_at TEXT,
  assigned_by INTEGER,
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
  created_at TEXT,
  -- Set when the file was shared in the project's team group (it is a project file too).
  message_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT,
  -- Deleting is allowed for 15 seconds; after that a head must approve it.
  delete_status TEXT CHECK (delete_status IN ('requested','approved','declined')),
  delete_requested_at TEXT,
  delete_decided_by INTEGER,
  delete_decided_at TEXT
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

-- When each person last opened a tab (e.g. "project:12:tasks", "mywork"), so counts
-- can show in red while something new is waiting for them.
CREATE TABLE IF NOT EXISTS seen (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, scope)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  task_id INTEGER,
  text TEXT NOT NULL,
  -- Where clicking the notification goes, when it is not the project or task (e.g. "/teams/12").
  link TEXT DEFAULT '',
  read INTEGER DEFAULT 0,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

-- Team groups: every project has a group chat for the people working on it (owner, team
-- and anyone with a task). It closes when the project is delivered or cancelled.
-- kind: message (chat), update (progress update), status (on track / need help / blocked / done),
-- system (joins, status changes and the group closing).
CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- never reused, so a live chat can track messages by id
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message','update','status','system')),
  status TEXT CHECK (status IN ('on_track','need_help','blocked','done')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Same rule as comments: 15 seconds to delete, then a head has to approve it.
  delete_status TEXT CHECK (delete_status IN ('requested','approved','declined')),
  delete_requested_at TEXT,
  delete_decided_by INTEGER,
  delete_decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_group_messages_project ON group_messages(project_id, id);

-- Money received from the client for a project. What is still to come is the project's
-- budget minus these.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  received_on TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'bank' CHECK (method IN ('bank','upi','cheque','cash','card','other')),
  reference TEXT NOT NULL DEFAULT '', -- UTR, cheque number and so on
  note TEXT NOT NULL DEFAULT '',      -- e.g. "Advance, 40%"
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_project ON payments(project_id);
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
  { name: 'BrainADZ Live', short: 'Live', code: 'LIV', tagline: 'From Vision to Visibility', color: '#E5243B', key_date_label: 'Go-live date', ready_label: 'Ready for Go-Live', venue_label: 'Platform', sort: 1 },
  { name: 'BrainADZ Marketing', short: 'Marketing', code: 'MKT', tagline: 'Ideas That Spark Momentum', color: '#1FB2D6', key_date_label: 'Launch date', venue_label: 'Channels', sort: 2 },
  { name: 'BrainADZ Exhibits', short: 'Exhibits', code: 'EXH', tagline: 'Where Elegance Meets Execution', color: '#8CC63F', key_date_label: 'Show opens', ready_label: 'Ready for Event / Exhibition', venue_label: 'Venue', sort: 3 },
];

// Starter templates. Task offsets are days relative to the project's key date
// (go-live / launch / show), or to the due date when no key date is set.
export const DEFAULT_TEMPLATES = {
  // BrainADZ Live builds software: web applications, mobile apps and websites.
  Live: [
    {
      name: 'Web application',
      description: 'Custom software, portals and dashboards: from requirements to go-live and support.',
      stages: ['Discovery', 'Requirements', 'UI/UX Design', 'Development', 'Testing & QA', 'UAT', 'Go-live', 'Support'],
      milestones: [
        { title: 'Scope and requirements signed off', offset: -75 },
        { title: 'UI designs approved', offset: -55 },
        { title: 'Feature complete (code freeze)', offset: -20 },
        { title: 'UAT signed off', offset: -5 },
        { title: 'Go-live', offset: 0 },
        { title: 'Warranty support ends', offset: 30 },
      ],
      tasks: [
        { title: 'Kick-off and discovery workshop', stage: 'Discovery', offset: -95, priority: 'high' },
        { title: 'Requirements document (SRS) and user stories', stage: 'Requirements', offset: -85, priority: 'high' },
        { title: 'Effort estimate, sprint plan and client sign-off', stage: 'Requirements', offset: -75, priority: 'urgent' },
        { title: 'Wireframes and user flows', stage: 'UI/UX Design', offset: -68 },
        { title: 'UI designs and design sign-off', stage: 'UI/UX Design', offset: -55, priority: 'high' },
        { title: 'Architecture, database design and environments', stage: 'Development', offset: -52 },
        { title: 'Sprint 1: sign-in, roles and core modules', stage: 'Development', offset: -42 },
        { title: 'Sprint 2: integrations and APIs', stage: 'Development', offset: -32 },
        { title: 'Sprint 3: admin panel and reports', stage: 'Development', offset: -22 },
        { title: 'Functional and regression testing', stage: 'Testing & QA', offset: -14, priority: 'high' },
        { title: 'Security and performance checks', stage: 'Testing & QA', offset: -10 },
        { title: 'UAT with the client team and sign-off', stage: 'UAT', offset: -5, priority: 'urgent' },
        { title: 'Production deployment and data migration', stage: 'Go-live', offset: -1, priority: 'urgent' },
        { title: 'Go-live and smoke test', stage: 'Go-live', offset: 0, priority: 'urgent' },
        { title: 'User training and handover documents', stage: 'Support', offset: 5 },
        { title: 'Hypercare: fixes in the first two weeks', stage: 'Support', offset: 14 },
      ],
    },
    {
      name: 'Mobile app',
      description: 'Android and iOS apps with their backend, through to release on the app stores.',
      stages: ['Discovery', 'Design', 'Development', 'Testing', 'Store release', 'Support'],
      milestones: [
        { title: 'App screens approved', offset: -50 },
        { title: 'Beta build with the client', offset: -21 },
        { title: 'Approved on Play Store and App Store', offset: -2 },
        { title: 'Live on the stores', offset: 0 },
      ],
      tasks: [
        { title: 'Feature list and user journeys', stage: 'Discovery', offset: -75, priority: 'high' },
        { title: 'App wireframes', stage: 'Design', offset: -62 },
        { title: 'App screen designs and sign-off', stage: 'Design', offset: -50, priority: 'high' },
        { title: 'Backend APIs and admin panel', stage: 'Development', offset: -40 },
        { title: 'Android and iOS app development', stage: 'Development', offset: -28, priority: 'high' },
        { title: 'Push notifications and analytics', stage: 'Development', offset: -24 },
        { title: 'Beta build to the client (TestFlight, Play internal test)', stage: 'Testing', offset: -21, priority: 'high' },
        { title: 'Testing on real devices and bug fixes', stage: 'Testing', offset: -12 },
        { title: 'Store listings: screenshots, descriptions, privacy policy', stage: 'Store release', offset: -8 },
        { title: 'Submit to Play Store and App Store', stage: 'Store release', offset: -6, priority: 'urgent' },
        { title: 'Release on the stores', stage: 'Store release', offset: 0, priority: 'urgent' },
        { title: 'Crash monitoring and first update', stage: 'Support', offset: 14 },
      ],
    },
    {
      name: 'Website',
      description: 'Company and product websites on a CMS, with SEO set up at launch.',
      stages: ['Brief', 'Sitemap & Content', 'Design', 'Build', 'Testing', 'Launch'],
      milestones: [
        { title: 'Sitemap and content received', offset: -35 },
        { title: 'Home page design approved', offset: -28 },
        { title: 'Website live', offset: 0 },
      ],
      tasks: [
        { title: 'Website brief and references', stage: 'Brief', offset: -45, priority: 'high' },
        { title: 'Sitemap and page list', stage: 'Sitemap & Content', offset: -40 },
        { title: 'Content and photos from the client', stage: 'Sitemap & Content', offset: -35, priority: 'high' },
        { title: 'Home page design', stage: 'Design', offset: -30, priority: 'high' },
        { title: 'Inner page designs', stage: 'Design', offset: -24 },
        { title: 'Build pages on the CMS', stage: 'Build', offset: -14 },
        { title: 'Forms, integrations and SEO set-up', stage: 'Build', offset: -9 },
        { title: 'Cross-browser and mobile testing', stage: 'Testing', offset: -5 },
        { title: 'Domain, hosting and SSL', stage: 'Launch', offset: -2 },
        { title: 'Website launch', stage: 'Launch', offset: 0, priority: 'urgent' },
        { title: 'CMS training and handover', stage: 'Launch', offset: 5 },
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
