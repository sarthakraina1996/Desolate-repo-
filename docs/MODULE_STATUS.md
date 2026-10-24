# BrainADZ Hospitality OS — Module Status

Last updated: 2026-10-24 (end of WP1). A module is **Completed and tested** only when its
principal workflows pass as automated tests; the evidence column names them. The in-app module
registry (`hospitality/server/modules/system/modules.js`, shown on the Planned pages and in
Settings → System status) mirrors this file.

Test suites (`npm run hos:test`, 54 tests; `npm run hos:e2e`, 6 browser journeys):
`unit` (U), `reservations` (RS), `workflows` (WF), `finance` (FN), `metrics` (MT), `security`
(SC), `smoke` (SM), `e2e` (E2E).

## Classification

| Module | Status | Evidence | Outstanding |
|---|---|---|---|
| Platform: sign-in, sessions, TOTP MFA, CSRF, security headers | Completed and tested | SC "unauthenticated requests…", "session cookie…", "state-changing requests without the CSRF header…", "two-step sign-in…"; U "TOTP matches the RFC 6238…" | Password reset by e-mail; SSO (SAML/OIDC); rate limiting on sign-in |
| Platform: RBAC, property scoping, tenant isolation, financial redaction | Completed and tested | SC "roles only reach…", "users only see the properties…", "organisations are isolated…", "financial figures are hidden…" | Custom roles; approval delegation |
| Platform: audit trail, idempotency, transactional outbox | Implemented but requiring improvements | SC "a retried payment with the same Idempotency-Key posts once"; RS "booking creation is idempotent…"; FN append-only audit log | Outbox is written and visible but there is no HQ transport yet (Phase 7) |
| Property, buildings, floors, room types, rooms, amenities | Implemented but requiring improvements | SM (all master endpoints); RS "out-of-order rooms are not sellable"; MT OOO policy | No dedicated tests for attribute inheritance and amenity overrides; bulk room import |
| Rate plans, derived plans, daily rates, restrictions, rate grid | Implemented but requiring improvements | RS "stays are priced from the rate plan…", "restrictions block sales…" | Seasons as named periods, occupancy-based pricing, rate-grid bulk edit e2e |
| Reservation engine (single, multi-room, quotes, modify, cancel, no-show) | Completed and tested | RS (10 tests: double booking, concurrent assignment, sold out/overbooking, OOO, restrictions, pricing, stale version, repricing, idempotency/channel ref, cancellation); U state machine | Group blocks with pick-up; waitlist |
| Booking calendar | Implemented but requiring improvements | SM `/calendar`; E2E "modules open from the top navigation"; server moves share the tested `modifyReservation` path | Drag-and-drop move has no browser test yet |
| Front desk (boards, check-in/out, settlement, company billing) | Completed and tested | WF-A, WF "check-in refuses…", "check-out: a credit must be refunded…", "company billing…"; E2E "front desk checks a guest in…" (desktop + tablet) | Walk-in, room move and cashier-shift close have no dedicated tests; key-card encoder integration |
| Housekeeping | Partially implemented | WF-C (inspection policy, supervisor-only inspection) | Task scheduling/productivity untested; linen, minibar, lost & found, supplies not started |
| Guests and companies, privacy | Implemented but requiring improvements | SC "identity documents… masked…", "erasure anonymises the profile…"; export/erasure restricted to `guests.privacy` | Duplicate-profile merge; consent history; retention schedules |
| Folios, routing, transfers, invoices, tax | Implemented but requiring improvements | WF-A; FN "postings, invoices and journals cannot be edited…", "a wrong charge is corrected by a reversal…", "allowances…", "same posting key never posts twice", "invoice numbers are sequential…"; U tax slabs and rounding | **Credit notes are not implemented**: an invoiced line cannot be corrected yet (the reversal is correctly refused). GST e-invoicing (IRN/QR) and Portuguese certified invoicing (ATCUD/SAF-T) not started |
| General ledger, trial balance, city ledger, reconciliation R1–R6 | Completed and tested (revenue side) | FN "the general ledger only accepts balanced entries…"; WF trial balance + R1–R6 after every workflow; SM "the seeded demo reconciles" | Expense side (AP, OPEX), period close and manual journals UI are Phase 4 |
| Night audit | Completed and tested | FN "night audit is atomic…", "night audit will not close a day…"; WF-A | Scheduled auto-run; audit reports pack |
| Metrics engine (occupancy, ADR, RevPAR, TRevPAR, ALOS, cancellation, no-show, direct share, commission) | Completed and tested | U formulas and weighted consolidation; MT (6 tests: records coverage, provisional day, FX + weighting, OOO policy, drill-down sums, portfolio = sum of properties) | GOP, GOPPAR, CPOR, EBITDA need expenses (Phase 4); MPI/RGI/ARI need licensed comp-set data |
| Executive and role dashboards | Partially implemented | MT "drill-downs sum to the metric, and the dashboard agrees with the KPI API"; E2E dashboard journey; SC redaction | Profit metrics shown as unavailable with the reason; budget vs actual (Phase 4) |
| Reports (manager's report, monthly revenue, registers, CSV) | Partially implemented | SM; MT KPI agreement | Scheduled and custom reports; PDF packs |
| Multi-property / portfolio | Partially implemented | MT FX consolidation and weighting; SC scoping | Central approvals, shared procurement, intercompany (Phase 6) |
| Revenue management (forecast, pricing recommendations) | Not started | — | Phase 5; the rate grid and 14-day house forecast are live |
| Channel manager | Not started (live connections blocked) | — | Live OTA connections need certified provider credentials; an OTA simulator will be built first (Phase 5). No scraping. |
| POS & F&B (outlets, KOT/KDS, recipes, menu engineering) | Not started | — | Phase 3; F&B can already be charged to folios with correct GST |
| Inventory and procurement | Not started | — | Phase 3 |
| Finance: OPEX, CAPEX, AP, budgets, P&L | Not started | — | **Next work package (WP2)** |
| Operations: maintenance, banquets/events, spa | Not started | — | Phase 6 (room OOO blocks and maintenance flags exist) |
| Offline property hub ↔ HQ sync | Partially implemented | Outbox rows per change (SM, status page) | HQ PostgreSQL store, transport, conflict handling (Phase 7) |
| Optional AI assistance | Not started | — | Optional by design (ADR-9); no OpenAI dependency |
| Demo environment (5 properties, 218 rooms, 12 months + 120 days forward) | Completed and tested | SM "the seeded demo reconciles (R1–R6)"; MT portfolio checks; labelled demo throughout | — |
| Responsive web (desktop, tablet) | Implemented but requiring improvements | E2E at 1440×900 and 1024×768 (top navigation, no sidebar, no horizontal scroll) | Phone layouts for housekeeping attendants; native apps not planned yet |

## Known defects and risks

| Item | Impact | Plan |
|---|---|---|
| No credit notes | A wrong charge on an issued invoice cannot be corrected in the system | First item of WP2 |
| Guests are organisation-wide; any property's GM can erase a profile used by another property | Policy question, not a leak (same organisation) | Decide per tenant: restrict erasure to group roles or require the profile's properties |
| `001_foundation` migration still mutable | Fine before first deployment | Freeze at first hub deployment |
| Full 12-month demo seed takes ~3 minutes | The app starts at once and shows seeding progress | Acceptable for demos; tests use a compact profile |
