# BrainADZ Hospitality OS — Test Strategy

No feature is marked complete until its principal workflows and tests pass. Tests run with
Node's built-in runner (`node:test`) like the existing HRMS suite, plus Playwright for browser
journeys.

```bash
npm run hos:test        # unit + API + workflow tests (in-memory or temp-file SQLite)
npm run hos:e2e         # Playwright journeys against a built client (desktop + tablet)
npm test                # existing HRMS suite (unchanged)
```

## 1. Test layers

| Layer | What | Where |
|---|---|---|
| Unit | Pure functions: money rounding, tax slabs and components, period resolution, metric formulas, TOTP, state machine transitions, permission matrix | `tests/unit-*.test.js` |
| Service / integration | Domain services against a real SQLite database: reservations, inventory, room locks, folios, journals, night audit, housekeeping, triggers | `tests/*.test.js` using `makeDb()` |
| API contract | HTTP status codes, response shapes, validation messages, CSRF, auth, idempotency replay | `tests/api-*.test.js` using `boot()` |
| Workflow | WF-A, WF-C (WP1) end to end through HTTP; others added with their modules | `tests/workflows.test.js` |
| Security | RBAC per role, property scoping, tenant isolation, financial visibility, MFA | `tests/security.test.js` |
| Reconciliation | R1–R6 on the seeded demo | `tests/seed.test.js` |
| Browser e2e | Sign-in, dashboard, calendar drag-and-drop, reservation → check-in → folio → checkout, housekeeping inspection; desktop 1440×900 and tablet 1024×768 | `tests/e2e/*.mjs` |
| Performance | Calendar and dashboard timing budgets on the full demo | `tests/perf.test.js` (Phase 7 load tests) |

## 2. Mandatory negative cases

| Case | Expected | WP |
|---|---|---|
| Duplicate reservations (same idempotency key) | Second request replays the first response, one reservation exists | WP1 |
| Overlapping room assignment | 409 with the conflicting reservation; database unique constraint holds | WP1 |
| Concurrent room booking attempts | Exactly one succeeds | WP1 |
| Room-type sold out | 409 unless override permission and allowance | WP1 |
| Stale reservation version | 409 | WP1 |
| Negative inventory | Rejected unless policy allows | WP2/3 |
| Double-posted payments | Same idempotency key → one posting | WP1 |
| Update/delete of a posting | Database trigger aborts | WP1 |
| Unbalanced journal | Rejected before insert | WP1 |
| Incorrect tax calculation | Slab boundaries (₹1,000 / ₹7,500), component split, rounding per line | WP1 |
| Wrong currency conversion | Consolidation uses the dated rate; mixed currencies never summed raw | WP1 |
| Failed OTA update | Recorded as failed, retried, visible in sync history | Phase 5 |
| Missing permissions | 403 for each protected action per role | WP1 |
| Cross-tenant access | 404 | WP1 |
| Interrupted night audit | Rollback; re-run posts each night exactly once | WP1 |
| Sync retries | Outbox attempts and errors recorded; replay idempotent | WP1 (local), Phase 7 (transport) |
| Checkout with open balance | Rejected unless transferred to an authorised city-ledger account | WP1 |
| Check-in to an uninspected room under inspection policy | Rejected with reason | WP1 |

## 3. Test data

- `makeDb()` creates an isolated database with the migrations applied and an optional minimal
  fixture (one organisation, one property, a few rooms) for service tests.
- `boot({ seed: 'test' })` runs the demo simulation with a compact profile (5 properties, ~60
  days of history) for API tests; `seed.test.js` runs the full 12-month profile once and checks
  reconciliation and timing.
- Dates are fixed by passing `today` to the app factory, so tests do not depend on the clock.

## 4. Definition of done (per module)

1. Principal workflow test passes through the API.
2. RBAC and property-scope tests for every new route.
3. Negative cases from §2 that apply to the module pass.
4. UI screen has loading, empty and error states and is covered by an e2e smoke path.
5. `MODULE_STATUS.md` updated with evidence (test names).
