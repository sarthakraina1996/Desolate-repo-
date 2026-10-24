# BrainADZ Hospitality OS — Product Requirements

> Intelligence for Hospitality. Control for Growth.

An enterprise hospitality operating system that connects operations, revenue management,
financial intelligence and multi-property control for hotels, resorts, restaurants and
multi-property groups.

This document is the working requirements baseline. It condenses the master build brief into
testable requirements. Status per module lives in [`MODULE_STATUS.md`](MODULE_STATUS.md), the
delivery order in [`IMPLEMENTATION_ROADMAP.md`](IMPLEMENTATION_ROADMAP.md).

Functional benchmarks: Oracle OPERA Cloud, Mews, Apaleo, Cloudbeds, Hotelogix, IDS Next,
Agilysys, RoomPriceGenie, Stayntouch, Infor HMS. They are benchmarks for capability only; no
proprietary code, branding, designs or assets are copied.

---

## 1. Users and the business question

The ultimate acceptance test: a hospitality business owner opens BrainADZ Hospitality OS and
understands

1. what is happening across every property today,
2. how much money each department is generating,
3. where expenditure is increasing,
4. which rooms and outlets are profitable,
5. what requires attention,
6. how the business is performing from today through the financial year.

| Persona | Primary needs |
|---|---|
| Group Owner / Chairman | Consolidated revenue, profit, cash, property comparison, exceptions |
| Corporate CEO | Portfolio KPIs, budget variance, growth, brand performance |
| CFO | P&L, GOP/EBITDA, AR/AP, cash flow, period close, audit trail |
| General Manager | Property P&L, operations, guest satisfaction, staffing |
| Revenue Manager | Pace, pickup, forecast, rates, restrictions, channel mix |
| Front Office Manager | Arrivals, departures, in-house, room assignment, cashier, night audit |
| Front Desk Agent | Check-in/out, walk-ins, folios, payments, guest requests |
| F&B Manager | Outlet sales, food/beverage cost, menu engineering |
| Housekeeping Manager / Attendant | Room status, task assignment, inspection, productivity |
| Procurement Manager | Requisitions, POs, GRNs, vendor pricing, stock |
| Banquet Manager | Event calendar, BEOs, hall inventory, event P&L |
| Finance & Accounts | Ledgers, receivables, payables, reconciliations, invoices |

Every dashboard and API response respects **organisation (tenant) isolation, property access,
role permissions and financial-data visibility**.

## 2. Product identity and UX rules

- BrainADZ corporate blue (`#233E85`, from the brand artwork) is the primary identity; BrainADZ
  Live red (`#C82026`) highlights selected actions; white and very light grey are working
  surfaces; green/yellow (Exhibits) and turquoise (Marketing) are used sparingly for status.
- The actual BrainADZ wordmark and monogram (vector, extracted from the supplied booklet) are
  used. No AI-recreated logo.
- **Navigation is at the top**: fixed global header, horizontal module navigation with Dashboard
  first, secondary horizontal tabs inside modules, property and date selectors, role-aware items,
  overflow menu on smaller screens, breadcrumbs on deep pages. No permanent left sidebar.
- Module order: Dashboard | Reservations | Calendar | Front Desk | Rooms | Housekeeping | Guests |
  Revenue | Channel Manager | POS & F&B | Finance | Inventory | Operations | Reports |
  Multi-Property.
- Every functional screen has loading, empty and error states, validation, search, filters,
  sorting, pagination where needed, responsive layout, permission-aware actions, export where
  relevant, and audited writes. No decorative-only pages: a module that is not built yet says so.
- Desktop first for calendar, finance and hotel-wide operations; tablet supported; mobile layouts
  for employee workflows (housekeeping attendant, front desk lookups).
- Accessible contrast (WCAG AA for text) and keyboard navigation.

## 3. Functional requirements by module

Each requirement carries an ID used in tests and the status tracker.

### 3.1 Enterprise dashboards and BI (DASH)
- DASH-1 Role dashboards: Owner, CEO, CFO, GM, Revenue, Front Office, F&B, Housekeeping,
  Procurement, Banquet, Finance team.
- DASH-2 Revenue: total operating revenue; rooms, F&B, banquet, spa, other; by property,
  department, booking channel, room type.
- DASH-3 Financial performance: OPEX, CAPEX, GOP, GOP margin, EBITDA, EBIT, net profit, net
  margin, operating cash flow, AR, AP, budget variance, working capital.
- DASH-4 Hotel performance: available and sold room nights, occupancy, ADR/ARR, RevPAR, TRevPAR,
  GOPPAR, CPOR, ALOS, cancellation rate, no-show rate, direct booking %, OTA commission cost.
- DASH-5 Period presets: today, yesterday, last 7/30 days, MTD, QTD, YTD, financial year,
  previous period, same period last year, custom; DoD, WoW, MoM, YoY comparisons.
- DASH-6 Every card drills down to its underlying records.
- DASH-7 Values are never invented. Demo data is labelled as demo; a metric whose source module
  is not live shows "not available" with the reason, not a number.

### 3.2 Property and room management (PROP)
- PROP-1 Property master: name, legal entity, code, brand, address, country/state/city, timezone,
  operating currency, tax configuration, financial year, check-in/out times, cancellation
  policies, departments, cost centres, bank accounts, payment methods, property-level
  permissions.
- PROP-2 Building, floor, room type and individual room masters as separate entities.
- PROP-3 Individual room digital profile (number, building, floor, type, category, area in
  sq ft and m², bedrooms, bed type/size, max adults/children, extra beds, accessibility,
  connecting room, smoking, view, balcony, bathroom, AC, amenities, images, descriptions,
  operational/housekeeping/maintenance status, maintenance history, assets, refurbishment date,
  warranty, cost centre, rate-plan eligibility).
- PROP-4 Rooms inherit room-type amenities and attributes; authorised exceptions are recorded with
  who and why.
- PROP-5 Interactive room details page and property floor view.

### 3.3 Reservations and booking calendar (RES, CAL)
- RES-1 Sources: direct, website, OTA, corporate, travel agent, walk-in, group, long stay,
  package, complimentary, connected/multi-room.
- RES-2 Lifecycle: Create → Quote → Confirm → Deposit → Assign Room → Check-in → In-house →
  Checkout → Settlement → Close; plus cancellation and no-show.
- RES-3 Captures guest, dates, adults/children, room type, room, rate plan, source, packages,
  taxes, discounts, cancellation policy, requests, deposit, payment status.
- RES-4 Modification history and audit log for every change.
- RES-5 **No double booking**: a physical room can never hold two overlapping confirmed
  assignments; enforced transactionally in the database, not only in the UI.
- RES-6 Room-type inventory is validated per night (sellable rooms − out-of-order + configured
  overbooking allowance) with explicit, permissioned override.
- CAL-1 Timeline grid, one row per room, grouped by room type and floor; day/week/month views;
  horizontal navigation.
- CAL-2 Colour-coded status, arrival/departure markers, occupied state, maintenance and group
  blocks, unassigned reservations, overbooking alerts, availability per day, occupancy heatmap.
- CAL-3 Drag-and-drop move and reassignment, split stays, multi-room bookings, quick create, rate
  details on selection, action menu.
- CAL-4 Every drag triggers server-side validation; a rejected move snaps back and explains why.

### 3.4 Front office (FO)
- FO-1 Arrivals, departures, in-house boards; walk-ins; check-in; checkout; early check-in; late
  checkout; room changes.
- FO-2 Guest verification and identity-document capture (masked storage), VIP handling,
  preferences.
- FO-3 Deposits, cashier shifts, payment collection, split settlement.
- FO-4 Guest services: complaints, requests, wake-up calls, transport, room service, luggage.
- FO-5 Night audit: closes the business day, posts room and tax charges once, flags exceptions,
  advances the business date, survives interruption without double posting.

### 3.5 Housekeeping (HK)
- HK-1 Status dimensions held separately: occupancy (vacant/occupied), cleanliness
  (dirty/cleaning/clean/inspected), service (DND), maintenance (OK/required/OOO/OOS). Display
  codes VC, VD, OC, OD, INSP, DND, OOO, OOS, CIP, MR are derived.
- HK-2 Daily schedules, attendant assignment, supervisor inspection, priority requests,
  departure turnaround, stayover, deep clean, turndown.
- HK-3 Linen, laundry, minibar, amenity replenishment, lost and found, supplies, discrepancies,
  maintenance escalation, productivity.
- HK-4 Tracks start, completion, attendant, supervisor approval, materials, duration, readiness,
  exceptions; mobile-friendly attendant interface.
- HK-5 If the property requires inspection, a room is not ready for check-in until inspected.
- HK-6 Housekeeping consumption and labour feed room operating cost (with Inventory/Workforce).

### 3.6 Guest folios, ledgers and billing (FOL)
- FOL-1 Individual, shared, master, group, split, company and travel-agent folios; routing.
- FOL-2 Deposits, advances, payments, refunds, credit notes, adjustments, taxes, allocation,
  invoices, outstanding balances.
- FOL-3 Each posting has timestamp, business date, reference, reservation, guest, description,
  department, revenue account, debit, credit, taxes, currency, exchange rate, user, source
  transaction and reversal reference.
- FOL-4 Guest ledger, city ledger and accounts receivable; authorised transfers between folios and
  to corporate receivables.
- FOL-5 **Settled postings are never edited.** Corrections are reversals, adjustments and credit
  notes; the database rejects updates and deletes of financial rows.
- FOL-6 Invoices and tax documents per configurable jurisdiction rules (India GST, EU VAT),
  sequential numbering per property and financial year.

### 3.7 Channel manager (CHN)
- CHN-1 Connection registry, credentials (secret store), status; room, rate and inventory mapping.
- CHN-2 ARI updates, reservation/cancellation import, restrictions (MLOS, max LOS, CTA, CTD, stop
  sell), allotments.
- CHN-3 Sync history, failed-sync alerts, retries, idempotent import (no duplicate reservations).
- CHN-4 Commission tracking, revenue and profitability by source, rate parity (where permitted),
  direct booking engine.
- CHN-5 Adapters for Booking.com, Expedia and channel managers. **No integration is described as
  live without credentials, contracts and certification.** Until then, a simulator with test
  accounts, simulated events and failure scenarios. No scraping.

### 3.8 Revenue management (RMS)
- RMS-1 ADR, RevPAR, TRevPAR, occupancy and revenue forecast, pace, pickup, OTB, lead time,
  cancellation forecast, BAR, ARI, MPI, RGI, channel contribution, net revenue after
  distribution cost.
- RMS-2 Transparent configurable rules engine first; pluggable statistical/ML forecasting
  (LightGBM/XGBoost) once data suffices.
- RMS-3 Evaluates demand and revenue across candidate price points; manual, recommended and
  constrained auto-pricing; min/max; approval; rollback; history; explanation for every
  recommendation. Predictions are never presented as guaranteed.

### 3.9 Restaurant POS and F&B (POS)
- POS-1 Outlets, dine-in, takeaway, delivery, room service, bar, tables, waiter ordering, KOT,
  KDS, bill split, discounts, comps, taxes, payments, room posting, modifiers, allergens,
  packages, recipe-linked inventory, day close, cashier reconciliation.
- POS-2 Food/beverage sales, COGS, cost %, prime cost, APC, AOV, RevPASH, covers, contribution,
  outlet GOP, wastage, inventory variance, menu engineering (Stars/Plowhorses/Puzzles/Dogs).

### 3.10 Inventory, procurement and central kitchen (INV)
- INV-1 Items, UoM, ingredients, recipes, vendors, requisitions with approval, POs, GRNs,
  three-way invoice match, warehouses, stock ledger, transfers, counts, waste, expiry, batches,
  reorder points, standard vs actual recipe cost, vendor price history.
- INV-2 Central kitchen production, batch manufacturing, transfers to outlets/properties.
- INV-3 Inventory valuation per policy; purchases go to inventory, consumption to COGS — never
  both.

### 3.11 Finance, OPEX and CAPEX (FIN)
- FIN-1 USALI-aligned chart of accounts, general ledger, journals, AR, AP, cash and bank,
  reconciliation, cost centres, departmental accounting, budgets, forecasts, OPEX, CAPEX, asset
  register, depreciation, inter-property transactions, multi-currency, consolidation, period
  close, audit trail.
- FIN-2 Expense capture with property, department, cost centre, category, vendor, invoice, date,
  amount, tax, approval, payment, attachment, allocation method, budget reference.
- FIN-3 Expense allocation to department, room type and room with configurable drivers.
- FIN-4 CAPEX is capitalised and depreciated, never booked as routine OPEX.

### 3.12 Room-level financial analysis (RFA)
- RFA-1 Per room: occupied/available nights, revenue, ADR, ancillary revenue, commission,
  housekeeping, laundry, amenities, cleaning materials, energy, maintenance, minibar, payroll,
  overhead, total cost, contribution, CPOR.
- RFA-2 Any period; room vs room, type vs type, floor vs floor, property vs property; trend over
  the year.
- RFA-3 Measured and allocated costs are labelled separately; allocation drivers are shown.
  Consumption is never fabricated.

### 3.13 Financial metrics engine (MET)
- MET-1 One central engine; each metric has definition, formula, sources, period, currency,
  granularity, assumptions, exclusions, drill-down and reconciliation (see
  [`FINANCIAL_METRICS.md`](FINANCIAL_METRICS.md)).
- MET-2 Consolidated ratios are computed from summed numerators and denominators (weighted),
  never by averaging property percentages.
- MET-3 Unit tests for every formula and reconciliation.

### 3.14 Additional modules
Banquets and events (BNQ), maintenance and engineering (ENG), guest CRM and loyalty (CRM), spa
and ancillary (SPA), workforce and payroll integration (WFM — the BrainADZ HRMS in this
repository is the intended integration source), corporate sales (SAL), reports and BI (RPT),
multi-property control (MPC).

## 4. Cross-module workflows (acceptance journeys)

| ID | Journey |
|---|---|
| WF-A | Create booking → assign room → check-in → post room charges → add restaurant charge → receive payment → checkout → invoice → reconcile revenue |
| WF-B | Import OTA reservation → validate inventory → confirm → update availability → modify/cancel → reconcile commission |
| WF-C | Guest checks out → room dirty → attendant task → cleaning recorded → supervisor inspects → room available |
| WF-D | Order → KOT → prepare → consume recipe inventory → bill → charge room or collect payment → outlet financials |
| WF-E | Stock alert → requisition → approval → PO → GRN → supplier invoice → AP → payment |
| WF-F | Operational transaction → accounting entry → department report → property P&L → group dashboard → drill-down |
| WF-G | Occupancy/booking data → forecast → recommendation → approval → channel update → acknowledgement |
| WF-H | Outage → local operations continue → queue records events → reconnect → sync → conflicts → reconciliation |

Each journey must run through real services and persisted data, and has an automated test.

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Integrity | Transactional writes; integer minor-unit money; immutable financial rows; balanced journals; idempotent APIs |
| Security | Authentication, RBAC, property scoping, tenant isolation, MFA for privileged roles, CSRF protection, CSP, hashed secrets, audit log |
| Privacy | Consent capture, retention, export and erasure where lawful (GDPR, India DPDP Act 2023), masked identity documents |
| Payments | PCI DSS-aware: tokenisation via authorised providers; never store PAN, CVV or track data |
| Offline | Property Master Hub runs core operations without internet; durable outbox; idempotent replay; explicit online/offline indicators |
| Localisation | Currency, timezone, language, date/number format, tax rules and invoice formats configurable per property |
| Performance | Calendar for 500 rooms × 31 days renders < 1 s server time; dashboards < 2 s for 12 months × 5 properties |
| Ownership | Runs on BrainADZ-controlled infrastructure; no mandatory third-party AI dependency; any AI assistant optional and replaceable |
| Quality | No module marked complete until its workflows and tests pass |

## 6. Compliance boundary

Tax rates, invoice formats and data-protection workflows are configurable and seeded with
demonstration values. Country-specific regulatory compliance (GST e-invoicing, VAT reporting,
fiscalisation, data residency) must be validated by qualified advisers before production use.
