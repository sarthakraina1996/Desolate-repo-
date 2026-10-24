# BrainADZ Hospitality OS — Test Strategy

No feature is marked complete until its principal workflows and tests pass. Tests run with
Node's built-in runner (`node:test`) like the existing HRMS suite, plus Playwright for browser
journeys. Evidence per module is recorded in [`MODULE_STATUS.md`](MODULE_STATUS.md).

```bash
npm run hos:test        # unit, service, API, workflow, security and metrics tests (55)
npm run hos:e2e         # Playwright journeys against the built client, desktop + tablet (6)
npm test                # existing HRMS suite (unchanged)
npm run test:all        # both node:test suites
```

## 1. Test layers

| Layer | What | Where |
|---|---|---|
| Unit | Money rounding and allocation, currency conversion, tax slabs/components/inclusive extraction, period presets and comparisons, KPI formulas incl. weighted consolidation, TOTP (RFC 6238 vector), dates, reservation state machine | `tests/unit.test.js` |
| Service / integration | Domain services against a real SQLite file built by `tests/fixture.js` (one property, 8 rooms, BAR + package plan, one user per role): inventory and room locks, pricing, restrictions, concurrency, folios, journals, night audit | `tests/reservations.test.js`, `tests/finance.test.js`, `tests/metrics.test.js` |
| Workflow | WF-A (book → check-in → charges → night audits → payments → check-out → invoice), WF-C (inspection gate), settlement rules, company billing; every workflow ends with a balanced trial balance and R1–R6 | `tests/workflows.test.js` |
| API contract & security | Over HTTP on a copy of the seeded demo (`boot()` in `tests/helpers.js`): authentication, cookie flags, CSRF, RBAC per role, property scoping, tenant isolation, financial redaction, PII masking, privacy permissions, MFA, Idempotency-Key replay | `tests/security.test.js`, `tests/smoke.test.js` |
| Reconciliation | R1–R6 on the seeded demo | `tests/smoke.test.js` |
| Browser e2e | Sign-in → dashboard first with top navigation (no left sidebar, no horizontal scroll); navigation between modules incl. the overflow menu; front-desk check-in from the arrivals board — at 1440×900 and 1024×768 | `tests/e2e/run.mjs` |
| Performance | Calendar and dashboard timing budgets on the full demo | Planned (Phase 7) |

## 2. Mandatory negative cases

| Case | Expected | Covered by |
|---|---|---|
| Duplicate reservations (same idempotency key) | One booking; the retry returns it | RS "booking creation is idempotent…" |
| Overlapping room assignment | 409 naming the conflicting reservation; the database primary key holds even for raw inserts | RS "a room can never hold two stays…" |
| Concurrent room booking attempts | Exactly one succeeds | RS "two connections assigning the same room…" |
| Room-type sold out | 409 unless override **and** an overbooking allowance | RS "a room type cannot be sold beyond its rooms…" |
| Stale reservation version | 409 `stale_version` | RS "stale edits are rejected…" |
| Negative inventory (stock) | Rejected unless policy allows | Phase 3 (inventory module) |
| Double-posted payments | Same key → one posting and one journal | FN "the same posting key…", SC "a retried payment…" |
| Update/delete of a posting, invoice, journal, audit row | Database trigger aborts | FN "postings, invoices and journals cannot be edited or deleted" |
| Unbalanced journal / unknown account / negative lines | Rejected before insert | FN "the general ledger only accepts balanced entries…" |
| Incorrect tax calculation | Slab boundaries (₹1,000 / ₹7,500), dated rate change (12 % → 5 % on 22 Sep 2025), per-component rounding, inclusive VAT extraction | U "tax: …" |
| Wrong currency conversion | Each night converted at its month's rate before summing; mixed currencies never summed raw | MT "portfolio figures convert each night…" |
| Failed OTA update | Recorded as failed, retried, visible in sync history | Phase 5 |
| Missing permissions | 403 for protected actions per role | SC "roles only reach what their permissions allow" |
| Cross-tenant access | 404 | SC "organisations are isolated from each other" |
| Interrupted night audit | Full rollback (date, postings, no-shows); failed run recorded; re-run posts each night once | FN "night audit is atomic…" |
| Sync retries | Outbox attempts and errors recorded; replay idempotent | Local outbox only; transport in Phase 7 |
| Checkout with open balance or credit | Rejected unless settled, refunded or transferred to an authorised company | WF-A, WF "check-out: a credit…", WF "company billing…" |
| Check-in to an uninspected room under inspection policy | Rejected with reason; only a supervisor can inspect | WF-C |
| Days before records begin | "No data" (null), never zero | MT "days before records begin…" |

## 3. Test data

- `tests/fixture.js` builds an isolated database per test with the migrations applied and a
  small, fully known hotel; services are called directly with role actors. Dates are fixed
  (business date 2026-10-24).
- `tests/helpers.js` `boot()` starts the HTTP app on a random port with a copy of the seeded
  demo. The demo template (compact `test` profile: 5 properties, ~2 months of history) is built
  once per server-source hash and cached in the OS temp directory, so suites start in seconds.
- `today` is passed to the seed, so tests never depend on the wall clock.

## 4. Definition of done (per module)

1. Principal workflow test passes.
2. RBAC and property-scope tests for every new route.
3. Negative cases from §2 that apply to the module pass.
4. UI screen has loading, empty and error states and is covered by an e2e path.
5. `MODULE_STATUS.md` updated with evidence (test names).
