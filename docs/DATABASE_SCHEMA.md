# BrainADZ Hospitality OS — Database Schema

Source of truth: [`hospitality/server/db/migrations/001_foundation.js`](../hospitality/server/db/migrations/001_foundation.js).
This document explains the design; the migration is authoritative for column details.

The property hub runs SQLite (`node:sqlite`, WAL, foreign keys on). The same logical schema is
intended for the HQ PostgreSQL store (ARCHITECTURE.md, ADR-2); nothing here relies on
SQLite-only behaviour except the trigger syntax and `RAISE(ABORT, …)`.

## Conventions

| Convention | Rule |
|---|---|
| Keys | `id INTEGER PRIMARY KEY` locally; replicated entities also carry `uid` (UUIDv7, filled automatically on insert) so HQ can merge rows from many hubs without key collisions. |
| Money | Integer minor units (`*_minor`, e.g. paise, cents) plus an ISO 4217 `currency` column on the row or its property. Rates are basis points (`*_bp`); FX rates are `rate_micros` (rate × 10⁶). No floating-point money anywhere. |
| Dates | Business dates are `TEXT 'YYYY-MM-DD'` in the property's local calendar. Instants are ISO-8601 UTC strings. A property's business date moves only through the night audit. |
| Tenancy | Every business row reaches an `organizations` row through `org_id` or `property_id`. Services filter by the signed-in user's organisation and granted properties; cross-tenant reads return 404. |
| Immutability | Financial facts are append-only and protected by triggers (below). Corrections are new rows. |
| Optimistic concurrency | `reservations.version` and `rooms.version` increment on each change; stale writes are rejected with 409. |

## Entity groups

### Organisation, legal entities, properties

| Table | Purpose |
|---|---|
| `organizations` | Tenant. Reporting currency, financial-year start month, demo flag, MFA policy for privileged roles. |
| `legal_entities` | Company that invoices (name, tax ID such as GSTIN/NIF, base currency). Many properties can share one. |
| `properties` | Hotel. Currency, time zone, tax regime and whether prices include tax, check-in/out times, **`business_date`** (open day), **`records_from`** (first date the system holds records for; metrics treat earlier days as "no data"), operating policies (`inspection_required`, `require_id_at_checkin`, `overbooking_pct`, `exclude_ooo_from_available`), invoice prefix. |
| `departments`, `cost_centres` | USALI-style departments (operated / undistributed / non-operating) and per-property cost centres. |
| `bank_accounts`, `payment_methods` | Payment methods map to GL clearing accounts (cash 1010, card 1020, UPI 1030, bank 1040, city ledger 1220). Bank account numbers are stored masked. |
| `fx_rates` | Dated rates by currency pair (`rate_micros`). Consolidation uses the rate on or before each month end. |

### Identity and security

| Table | Purpose |
|---|---|
| `users`, `user_properties` | One role per user (`core/permissions.js` matrix); either `all_properties` or explicit property grants. Passwords are scrypt hashes; `mfa_secret` is the TOTP secret. |
| `sessions`, `mfa_challenges` | Only SHA-256 hashes of session and challenge tokens are stored. |
| `audit_log` | Who did what, before/after, when. **Cannot be updated or deleted** (triggers). |
| `idempotency_keys` | Stored responses for `Idempotency-Key` replays, per user. |
| `sync_outbox` | Transactional outbox: each committed change is queued for HQ replication with attempts and last error. |
| `sequences` | Gap-free per-property counters (confirmation, folio, posting, invoice per financial year, journal). Incremented with a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`. |

### Rooms and inventory

| Table | Purpose |
|---|---|
| `buildings`, `floors` | Physical layout. |
| `room_types`, `room_type_amenities` | Defaults inherited by rooms (occupancy, bed, size, view, amenities). |
| `rooms` | Individual rooms. Nullable attribute columns override the type's value only when set (effective values are resolved by `effectiveRoom`). Live state: `hk_status` (dirty / cleaning / clean / inspected), `dnd`, `maintenance_flag`; service dates `commissioned_on` / `decommissioned_on`. |
| `room_amenity_overrides` | Per-room add/remove of an amenity with the reason and approver. |
| `room_images`, `room_assets`, `room_status_log` | Photos, installed assets with warranty, every status change with who and why. |
| `room_blocks` | Out-of-order (`ooo`, removed from sale) and out-of-service (`oos`) periods. |
| **`room_nights`** | **The physical lock.** `PRIMARY KEY (room_id, night)`; each row is held by exactly one reservation **or** one block (`CHECK`). Two stays can never hold the same room on the same night, whatever the application does, including concurrent writers. |

### Rates

| Table | Purpose |
|---|---|
| `cancellation_policies` | Free-cancellation window, penalty kind and size, no-show rule, non-refundable flag. A snapshot is copied onto each reservation. |
| `rate_plans`, `rate_plan_room_types` | Plans with base/weekend prices per room type, or derived from a parent (amount or percent). Package F&B component (`fnb_component_minor`) is split out at posting. |
| `daily_rates` | Explicit price overrides per plan, room type and night. |
| `restrictions` | Min/max LOS, closed to arrival/departure, stop-sell per night; `0` in `room_type_id` / `rate_plan_id` means "all". |
| `tax_rules` | Effective-dated rules per category, optionally slab-based by per-night value (India GST rooms), with components (CGST/SGST/IGST, VAT) and their GL accounts. Demonstration values are labelled "verify". |

### Guests, companies, reservations

| Table | Purpose |
|---|---|
| `guests` | Profile, preferences, consent. Identity documents are stored as type + **masked** number only (`id_number_masked`); the full number is never persisted. Erasure anonymises the row (`anonymized_at`) and keeps financial history. |
| `companies` | Corporates, travel agents, OTAs and government accounts; city-ledger (AR) flag, credit limit and days, commission. |
| `bookings` | A booking groups one or more reservations; holds the booker, source/channel, a unique `channel_ref` per channel and a unique `idempotency_key` per creator. |
| `reservations` | One room stay: dates, occupancy, status (`quote → confirmed → in_house → checked_out → closed`, or `cancelled` / `no_show`), rate plan, guarantee, commission, policy snapshot, `version`. |
| `reservation_nights` | Price and room type per night (the revenue basis). |
| `reservation_history` | Every change to a reservation with the user and the diff. |
| `guest_requests` | Requests, complaints, wake-up calls etc. with status and resolution. |

### Housekeeping and cashiering

| Table | Purpose |
|---|---|
| `hk_tasks` | Departure / stayover / deep / turndown tasks per business date with attendant, timings, inspection and exceptions. |
| `cashier_shifts` | One open shift per user and property; expected vs counted cash and variance at close. |

### Folios, invoices and the general ledger

| Table | Purpose |
|---|---|
| `folios`, `folio_routes` | Guest (with numbered windows), master, company (city ledger) and house folios; routing rules send a department's charges to another folio. |
| **`folio_postings`** | Every charge, payment, refund, allowance, reversal and transfer. Signed `amount_minor`, net and tax split, tax components (`taxes` JSON), payment method and **card last four only**, `dedupe_key` (unique; makes retries and night-audit re-runs post once), `reverses_id`. |
| **`invoices`** | Issued tax invoices (number unique per property, per financial year sequence), bill-to, place of supply, tax breakdown and lines. `kind` reserves `credit_note` (not yet issued by the application — see MODULE_STATUS). |
| **`journal_entries`, `journal_lines`** | Double-entry ledger; every posting writes a balanced entry (`source = 'folio.<kind>'`, `source_id = posting id`). Balanced and on known postable accounts, or rejected before insert. |
| `accounts` | Chart of accounts per organisation (USALI-aligned codes, e.g. 1210 guest ledger, 1220 city ledger, 2310/2311 CGST/SGST, 4010 room revenue, 4110 food). |
| `night_audits` | One completed audit per property and business date (unique); failed attempts are recorded with the error. |

## Integrity enforced by the database

| Rule | Mechanism |
|---|---|
| No double booking of a room-night | `room_nights` primary key (room, night) |
| A lock belongs to a stay or a block, never both | `CHECK` on `room_nights` |
| One reservation per client retry | Partial unique index on `bookings(created_by, idempotency_key)` |
| One booking per OTA reference | Partial unique index on `bookings(property_id, channel, channel_ref)` |
| A posting is written once | Unique `folio_postings.dedupe_key` |
| Postings are append-only | `folio_postings_immutable` allows only `reversed` 0→1 and setting `invoice_id` / `transfer_pair_id` once; `folio_postings_no_delete` |
| Invoices, journal entries and lines are append-only | `*_immutable` and `*_no_delete` triggers |
| Audit trail is append-only | `audit_log_no_update`, `audit_log_no_delete` |
| One completed night audit per day | Unique index on `night_audits(property_id, business_date)` for completed runs |
| One open cashier shift per user | Partial unique index |
| Invoice numbers are unique | `UNIQUE (property_id, invoice_no)` |

All of these are exercised by `hospitality/tests/reservations.test.js` and
`hospitality/tests/finance.test.js`.

## Reconciliation (R1–R6)

`server/modules/finance/reconciliation.js` proves the subledgers and the ledger agree: folio
revenue = GL revenue (R1), open guest folios = guest ledger 1210 (R2), sold nights on closed days
= room charges posted (R3), every journal balances and the trial balance nets to zero (R4),
invoices match their postings (R5), company folios = city ledger 1220 (R6). The seeded demo and
every workflow test reconcile.

## Migrations

Migrations are numbered modules applied in order inside a transaction and recorded in
`schema_migrations`. `001_foundation` is unreleased and may still change; once a hub is deployed,
changes go into new migrations only.
