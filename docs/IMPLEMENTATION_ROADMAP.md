# BrainADZ Hospitality OS — Implementation Roadmap

Work is delivered in work packages (WP). A WP is done only when its acceptance criteria pass as
automated tests and the module status is updated in [`MODULE_STATUS.md`](MODULE_STATUS.md).
The development log at the end records each cycle.

## Phase 0 — Repository audit and architecture ✅
- Audit of the existing repository (BrainADZ HRMS; no hospitality code).
- Requirements, architecture (ADR-1…10), schema, metrics, test strategy, module status.

## Phase 1 — Operational foundation (WP1)
Scope: authentication, RBAC, property scoping, audit; property/building/floor/room-type/room
masters; amenities with inheritance and exceptions; room blocks; rate plans, rate grid and
restrictions; guests and companies; reservation engine; booking calendar; front desk.

Acceptance criteria
1. Sign in with password; TOTP MFA enrolment/verification; privileged-role MFA policy.
2. A user only sees properties they are granted and never another organisation's records.
3. Rooms show effective attributes with the source (type or room) of each value.
4. Creating overlapping assignments for one room fails, including under concurrent requests.
5. Reservation lifecycle transitions are enforced; every change is in the history and audit log.
6. Calendar returns rooms × nights with segments, blocks, unassigned bookings, availability and
   occupancy; a drag to an occupied room is rejected with the conflicting booking.
7. Arrivals/in-house/departures boards; check-in respects room readiness and ID policy.

## Phase 2 — Guest operations (WP1 continued)
Scope: housekeeping status and tasks with inspection policy; folios (postings, taxes, payments,
transfers, routing, reversals, invoices); general-ledger posting per folio transaction; night
audit; checkout settlement; city ledger transfer.

Acceptance criteria
1. WF-A passes end to end through the API.
2. WF-C passes end to end; inspection policy blocks check-in until inspected.
3. Folio postings cannot be updated or deleted (database rejects it); corrections are reversals.
4. Every posting creates a balanced journal; R1, R2, R4, R5 reconciliation checks pass.
5. Night audit posts each in-house night once, even if re-run after an interruption.

## Phase 2b — Metrics engine and executive dashboard (WP1 continued)
Scope: metrics registry, formulas, periods/comparisons, consolidation with FX, drill-down,
executive and role dashboards for the measures that have live sources; demo portfolio
simulation (5 properties, 200+ rooms, 12 months history + forward bookings).

Acceptance criteria
1. All ✅ formulas in `FINANCIAL_METRICS.md` have unit tests.
2. Consolidated ratios are weighted (tested).
3. Dashboard figures equal the sum of their drill-down rows (tested).
4. Seeded demo reconciles (R1–R6) and is labelled demo.

## Phase 3 — Restaurant and inventory (WP2)
POS (outlets, tables, orders, modifiers, KOT/KDS, bills, splits, payments, room posting, day
close), recipe master and costing, item/UoM/vendor masters, requisitions → PO → GRN → invoice
match, stock ledger, transfers, counts, waste, menu engineering, outlet P&L. Acceptance: WF-D,
WF-E; inventory never negative unless policy allows; purchases and consumption post COGS once.

## Phase 4 — Financial intelligence (WP3)
USALI chart of accounts completion, manual journals with approval, AP, AR ageing, cash/bank and
reconciliation, cost centres, OPEX capture with attachments and approvals, CAPEX projects and
asset register, depreciation, budgets/forecasts, property P&L, consolidated P&L with FX,
period close, room-level profitability with measured vs allocated costs. Acceptance: WF-F;
GOP/EBITDA/EBIT/net profit from the GL; budget variance; room profitability dashboard.

## Phase 5 — Distribution and revenue (WP4)
Channel adapter interface, simulator with test accounts and failure scenarios, mapping, ARI push,
reservation/modification/cancellation import with idempotency, sync history and retries, direct
booking engine, pickup/pace/forecast, rules-based pricing with candidate price evaluation,
approval/rollback/explanations. Acceptance: WF-B, WF-G.

## Phase 6 — Enterprise expansion (WP5)
Banquets and events, maintenance/engineering, CRM and loyalty, spa, workforce integration with
BrainADZ HRMS, corporate sales, central kitchen, custom BI and scheduled reports, multi-property
central approvals and intercompany accounting.

## Phase 7 — Production hardening (WP6)
PostgreSQL dialect for HQ, Master Hub ↔ HQ sync transport, hub lease (split-brain prevention),
post-sync reconciliation, backup/restore automation and DR runbook, load tests (500 rooms × 365
days), permissions audit, security review, regulatory configuration review (GST e-invoicing, EU
VAT, GDPR/DPDP workflows), deployment automation, observability. Acceptance: WF-H, restore drill.

## Next work package after WP1

**WP2 — Finance foundation for GOP (Phase 4 slice) before POS.** Rationale: the owner's core
question (profit by department and property) is blocked on expenses, not on POS. Deliver OPEX
capture (vendor, invoice, cost centre, approval, payment), AP, budgets, the departmental P&L and
GOP/GOPPAR/CPOR on the dashboard, with room-level cost allocation using transparent drivers.

Acceptance criteria: an approved expense posts a balanced journal to the right department and
cost centre; P&L for any property/period reconciles to the trial balance; GOP and GOPPAR appear on
the executive dashboard with drill-down to expenses; budget variance per department; allocated
room costs are labelled "allocated" with the driver shown.

## Development log

| Date | Cycle | Summary |
|---|---|---|
| 2026-10-24 | Phase 0 | Audit: repository contains BrainADZ HRMS only; hospitality product to be built in `hospitality/` on the same stack. Docs created. |
