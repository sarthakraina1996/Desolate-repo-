-- BrainADZ Events: initial schema.
-- Every operational table carries event_id so each query, file and export can be scoped
-- by organiser and edition. Amounts are integer paise. Timestamps are ISO-8601 UTC strings;
-- event dates (YYYY-MM-DD) are in the event's own timezone.

-- Server-wide values that must survive restarts (for example the generated signing secret).
CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE organisers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  invoice_profile TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client TEXT NOT NULL DEFAULT 'web',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE otp_codes (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('signin','registration')),
  ref TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_otp_email ON otp_codes(email, purpose);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  organiser_id INTEGER NOT NULL REFERENCES organisers(id),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  edition TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'combined' CHECK (kind IN ('exhibition','conference','combined')),
  tagline TEXT,
  description TEXT,
  venue_name TEXT,
  venue_address TEXT,
  city TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  open_time TEXT NOT NULL DEFAULT '10:00',
  close_time TEXT NOT NULL DEFAULT '18:00',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  accessibility TEXT,
  faqs TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '{}',
  qr_secret TEXT NOT NULL,
  guide_version INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_org ON events(organiser_id);

-- Halls, conference rooms and restricted areas. plan holds the 2D grid a hall is drawn on.
CREATE TABLE zones (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'hall' CHECK (kind IN ('hall','conference','restricted','service')),
  restricted INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER,
  plan TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, code)
);

CREATE TABLE gates (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  x REAL,
  y REAL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (event_id, code)
);

CREATE TABLE amenities (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  accessible INTEGER NOT NULL DEFAULT 0
);

-- A fixed display or kiosk. x and y are its "You are here" position inside the zone.
CREATE TABLE kiosks (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'map' CHECK (mode IN ('map','agenda','both')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  UNIQUE (event_id, code)
);

CREATE TABLE pass_classes (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'visitor' CHECK (kind IN ('visitor','delegate','vip','media','exhibitor','speaker','staff')),
  mode TEXT NOT NULL DEFAULT 'free' CHECK (mode IN ('free','paid','invited','approval','internal')),
  description TEXT,
  price_paise INTEGER NOT NULL DEFAULT 0,
  gst_percent INTEGER NOT NULL DEFAULT 18,
  zone_ids TEXT NOT NULL DEFAULT '[]',
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  reentry INTEGER NOT NULL DEFAULT 1,
  lead_scannable INTEGER NOT NULL DEFAULT 1,
  capacity INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, code)
);

CREATE TABLE form_fields (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','select','checkbox')),
  options TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, key)
);

CREATE TABLE invites (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pass_class_id INTEGER NOT NULL REFERENCES pass_classes(id),
  code TEXT NOT NULL UNIQUE,
  email TEXT COLLATE NOCASE,
  note TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

-- Registration, payment and admission are independent states: status is the review state,
-- payment_status the money state, and admission is derived from scan_events.
CREATE TABLE registrations (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  pass_class_id INTEGER NOT NULL REFERENCES pass_classes(id),
  user_id INTEGER REFERENCES users(id),
  ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT,
  company TEXT,
  job_title TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'web',
  invite_id INTEGER REFERENCES invites(id),
  consent_at TEXT,
  lead_opt_out INTEGER NOT NULL DEFAULT 0,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
  contact_verified_at TEXT,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','pending_review','confirmed','rejected','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (payment_status IN ('not_required','pending','paid','failed','refunded')),
  review_note TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  access_hash TEXT,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reg_event ON registrations(event_id, status);
CREATE INDEX idx_reg_user ON registrations(user_id);
CREATE INDEX idx_reg_access ON registrations(access_hash);
-- One live registration per person and pass class in an edition.
CREATE UNIQUE INDEX idx_reg_one_live ON registrations(event_id, email, pass_class_id)
  WHERE status NOT IN ('cancelled','rejected');

CREATE TABLE exhibitors (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  company_name TEXT NOT NULL,
  industry TEXT,
  description TEXT,
  website TEXT,
  catalogue_links TEXT NOT NULL DEFAULT '[]',
  categories TEXT NOT NULL DEFAULT '[]',
  contact_name TEXT,
  contact_email TEXT COLLATE NOCASE,
  contact_phone TEXT,
  billing_name TEXT,
  gstin TEXT,
  billing_address TEXT,
  space_pref TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','changes_requested','approved','rejected','withdrawn')),
  review_note TEXT,
  badge_quota INTEGER NOT NULL DEFAULT 4,
  profile_published INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  submitted_at TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_exh_event ON exhibitors(event_id, status);

CREATE TABLE memberships (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organiser_id INTEGER NOT NULL REFERENCES organisers(id),
  event_id INTEGER REFERENCES events(id),
  role TEXT NOT NULL CHECK (role IN
    ('organiser_admin','organiser_staff','finance','gate_supervisor','gate_staff','exhibitor_admin','booth_staff')),
  exhibitor_id INTEGER REFERENCES exhibitors(id),
  gate_id INTEGER REFERENCES gates(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_member_unique
  ON memberships(user_id, COALESCE(event_id, 0), role, COALESCE(exhibitor_id, 0));
CREATE INDEX idx_member_user ON memberships(user_id, status);

CREATE TABLE booths (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  code TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'shell' CHECK (kind IN ('shell','raw','premium')),
  size_sqm INTEGER NOT NULL DEFAULT 9,
  price_paise INTEGER NOT NULL DEFAULT 0,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL DEFAULT 1,
  h REAL NOT NULL DEFAULT 1,
  blocked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  UNIQUE (event_id, code)
);

-- A booth has at most one live assignment (held or confirmed); the partial unique index is
-- what makes two simultaneous confirmations for one booth resolve to a single winner.
CREATE TABLE booth_assignments (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  booth_id INTEGER NOT NULL REFERENCES booths(id),
  exhibitor_id INTEGER NOT NULL REFERENCES exhibitors(id),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','confirmed','released')),
  hold_expires_at TEXT,
  created_by INTEGER REFERENCES users(id),
  confirmed_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_booth_one_live ON booth_assignments(booth_id)
  WHERE status IN ('held','confirmed');
CREATE UNIQUE INDEX idx_exh_one_live_booth ON booth_assignments(exhibitor_id, booth_id)
  WHERE status IN ('held','confirmed');

CREATE TABLE team_badges (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  exhibitor_id INTEGER NOT NULL REFERENCES exhibitors(id),
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'booth_staff' CHECK (role IN ('exhibitor_admin','booth_staff')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','accepted','revoked')),
  invited_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
CREATE UNIQUE INDEX idx_badge_unique ON team_badges(exhibitor_id, email) WHERE status != 'revoked';

CREATE TABLE passes (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  pass_class_id INTEGER NOT NULL REFERENCES pass_classes(id),
  registration_id INTEGER UNIQUE REFERENCES registrations(id),
  team_badge_id INTEGER UNIQUE REFERENCES team_badges(id),
  token_id TEXT NOT NULL UNIQUE,
  holder_name TEXT NOT NULL,
  holder_company TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoked_reason TEXT,
  issued_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_pass_event ON passes(event_id, status);

CREATE TABLE devices (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  gate_id INTEGER REFERENCES gates(id),
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  app_version TEXT,
  key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  queued_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  last_sync_at TEXT,
  enrolled_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_device_event ON devices(event_id, status);

-- Scan facts (id, gate, device, token, scanned_at, device_result) never change once stored.
-- result, counted and conflict are derived by reconciliation and may be recomputed when a
-- late offline scan with an earlier timestamp arrives.
CREATE TABLE scan_events (
  id TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  gate_id INTEGER NOT NULL REFERENCES gates(id),
  zone_id INTEGER NOT NULL REFERENCES zones(id),
  device_id INTEGER REFERENCES devices(id),
  user_id INTEGER REFERENCES users(id),
  token_id TEXT,
  pass_id INTEGER REFERENCES passes(id),
  method TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','manual','override')),
  mode TEXT NOT NULL DEFAULT 'online' CHECK (mode IN ('online','offline')),
  direction TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  scanned_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  device_result TEXT,
  result TEXT NOT NULL,
  counted INTEGER NOT NULL DEFAULT 0,
  conflict INTEGER NOT NULL DEFAULT 0,
  conflict_with TEXT,
  override_reason TEXT
);
CREATE INDEX idx_scan_pass ON scan_events(pass_id, zone_id, scanned_at);
CREATE INDEX idx_scan_event ON scan_events(event_id, scanned_at);
CREATE INDEX idx_scan_gate ON scan_events(gate_id, scanned_at);

CREATE TABLE printers (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  gate_id INTEGER REFERENCES gates(id),
  name TEXT NOT NULL,
  model TEXT,
  is_spare INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','error','offline')),
  last_error TEXT,
  last_seen_at TEXT
);

-- A printer failure is its own state, separate from admission: the visitor is still admitted.
CREATE TABLE print_jobs (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  pass_id INTEGER NOT NULL REFERENCES passes(id),
  gate_id INTEGER REFERENCES gates(id),
  printer_id INTEGER REFERENCES printers(id),
  kind TEXT NOT NULL DEFAULT 'first' CHECK (kind IN ('first','reprint','spare')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','printing','printed','failed','cancelled')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_by INTEGER REFERENCES users(id),
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_print_event ON print_jobs(event_id, status);

CREATE TABLE checklist_items (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  exhibitor_id INTEGER NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  help TEXT,
  kind TEXT NOT NULL DEFAULT 'confirm' CHECK (kind IN ('upload','order','team','profile','confirm')),
  due_on TEXT,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','awaiting_review','changes_requested','complete')),
  note TEXT,
  upload_id INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (exhibitor_id, key)
);

-- Uploaded files live in private storage and are only served through an authorised route.
CREATE TABLE uploads (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  exhibitor_id INTEGER REFERENCES exhibitors(id),
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE service_items (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'each',
  price_paise INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (event_id, code)
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('registration','booth','service')),
  registration_id INTEGER REFERENCES registrations(id),
  exhibitor_id INTEGER REFERENCES exhibitors(id),
  booth_assignment_id INTEGER REFERENCES booth_assignments(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','part_paid','paid','cancelled','refunded')),
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  gst_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  paid_paise INTEGER NOT NULL DEFAULT 0,
  refunded_paise INTEGER NOT NULL DEFAULT 0,
  invoice_no TEXT UNIQUE,
  invoiced_at TEXT,
  due_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_order_event ON orders(event_id, status);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_paise INTEGER NOT NULL,
  gst_percent INTEGER NOT NULL DEFAULT 18,
  amount_paise INTEGER NOT NULL
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  intent_id TEXT NOT NULL UNIQUE,
  provider_ref TEXT,
  amount_paise INTEGER NOT NULL,
  refunded_paise INTEGER NOT NULL DEFAULT 0,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','pending','captured','failed','refunded')),
  status_at TEXT,
  note TEXT,
  reconciled_by INTEGER REFERENCES users(id),
  reconciled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_payment_order ON payments(order_id);
CREATE UNIQUE INDEX idx_payment_provider_ref ON payments(provider, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- Every provider callback, deduplicated on the provider's own event id.
CREATE TABLE payment_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payment_id INTEGER REFERENCES payments(id),
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','duplicate','stale','ignored')),
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  exhibitor_id INTEGER NOT NULL REFERENCES exhibitors(id),
  pass_id INTEGER NOT NULL REFERENCES passes(id),
  captured_by INTEGER REFERENCES users(id),
  shared TEXT NOT NULL DEFAULT '{}',
  rating TEXT CHECK (rating IN ('hot','warm','cold')),
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  scan_count INTEGER NOT NULL DEFAULT 1,
  first_scanned_at TEXT NOT NULL,
  last_scanned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, exhibitor_id, pass_id)
);

CREATE TABLE lead_exports (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  exhibitor_id INTEGER NOT NULL REFERENCES exhibitors(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  row_count INTEGER NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  zone_id INTEGER REFERENCES zones(id),
  name TEXT NOT NULL,
  capacity INTEGER
);

CREATE TABLE agenda_sessions (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  track_id INTEGER REFERENCES tracks(id),
  room_id INTEGER REFERENCES rooms(id),
  title TEXT NOT NULL,
  description TEXT,
  speakers TEXT NOT NULL DEFAULT '[]',
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER,
  seats_taken INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_session_event ON agenda_sessions(event_id, day, start_time);

CREATE TABLE bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES agenda_sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
);

CREATE TABLE announcements (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'general' CHECK (kind IN ('general','schedule','gate')),
  audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','visitors','exhibitors','staff')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  show_on_displays INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- Everything the email, WhatsApp and push adapters were asked to send.
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY,
  event_id INTEGER REFERENCES events(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp','push')),
  adapter TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  template TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('queued','sent','failed')),
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_outbox_event ON outbox(event_id, created_at);

CREATE TABLE push_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id),
  platform TEXT NOT NULL CHECK (platform IN ('apns','fcm')),
  token TEXT NOT NULL,
  topics TEXT NOT NULL DEFAULT '["schedule","gate"]',
  updated_at TEXT NOT NULL,
  UNIQUE (platform, token)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  organiser_id INTEGER,
  event_id INTEGER,
  user_id INTEGER,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_event ON audit_log(event_id, created_at);

-- Per-event counters for human-readable numbers (orders, invoices).
CREATE TABLE counters (
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, name)
);
