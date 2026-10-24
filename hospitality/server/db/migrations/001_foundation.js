// WP1 schema: tenancy, users, audit, sync primitives, property and room masters, rates, guests,
// reservations with per-night room locks, housekeeping, folios, general ledger, night audit.
// Conventions: money is INTEGER minor units with a currency code; dates are 'YYYY-MM-DD'
// (business dates and nights); timestamps are ISO-8601 UTC; `uid` identifies a row across the
// property hub and HQ. See docs/DATABASE_SCHEMA.md.
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export default {
  version: 1,
  name: 'foundation',
  sql: `
-- ---------- tenancy ----------
CREATE TABLE organizations (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  reporting_currency TEXT NOT NULL DEFAULT 'INR',
  fy_start_month INTEGER NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
  is_demo INTEGER NOT NULL DEFAULT 0,
  mfa_required_privileged INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE legal_entities (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  tax_id_type TEXT,
  tax_id TEXT,
  registered_address TEXT,
  base_currency TEXT NOT NULL
);

CREATE TABLE properties (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  legal_entity_id INTEGER REFERENCES legal_entities(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  star_rating INTEGER,
  address TEXT, city TEXT, state TEXT, state_code TEXT, postal_code TEXT,
  country TEXT NOT NULL,
  phone TEXT, email TEXT,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en-IN',
  tax_regime TEXT NOT NULL DEFAULT 'IN_GST' CHECK (tax_regime IN ('IN_GST','EU_VAT','NONE')),
  prices_include_tax INTEGER NOT NULL DEFAULT 0,
  check_in_time TEXT NOT NULL DEFAULT '14:00',
  check_out_time TEXT NOT NULL DEFAULT '12:00',
  weekend_days TEXT NOT NULL DEFAULT '[5,6]',
  business_date TEXT NOT NULL,
  -- First business date this system holds operating records for; metrics report "no data"
  -- (never zero) for earlier dates.
  records_from TEXT NOT NULL,
  inspection_required INTEGER NOT NULL DEFAULT 1,
  require_id_at_checkin INTEGER NOT NULL DEFAULT 1,
  overbooking_pct INTEGER NOT NULL DEFAULT 0 CHECK (overbooking_pct BETWEEN 0 AND 20),
  exclude_ooo_from_available INTEGER NOT NULL DEFAULT 0,
  default_cancellation_policy_id INTEGER,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  description TEXT,
  opened_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (org_id, code)
);

-- USALI-style department catalogue; postings and journal lines carry the department code.
CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('operated','undistributed','non_operating')),
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (org_id, code)
);

CREATE TABLE cost_centres (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (property_id, code)
);

CREATE TABLE bank_accounts (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  bank TEXT NOT NULL,
  account_masked TEXT NOT NULL,
  branch_code TEXT,
  currency TEXT NOT NULL,
  account_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE payment_methods (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cash','card','upi','bank','wallet','city_ledger','other')),
  account_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (property_id, code)
);

-- ---------- users, sessions, audit ----------
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  title TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  all_properties INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  mfa_secret TEXT,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE user_properties (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, property_id)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
-- Password accepted, waiting for the TOTP code.
CREATE TABLE mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  org_id INTEGER,
  property_id INTEGER,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  before TEXT,
  after TEXT,
  at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_property ON audit_log(property_id, at);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- ---------- offline-first primitives ----------
-- Transactional outbox: written in the same transaction as the change it describes.
CREATE TABLE sync_outbox (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER,
  entity TEXT NOT NULL,
  entity_uid TEXT,
  op TEXT NOT NULL,
  payload TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','acked','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  sent_at TEXT,
  acked_at TEXT
);
CREATE INDEX idx_outbox_status ON sync_outbox(status, id);

-- Replay store for Idempotency-Key requests.
CREATE TABLE idempotency_keys (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (user_id, key)
);

-- Gapless document numbering (invoices, folios, bookings) per property and scope.
CREATE TABLE sequences (
  property_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  next_value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (property_id, name, scope)
);

CREATE TABLE fx_rates (
  rate_date TEXT NOT NULL,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate_micros INTEGER NOT NULL CHECK (rate_micros > 0),
  source TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (rate_date, from_currency, to_currency)
);

-- ---------- buildings, floors, amenities, room types, rooms ----------
CREATE TABLE buildings (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (property_id, code)
);
CREATE TABLE floors (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  level INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (building_id, level)
);

CREATE TABLE amenities (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  icon TEXT,
  UNIQUE (org_id, code)
);

CREATE TABLE room_types (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Standard',
  description TEXT,
  base_adults INTEGER NOT NULL DEFAULT 2,
  max_adults INTEGER NOT NULL DEFAULT 2,
  max_children INTEGER NOT NULL DEFAULT 1,
  max_occupancy INTEGER NOT NULL DEFAULT 3,
  extra_beds INTEGER NOT NULL DEFAULT 0,
  area_sqft REAL,
  bedrooms INTEGER NOT NULL DEFAULT 1,
  bed_type TEXT,
  bed_size TEXT,
  view_type TEXT,
  smoking INTEGER NOT NULL DEFAULT 0,
  balcony INTEGER NOT NULL DEFAULT 0,
  bathroom TEXT,
  ac_type TEXT,
  color TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (property_id, code)
);
CREATE TABLE room_type_amenities (
  room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  amenity_id INTEGER NOT NULL REFERENCES amenities(id),
  PRIMARY KEY (room_type_id, amenity_id)
);

-- Physical rooms. Nullable attribute columns inherit the room type's value.
CREATE TABLE rooms (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  floor_id INTEGER NOT NULL REFERENCES floors(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  number TEXT NOT NULL,
  area_sqft REAL,
  bedrooms INTEGER,
  bed_type TEXT,
  bed_size TEXT,
  max_adults INTEGER,
  max_children INTEGER,
  extra_beds INTEGER,
  view_type TEXT,
  smoking INTEGER,
  balcony INTEGER,
  bathroom TEXT,
  ac_type TEXT,
  accessible INTEGER NOT NULL DEFAULT 0,
  accessibility_features TEXT NOT NULL DEFAULT '[]',
  connecting_room_id INTEGER REFERENCES rooms(id),
  description TEXT,
  last_refurbished_on TEXT,
  warranty_notes TEXT,
  cost_centre_id INTEGER REFERENCES cost_centres(id),
  rate_plan_codes TEXT,
  hk_status TEXT NOT NULL DEFAULT 'inspected' CHECK (hk_status IN ('dirty','cleaning','clean','inspected')),
  dnd INTEGER NOT NULL DEFAULT 0,
  maintenance_flag TEXT NOT NULL DEFAULT 'ok' CHECK (maintenance_flag IN ('ok','required')),
  maintenance_note TEXT,
  commissioned_on TEXT NOT NULL,
  decommissioned_on TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (property_id, number)
);
CREATE INDEX idx_rooms_type ON rooms(room_type_id);

-- Authorised exceptions to the room type's amenity list.
CREATE TABLE room_amenity_overrides (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  amenity_id INTEGER NOT NULL REFERENCES amenities(id),
  mode TEXT NOT NULL CHECK (mode IN ('add','remove')),
  reason TEXT NOT NULL,
  approved_by INTEGER REFERENCES users(id),
  at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (room_id, amenity_id)
);

CREATE TABLE room_images (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  room_type_id INTEGER REFERENCES room_types(id),
  room_id INTEGER REFERENCES rooms(id),
  file TEXT NOT NULL,
  caption TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE room_assets (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  serial_no TEXT,
  installed_on TEXT,
  warranty_until TEXT,
  cost_minor INTEGER,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'in_service'
);

-- Out-of-order / out-of-service periods; end_date is exclusive (first night back in service).
CREATE TABLE room_blocks (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  kind TEXT NOT NULL CHECK (kind IN ('ooo','oos')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  released_at TEXT,
  released_by INTEGER,
  CHECK (end_date > start_date)
);
CREATE INDEX idx_blocks_room ON room_blocks(room_id, start_date);

CREATE TABLE room_status_log (
  id INTEGER PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  field TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  reason TEXT,
  user_id INTEGER,
  at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_room_status_log ON room_status_log(room_id, at);

-- ---------- rates ----------
CREATE TABLE cancellation_policies (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  free_cancel_hours INTEGER NOT NULL DEFAULT 24,
  penalty_kind TEXT NOT NULL DEFAULT 'first_night' CHECK (penalty_kind IN ('none','first_night','percent','full_stay')),
  penalty_bp INTEGER NOT NULL DEFAULT 0,
  no_show_kind TEXT NOT NULL DEFAULT 'first_night' CHECK (no_show_kind IN ('none','first_night','full_stay')),
  non_refundable INTEGER NOT NULL DEFAULT 0,
  UNIQUE (property_id, code)
);

CREATE TABLE rate_plans (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  meal_plan TEXT NOT NULL DEFAULT 'RO' CHECK (meal_plan IN ('RO','BB','HB','FB','AI')),
  parent_id INTEGER REFERENCES rate_plans(id),
  derive_kind TEXT NOT NULL DEFAULT 'none' CHECK (derive_kind IN ('none','percent','amount')),
  derive_value INTEGER NOT NULL DEFAULT 0,
  cancellation_policy_id INTEGER REFERENCES cancellation_policies(id),
  is_public INTEGER NOT NULL DEFAULT 1,
  min_los INTEGER NOT NULL DEFAULT 1,
  max_los INTEGER,
  commissionable INTEGER NOT NULL DEFAULT 1,
  -- Per-person, per-night package component posted to F&B instead of Rooms (e.g. breakfast).
  fnb_component_minor INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (property_id, code)
);
CREATE TABLE rate_plan_room_types (
  rate_plan_id INTEGER NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  base_minor INTEGER NOT NULL CHECK (base_minor >= 0),
  weekend_minor INTEGER,
  extra_adult_minor INTEGER NOT NULL DEFAULT 0,
  extra_child_minor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rate_plan_id, room_type_id)
);
-- Explicit nightly rate overrides (rate grid).
CREATE TABLE daily_rates (
  rate_plan_id INTEGER NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  night TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (rate_plan_id, room_type_id, night)
);
-- Restrictions; room_type_id/rate_plan_id 0 means "all".
CREATE TABLE restrictions (
  property_id INTEGER NOT NULL REFERENCES properties(id),
  room_type_id INTEGER NOT NULL DEFAULT 0,
  rate_plan_id INTEGER NOT NULL DEFAULT 0,
  night TEXT NOT NULL,
  min_los INTEGER,
  max_los INTEGER,
  cta INTEGER NOT NULL DEFAULT 0,
  ctd INTEGER NOT NULL DEFAULT 0,
  stop_sell INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, room_type_id, rate_plan_id, night)
);

-- ---------- taxes, charge codes, chart of accounts ----------
CREATE TABLE tax_rules (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  rate_bp INTEGER NOT NULL CHECK (rate_bp >= 0),
  slab_min_minor INTEGER,
  slab_max_minor INTEGER,
  components TEXT NOT NULL DEFAULT '[]',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  note TEXT
);
CREATE INDEX idx_tax_rules ON tax_rules(property_id, category, effective_from);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  usali_section TEXT,
  department TEXT,
  postable INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_id, code)
);

-- Transaction codes used when posting to folios.
CREATE TABLE charge_codes (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  category TEXT NOT NULL,
  tax_category TEXT,
  account_code TEXT NOT NULL,
  hsn_sac TEXT,
  default_minor INTEGER,
  manual INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (property_id, code)
);

-- ---------- guests and companies ----------
CREATE TABLE companies (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL CHECK (kind IN ('corporate','travel_agent','ota','government')),
  name TEXT NOT NULL,
  tax_id TEXT,
  address TEXT, city TEXT, country TEXT,
  email TEXT, phone TEXT, contact_name TEXT,
  ar_enabled INTEGER NOT NULL DEFAULT 0,
  credit_limit_minor INTEGER NOT NULL DEFAULT 0,
  credit_days INTEGER NOT NULL DEFAULT 30,
  commission_bp INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE guests (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  title TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT COLLATE NOCASE,
  phone TEXT,
  gender TEXT,
  dob TEXT,
  nationality TEXT,
  country TEXT,
  city TEXT,
  address TEXT,
  company_id INTEGER REFERENCES companies(id),
  vip TEXT NOT NULL DEFAULT '',
  loyalty_no TEXT,
  preferences TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  id_type TEXT,
  id_number_masked TEXT,
  id_country TEXT,
  id_verified_at TEXT,
  id_verified_by INTEGER,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT,
  anonymized_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_guests_name ON guests(org_id, last_name, first_name);
CREATE INDEX idx_guests_email ON guests(org_id, email);
CREATE INDEX idx_guests_phone ON guests(org_id, phone);

-- ---------- reservations ----------
CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  ref TEXT NOT NULL,
  booker_guest_id INTEGER REFERENCES guests(id),
  company_id INTEGER REFERENCES companies(id),
  source TEXT NOT NULL,
  channel TEXT,
  channel_ref TEXT,
  segment TEXT,
  group_name TEXT,
  notes TEXT,
  idempotency_key TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (property_id, ref)
);
-- A retried create (same Idempotency-Key) returns the existing booking.
CREATE UNIQUE INDEX idx_bookings_idem ON bookings(created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- An OTA reservation id can only be imported once per channel.
CREATE UNIQUE INDEX idx_bookings_channel_ref ON bookings(property_id, channel, channel_ref)
  WHERE channel_ref IS NOT NULL;

CREATE TABLE reservations (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  conf_no TEXT NOT NULL,
  guest_id INTEGER NOT NULL REFERENCES guests(id),
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  rate_plan_id INTEGER REFERENCES rate_plans(id),
  arrival TEXT NOT NULL,
  departure TEXT NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1 CHECK (adults >= 1),
  children INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  status TEXT NOT NULL CHECK (status IN ('quote','confirmed','in_house','checked_out','closed','cancelled','no_show')),
  is_complimentary INTEGER NOT NULL DEFAULT 0,
  is_house_use INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  channel TEXT,
  segment TEXT,
  company_id INTEGER REFERENCES companies(id),
  commission_bp INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  total_minor INTEGER NOT NULL DEFAULT 0,
  discount_bp INTEGER NOT NULL DEFAULT 0,
  deposit_required_minor INTEGER NOT NULL DEFAULT 0,
  guarantee TEXT NOT NULL DEFAULT 'none' CHECK (guarantee IN ('none','card','deposit','company','ota_prepaid')),
  cancellation_policy TEXT,
  eta TEXT,
  special_requests TEXT,
  notes TEXT,
  quote_expires_at TEXT,
  confirmed_at TEXT,
  checked_in_at TEXT,
  checked_out_at TEXT,
  early_checkin INTEGER NOT NULL DEFAULT 0,
  late_checkout INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  cancel_reason TEXT,
  no_show_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (departure > arrival),
  UNIQUE (property_id, conf_no)
);
CREATE INDEX idx_res_property_dates ON reservations(property_id, arrival, departure);
CREATE INDEX idx_res_status ON reservations(property_id, status);
CREATE INDEX idx_res_guest ON reservations(guest_id);
CREATE INDEX idx_res_booking ON reservations(booking_id);

-- Nightly breakdown: booked room type and the net room rate for each night.
CREATE TABLE reservation_nights (
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL,
  night TEXT NOT NULL,
  room_type_id INTEGER NOT NULL REFERENCES room_types(id),
  rate_minor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (reservation_id, night)
);
CREATE INDEX idx_res_nights_night ON reservation_nights(property_id, night);

-- Physical room locks: one row per room per night. The primary key makes overlapping
-- assignments impossible (ADR-4). Exactly one of reservation_id / block_id is set.
CREATE TABLE room_nights (
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  night TEXT NOT NULL,
  property_id INTEGER NOT NULL,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
  block_id INTEGER REFERENCES room_blocks(id) ON DELETE CASCADE,
  PRIMARY KEY (room_id, night),
  CHECK ((reservation_id IS NULL) <> (block_id IS NULL))
);
CREATE INDEX idx_room_nights_res ON room_nights(reservation_id, night);
CREATE INDEX idx_room_nights_property ON room_nights(property_id, night);

CREATE TABLE reservation_history (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  changes TEXT,
  user_id INTEGER,
  at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_res_history ON reservation_history(reservation_id, id);

CREATE TABLE guest_requests (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  reservation_id INTEGER REFERENCES reservations(id),
  room_id INTEGER REFERENCES rooms(id),
  kind TEXT NOT NULL CHECK (kind IN ('request','complaint','wake_up','transport','luggage','room_service','maintenance')),
  description TEXT NOT NULL,
  due_at TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  assigned_to INTEGER REFERENCES users(id),
  resolution TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  resolved_at TEXT
);
CREATE INDEX idx_guest_requests ON guest_requests(property_id, status);

-- ---------- housekeeping ----------
CREATE TABLE hk_tasks (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  business_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('departure','stayover','deep','turndown','touch_up')),
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','inspected','failed','cancelled')),
  attendant_id INTEGER REFERENCES users(id),
  supervisor_id INTEGER REFERENCES users(id),
  reservation_id INTEGER REFERENCES reservations(id),
  started_at TEXT,
  completed_at TEXT,
  inspected_at TEXT,
  duration_minutes INTEGER,
  notes TEXT,
  exception TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX idx_hk_tasks ON hk_tasks(property_id, business_date, status);
CREATE INDEX idx_hk_tasks_room ON hk_tasks(room_id, business_date);

-- ---------- cashiering, folios, invoices ----------
CREATE TABLE cashier_shifts (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  business_date TEXT NOT NULL,
  opened_at TEXT NOT NULL DEFAULT ${NOW},
  opening_float_minor INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  expected_cash_minor INTEGER,
  counted_cash_minor INTEGER,
  variance_minor INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed'))
);
CREATE UNIQUE INDEX idx_one_open_shift ON cashier_shifts(property_id, user_id) WHERE status = 'open';

CREATE TABLE folios (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  folio_no TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('guest','master','company','house')),
  reservation_id INTEGER REFERENCES reservations(id),
  booking_id INTEGER REFERENCES bookings(id),
  folio_window INTEGER NOT NULL DEFAULT 1,
  guest_id INTEGER REFERENCES guests(id),
  company_id INTEGER REFERENCES companies(id),
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  closed_at TEXT,
  UNIQUE (property_id, folio_no)
);
CREATE INDEX idx_folios_res ON folios(reservation_id);
CREATE INDEX idx_folios_company ON folios(company_id);

-- Charges route to another folio window or account (e.g. room and tax to the company).
CREATE TABLE folio_routes (
  id INTEGER PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  department TEXT NOT NULL,
  target_folio_id INTEGER NOT NULL REFERENCES folios(id),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (reservation_id, department)
);

-- Append-only folio ledger. amount_minor is signed from the folio's point of view:
-- positive increases what is owed (charges), negative reduces it (payments, reversals,
-- allowances). debit/credit are the same amount split by sign, stored for reporting.
CREATE TABLE folio_postings (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  folio_id INTEGER NOT NULL REFERENCES folios(id),
  posting_no TEXT NOT NULL,
  business_date TEXT NOT NULL,
  posted_at TEXT NOT NULL DEFAULT ${NOW},
  kind TEXT NOT NULL CHECK (kind IN ('charge','payment','refund','allowance','reversal','transfer_out','transfer_in')),
  charge_code TEXT,
  department TEXT,
  category TEXT,
  account_code TEXT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_minor INTEGER,
  net_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  amount_minor INTEGER NOT NULL,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  taxes TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL,
  orig_currency TEXT,
  orig_amount_minor INTEGER,
  fx_rate_micros INTEGER,
  payment_method TEXT,
  payment_ref TEXT,
  card_last4 TEXT,
  cashier_shift_id INTEGER REFERENCES cashier_shifts(id),
  reservation_id INTEGER REFERENCES reservations(id),
  guest_id INTEGER REFERENCES guests(id),
  user_id INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  dedupe_key TEXT,
  reverses_id INTEGER REFERENCES folio_postings(id),
  reversed INTEGER NOT NULL DEFAULT 0,
  transfer_pair_id INTEGER,
  invoice_id INTEGER,
  note TEXT,
  CHECK (amount_minor = debit_minor - credit_minor),
  CHECK (card_last4 IS NULL OR length(card_last4) = 4),
  UNIQUE (property_id, posting_no)
);
CREATE UNIQUE INDEX idx_postings_dedupe ON folio_postings(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_postings_folio ON folio_postings(folio_id, id);
CREATE INDEX idx_postings_date ON folio_postings(property_id, business_date, department);
CREATE INDEX idx_postings_res ON folio_postings(reservation_id);
CREATE INDEX idx_postings_invoice ON folio_postings(invoice_id);
-- Only these columns may change, each exactly once: reversed (0 -> 1), invoice_id and
-- transfer_pair_id (NULL -> value). Everything else is immutable. A posting's journal entry is
-- journal_entries.source_id (source 'folio.*').
CREATE TRIGGER folio_postings_immutable BEFORE UPDATE ON folio_postings
WHEN NEW.amount_minor IS NOT OLD.amount_minor OR NEW.net_minor IS NOT OLD.net_minor
  OR NEW.tax_minor IS NOT OLD.tax_minor OR NEW.folio_id IS NOT OLD.folio_id
  OR NEW.business_date IS NOT OLD.business_date OR NEW.kind IS NOT OLD.kind
  OR NEW.department IS NOT OLD.department OR NEW.account_code IS NOT OLD.account_code
  OR NEW.description IS NOT OLD.description OR NEW.debit_minor IS NOT OLD.debit_minor
  OR NEW.credit_minor IS NOT OLD.credit_minor OR NEW.taxes IS NOT OLD.taxes
  OR NEW.posting_no IS NOT OLD.posting_no OR NEW.currency IS NOT OLD.currency
  OR NEW.reverses_id IS NOT OLD.reverses_id OR NEW.dedupe_key IS NOT OLD.dedupe_key
  OR (OLD.reversed = 1 AND NEW.reversed = 0)
  OR (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS NOT OLD.invoice_id)
  OR (OLD.transfer_pair_id IS NOT NULL AND NEW.transfer_pair_id IS NOT OLD.transfer_pair_id)
BEGIN SELECT RAISE(ABORT, 'folio postings are immutable; post a reversal or adjustment'); END;
CREATE TRIGGER folio_postings_no_delete BEFORE DELETE ON folio_postings
BEGIN SELECT RAISE(ABORT, 'folio postings cannot be deleted'); END;

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  folio_id INTEGER NOT NULL REFERENCES folios(id),
  kind TEXT NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice','credit_note')),
  invoice_no TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  original_invoice_id INTEGER REFERENCES invoices(id),
  bill_to_name TEXT NOT NULL,
  bill_to_address TEXT,
  bill_to_tax_id TEXT,
  place_of_supply TEXT,
  currency TEXT NOT NULL,
  net_minor INTEGER NOT NULL,
  tax_minor INTEGER NOT NULL,
  gross_minor INTEGER NOT NULL,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  tax_breakdown TEXT NOT NULL DEFAULT '[]',
  lines TEXT NOT NULL DEFAULT '[]',
  issued_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (property_id, invoice_no)
);
CREATE TRIGGER invoices_immutable BEFORE UPDATE ON invoices
BEGIN SELECT RAISE(ABORT, 'invoices are immutable; issue a credit note'); END;
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON invoices
BEGIN SELECT RAISE(ABORT, 'invoices cannot be deleted'); END;

-- ---------- general ledger ----------
CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  entry_no TEXT NOT NULL,
  business_date TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id INTEGER,
  description TEXT NOT NULL,
  currency TEXT NOT NULL,
  reverses_entry_id INTEGER REFERENCES journal_entries(id),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (property_id, entry_no)
);
CREATE INDEX idx_journal_date ON journal_entries(property_id, business_date);
CREATE INDEX idx_journal_source ON journal_entries(source_id, source);
CREATE TABLE journal_lines (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
  account_code TEXT NOT NULL,
  department TEXT,
  cost_centre_id INTEGER,
  folio_id INTEGER,
  company_id INTEGER,
  debit_minor INTEGER NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor INTEGER NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  memo TEXT,
  CHECK (debit_minor = 0 OR credit_minor = 0)
);
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_code);
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal entries are immutable; post a reversing entry'); END;
CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal entries cannot be deleted'); END;
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal lines are immutable'); END;
CREATE TRIGGER journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal lines cannot be deleted'); END;

-- ---------- night audit ----------
CREATE TABLE night_audits (
  id INTEGER PRIMARY KEY,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  business_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  run_by INTEGER,
  summary TEXT,
  error TEXT
);
CREATE UNIQUE INDEX idx_night_audit_done ON night_audits(property_id, business_date) WHERE status = 'completed';
`,
};
