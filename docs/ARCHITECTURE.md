# BrainADZ Hospitality OS — Architecture

Status: Phase 0 baseline, updated with Work Package 1 (WP1). Decisions marked **ADR-n** are the
architecture decisions of record; change them only with a new ADR entry at the end.

## 1. Repository audit (Phase 0)

### 1.1 What the repository contained

The repository held one complete, working product: **BrainADZ HRMS** (people operations for
BrainADZ Live, Marketing and Exhibits). It contained **no hospitality code**: no property,
room, reservation, folio, POS, inventory, channel, revenue or finance modules, and no offline
Master Hub or central synchronisation.

| Area | Finding |
|---|---|
| Frontend | React 19 + Vite 6, react-router 7, lucide-react icons, hand-drawn SVG charts, single CSS file with tokens, PWA shell (manifest + service worker) |
| Backend | Node 22 ESM, Express 5, one route file per module, `services/` and pure `lib/` rules |
| Database | SQLite through Node's built-in `node:sqlite` (no native build); schema applied with `CREATE IF NOT EXISTS` plus a small column-migration list |
| Auth | scrypt password hashes, hashed session tokens in HTTP-only cookies, login throttling, CSRF custom-header guard, strict CSP, roles admin/hr/manager/employee, WebAuthn passkeys, device cookies, geofenced sign-in |
| Tests | `node:test` unit and API tests (55 pass, 1 skipped at audit time) |
| Deploy | Dockerfile, Render blueprint with persistent disk, office-LAN launch scripts, single-file in-browser demo build |
| Data quality | Dashboards are computed from the database (no hard-coded figures found); demo data is seeded and labelled |

Gaps against this specification: every hospitality module is **Not started** (see
[`MODULE_STATUS.md`](MODULE_STATUS.md)). The HRMS uses a permanent left sidebar, which the
hospitality product must not use.

### 1.2 What is preserved and reused

- The HRMS stays as it is, untouched, at the repository root (`server/`, `client/`, `tests/`).
- The hospitality product lives in `hospitality/` and **reuses the HRMS stack and conventions**:
  Express 5, `node:sqlite`, React 19, Vite, `node:test`, the scrypt/session/CSRF/CSP security
  model, the transaction helper pattern, CSV export with formula-injection protection, and the
  PWA approach.
- The HRMS payroll engine (Indian statutory payroll) is the intended source for the Workforce and
  Payroll Integration module (labour cost allocation), integrated through an API rather than by
  merging databases.
- Brand: the BrainADZ wordmark is extracted as vector paths from the supplied BrainADZ Live
  booklet (`hospitality/client/public/brand/`); the "Br" monogram is the trace already used by
  the HRMS.

## 2. Architecture decisions

**ADR-1 Preserve the existing stack.** The repository's stack (Node 22 ESM, Express 5,
`node:sqlite`, React 19, Vite) is viable and already deployed. The hospitality product adopts
it rather than introducing NestJS/Next.js. Code is plain ESM JavaScript with JSDoc, matching the
repository; a `tsc --checkJs` gate can be added without rewriting files.

**ADR-2 SQLite at the property, PostgreSQL at HQ.** The property **Master Hub** must run with no
internet and no database administrator, so it uses embedded SQLite (WAL mode, synchronous
transactions, single writer — which also serialises inventory decisions). The **central HQ**
service will run PostgreSQL. SQL is written to be portable (no SQLite-only functions in domain
logic beyond date helpers isolated in `core/`); integrity rules that SQLite enforces with
`UNIQUE` constraints and triggers map to PostgreSQL unique/exclusion constraints and triggers.
The PostgreSQL dialect of the migrations is Phase 7 work and is tracked as Not started.

**ADR-3 Money is integer minor units.** Every amount is stored as an integer in the currency's
minor unit (paise, cents) with an ISO 4217 currency code. Rounding happens once, at posting
time, with banker's-safe half-up rounding per line. Floating point never touches stored money.

**ADR-4 Physical rooms are locked per night.** A `room_nights` row claims one room for one night;
`UNIQUE(room_id, night)` makes overlapping assignments impossible at the database level, whatever
the application does. Reservations, splits, moves and maintenance blocks all claim nights in the
same table. Room-type inventory (unassigned bookings) is validated per night inside the same
transaction.

**ADR-5 Financial rows are append-only.** Folio postings, journal lines, invoices and the audit log
are protected by database triggers that reject `UPDATE` of amounts and any `DELETE`. Corrections
are reversals, adjustments and credit notes. Every folio posting generates a balanced journal
entry in the general ledger in the same transaction.

**ADR-6 Offline-first primitives from day one.** Every syncable row carries a globally unique `uid`
in addition to its local integer id; every state-changing domain operation writes an event to a
transactional **outbox** (`sync_outbox`) in the same transaction; state-changing APIs accept an
`Idempotency-Key` header and replay the stored response for duplicates. The transport to HQ is a
later phase, but no data written today needs re-keying to sync.

**ADR-7 Property business date.** Each property has its own business date, advanced only by the
night audit. Revenue is reported by business date. Dashboards report closed days as actuals and
the open business day as provisional.

**ADR-8 Metrics come from one engine.** All KPIs are computed by `server/modules/metrics` from base
measures (sums and counts). Ratios are computed after aggregation; consolidation converts to the
reporting currency first, then sums, then divides.

**ADR-9 No mandatory external AI.** Core PMS functions use no AI service. Forecasting starts as a
transparent rules engine; any assistant is an optional, replaceable adapter that can point at a
self-hosted model.

**ADR-10 Integrations are adapters with honest state.** Channel, payment and accounting
connectors implement an adapter interface. Without credentials and certification, the adapter is
the simulator, and the UI labels it "Simulator".

## 3. System topology

```
 Property devices (browsers, tablets, POS terminals, KDS, printers)
        │  HTTPS / LAN
        ▼
 Property Master Hub  ── Node + Express + SQLite (this codebase)
   • full PMS for its properties; works with no internet
   • sync_outbox (durable event queue), idempotency store
        │  outbound sync when online (Phase 7)
        ▼
 Central HQ server   ── same domain services, PostgreSQL, Redis queue, object storage
   • consolidation, group reporting, central approvals, channel distribution
        │
        ▼
 External services   ── channel managers/OTAs, payment gateways, e-invoicing, email/SMS
```

A single deployment can also run in **central mode** (one server for many properties, the
current default) — the same code with all properties in one database.

## 4. Codebase layout (`hospitality/`)

```
hospitality/
  server/
    index.js                 entry point (env → createApp → listen)
    app.js                   Express app factory: security headers, sessions, CSRF, routes
    db/connection.js         node:sqlite wrapper: tx(), insert(), uid auto-fill, statement cache
    db/migrations/           ordered, versioned migrations (schema_migrations table)
    core/                    errors, validation, money, dates, references, audit, outbox,
                             idempotency, permissions, access (property scoping)
    modules/<domain>/        service.js (domain logic, no HTTP) + routes.js (HTTP mapping)
      auth  properties  rooms  rates  guests  reservations  calendar  frontdesk
      housekeeping  folios  finance  nightaudit  metrics  dashboard  system
    seed/                    deterministic demo portfolio simulation
  client/
    src/styles/              design tokens and component styles
    src/components/          top navigation, UI kit, data table, charts
    src/pages/               one file per module screen
  tests/                     node:test unit, API and workflow tests; e2e/ Playwright journeys
```

Rules:
- Routes validate input, check permissions and property scope, call one service function, and
  map the result. Business rules live in services; services take `(db, actor, input)` and never
  touch `req`/`res`, so the seed, night audit, sync replay and tests use the same code paths.
- Every write that changes business state runs inside `db.tx()` and writes its audit record and
  outbox event inside that transaction.

## 5. Security model

| Control | Implementation |
|---|---|
| Authentication | Email + password (scrypt), session token hashed (SHA-256) in `sessions`, HTTP-only `SameSite=Lax` cookie, `Secure` behind HTTPS |
| MFA | TOTP (RFC 6238) enrolment and verification; organisation policy can require it for privileged roles (owner, CEO, CFO, finance, admin) |
| Brute force | Per-email login throttling |
| CSRF | State-changing requests must carry `X-Requested-With: bhos` (not sendable cross-site without CORS) |
| Headers | CSP `default-src 'self'`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |
| Authorisation | Role → permission matrix (`core/permissions.js`); every route declares its permission |
| Property scoping | Users see all properties of their organisation only when the role is group-level and `all_properties` is set; otherwise only granted properties. Every query is filtered by allowed property ids |
| Tenant isolation | Users, guests, companies and properties belong to an organisation; cross-organisation ids return 404 |
| Financial visibility | `dashboard.financial` / `finance.view` gate monetary figures; operational users see counts and status only |
| PII | Identity documents stored as type + masked number only; full guest contact data requires `guests.pii`; data-subject export and erasure require `guests.privacy` (general and front-office managers, not front-desk agents); erasure anonymises profiles while keeping financial records |
| Payments | Only provider tokens, last four digits and authorisation references are stored; no PAN/CVV |
| Audit | Append-only `audit_log` with actor, action, entity, before/after snapshot |

## 6. Data integrity

- **Double booking** is prevented by `UNIQUE(room_id, night)` on `room_nights` (ADR-4); tests run
  concurrent assignment attempts and assert exactly one succeeds.
- **Room-type inventory**: for each night, confirmed + in-house reservations of a type ≤ active
  rooms of that type − out-of-order rooms + overbooking allowance; checked inside the write
  transaction (SQLite's single writer makes the check-then-insert atomic; PostgreSQL will use
  `SERIALIZABLE` or a per-property advisory lock).
- **Optimistic concurrency**: reservations carry `version`; modifications with a stale version are
  rejected with 409 so two agents cannot silently overwrite each other.
- **Financial immutability**: triggers (ADR-5); every journal is validated balanced before insert;
  a reconciliation endpoint compares the guest-ledger subledger with the GL control account.
- **Idempotency**: `idempotency_keys` stores `(actor, key) → response`; replays return the same
  result without re-executing. Night audit room charges carry a dedupe key
  `room:<reservation>:<date>` with a `UNIQUE` index.

## 7. Offline-first Master Hub

| Concern | Design |
|---|---|
| Local operation | The hub is a complete PMS; browsers on the LAN talk only to the hub |
| Event queue | `sync_outbox` rows (uid, entity, op, payload, status, attempts, last_error) written in the same transaction as the change |
| Identity | `uid` (UUID) on every syncable row; HQ upserts by uid |
| Replay safety | Outbox events carry the originating idempotency key; HQ applies each event uid once |
| Inventory safety offline | Hub owns its property's physical inventory; OTA allotment while offline is assumed unpublished — channel ARI is re-pushed in full on reconnect |
| Conflicts | Reservation conflicts resolved by owner-of-record (the hub for in-house operations; HQ/channel for new OTA bookings). Financial postings never conflict: they are append-only and merged by uid |
| Split brain | Only one hub per property may be primary; a hub lease (HQ-issued, time-bound) is required to accept OTA inventory; a second hub without the lease runs read-only |
| Reconciliation | After sync: guest-ledger and GL totals by business date compared hub vs HQ; differences raise exceptions |
| Indicators | The client shows online/offline state (browser) and the hub's sync state (pending outbox events, last successful sync) |
| Backup / DR | WAL-mode SQLite backed up with the online backup API on a schedule; restore = copy file + replay outbox from HQ acknowledgements; documented runbook in Phase 7 |

WP1 delivers the uid, outbox, idempotency and indicator primitives; the HQ transport, lease and
reconciliation jobs are Phase 7 (see roadmap).

## 8. Localisation, tax and currency

- Property: timezone, currency, locale, financial-year start month, tax regime.
- Tax rules are effective-dated rows per property and charge category, with optional
  per-night value slabs (India GST on accommodation) and named components (CGST/SGST, VAT).
- Demo rules are labelled demonstration values; they must be verified before production.
- Reporting currency per organisation; consolidation uses `fx_rates` (date, from, to, rate) and
  records the rate used.

## 9. Observability and operations

- Structured request logging (method, path, status, duration) to stdout; errors logged with stack.
- `/api/system/health` (liveness, database, migrations) and `/api/system/status` (business dates,
  outbox depth, module status).
- Deployment: same patterns as the HRMS (Docker, Render with persistent disk, office LAN).

## 10. ADR log

| ADR | Date | Decision |
|---|---|---|
| 1–10 | 2026-10-24 | Initial architecture (this document) |
