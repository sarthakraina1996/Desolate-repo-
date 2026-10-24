# BrainADZ Hospitality OS — Financial Metrics Engine

The metrics engine (`hospitality/server/modules/metrics/`) is the single source for every KPI on
every dashboard, report and API. This document is its specification. The machine-readable
registry (`definitions.js`) carries the same fields and is served at `GET /api/metrics/definitions`
so the UI can show "how is this calculated?" for any number.

## 1. Principles

1. **Base measures first, ratios last.** The engine aggregates base measures (sums and counts)
   for the requested scope and period, then applies formulas. Consolidated ratios are therefore
   weighted by their real denominators. Property percentages are never averaged.
2. **Currency before consolidation.** Amounts are converted to the reporting currency at the
   documented rate before being summed across properties. The rate set used is returned with the
   result.
3. **Closed days are actuals; the open day is provisional.** Revenue is posted by the night audit
   per business date. For the current open business date the engine returns expected values from
   reservation rates and flags them `provisional: true`.
4. **No number without a source.** A metric whose source module is not live returns
   `{ value: null, unavailable: "<reason>" }`. Demo data is labelled at organisation level
   (`organizations.is_demo`).
5. **Division by zero yields `null`**, displayed as "—", never 0 % or ∞.
6. **Every metric drills down** to the rows that produced it.
7. **Money is integer minor units** in storage and aggregation; formulas return minor units for
   currency metrics.
8. **Days without records are "no data", never zero.** Each property has `records_from`, the
   first business date the system holds records for (its go-live, or the start of imported
   history). Earlier days contribute nothing — not even available rooms — so a financial year
   that began before go-live is not diluted by empty months. A period with no covered day returns
   `null` for every metric (shown "—"); a partly covered period returns `coverage: { from, to,
   partial: true }` so reports can say where records begin. Trend charts leave such months as
   gaps.

## 2. Base measures

| Measure | Definition | Source |
|---|---|---|
| `room_inventory_nights` | Σ over nights in period of rooms that are active (commissioned, not decommissioned) | `rooms` |
| `ooo_room_nights` | Room nights covered by an out-of-order block | `room_blocks` (kind `ooo`) |
| `available_room_nights` | `room_inventory_nights` − (`ooo_room_nights` if property policy `exclude_ooo_from_available`) | derived |
| `sold_room_nights` | Paid room nights stayed: nights of reservations in status in-house / checked-out / closed, excluding complimentary and house-use | `reservation_nights` + `reservations` |
| `comp_room_nights` | Complimentary room nights stayed | same |
| `house_use_room_nights` | House-use room nights stayed | same |
| `occupied_room_nights` | `sold + comp` (house use excluded) | derived |
| `otb_room_nights` | Future nights of confirmed and in-house reservations (on the books) | same |
| `room_revenue` | Net (ex-tax) room charges, including adjustments and reversals; excludes cancellation/no-show fees | `folio_postings` department `rooms`, category `room` |
| `rooms_other_revenue` | Cancellation, no-show and attrition fees | `folio_postings` department `rooms`, category `fee` |
| `fnb_revenue`, `banquet_revenue`, `spa_revenue`, `other_revenue` | Net departmental revenue | `folio_postings` by department (POS adds outlet sales in Phase 3) |
| `total_operating_revenue` | Σ net revenue of all operated departments | derived |
| `tax_collected` | Σ tax on charges | `folio_postings.tax_minor` |
| `payments_received` | Σ payments net of refunds | `folio_postings` kind `payment` / `refund` |
| `arrivals_expected` | Reservations with arrival in period, excluding quotes and cancelled | `reservations` |
| `arrivals_cancelled` | Reservations with arrival in period that were cancelled | `reservations` |
| `no_shows` | Reservations with arrival in period marked no-show | `reservations` |
| `stays_departed`, `stay_nights_departed` | Count and Σ nights of stays that departed in period | `reservations` |
| `direct_room_nights` | Sold room nights whose booking source is classified direct | `reservations.source` |
| `commission_cost` | Σ room revenue × commission rate of commissionable sources (estimated until the channel invoice is reconciled) | `reservations.commission_bp` × posted room revenue |

### 2.1 Inventory and stay rules (standardised special cases)

| Case | Rule |
|---|---|
| Out-of-order rooms | Included in available rooms by default (USALI 11th / STR supply convention); property policy can exclude them. The choice is returned with the metric. |
| Out-of-service rooms | Always included in available rooms; not blocked from sale by the inventory check (warning only). |
| Complimentary stays | Count as occupied, not sold; excluded from ADR denominator; zero room revenue. |
| House use | Excluded from sold and occupied; reported separately. |
| Day use | Not in WP1. When added: counts as revenue, not as a room night. |
| Early departure | Unstayed nights are released; they are not sold nights. |
| No-show | Not a sold night; any no-show fee is `rooms_other_revenue`. |
| Upgrades | A sold night is counted once, for the room physically occupied; revenue stays with the rate charged. |
| Taxes | Excluded from all revenue measures; tracked as liabilities. |
| Service charge | Not in WP1; when configured it will be revenue or a liability per jurisdiction setting. |
| Discounts | Revenue is net of discounts (the posted amount). |
| Packages | Package components are posted to their departments (e.g. breakfast to F&B) at posting time; no double counting. |
| Reversals and adjustments | Reduce revenue on the business date they are posted, not the original date (period integrity after close). |

## 3. Metric registry

Status: ✅ implemented and tested in WP1 · 🟡 implemented with an estimated source ·
⏳ needs a later module (named).

### 3.1 Rooms and hotel performance

| Metric | Formula | Unit | Status |
|---|---|---|---|
| Occupancy % | `sold_room_nights / available_room_nights × 100` | % | ✅ |
| Occupancy incl. comp % | `occupied_room_nights / available_room_nights × 100` | % | ✅ |
| ADR (Average Daily Rate) | `room_revenue / sold_room_nights` | currency | ✅ |
| ARR (Average Room Rate) | Same as ADR (Indian usage) | currency | ✅ |
| RevPAR | `room_revenue / available_room_nights` (≡ ADR × Occupancy) | currency | ✅ |
| TRevPAR | `total_operating_revenue / available_room_nights` | currency | ✅ |
| GOPPAR | `GOP / available_room_nights` | currency | ⏳ Finance (Phase 4) |
| CPOR | `rooms department expenses / sold_room_nights` | currency | ⏳ Finance (Phase 4) |
| ALOS | `stay_nights_departed / stays_departed` | nights | ✅ |
| Cancellation rate | `arrivals_cancelled / (arrivals_expected + arrivals_cancelled) × 100` | % | ✅ |
| No-show rate | `no_shows / arrivals_expected × 100` | % | ✅ |
| Direct booking % | `direct_room_nights / sold_room_nights × 100` | % | ✅ |
| OTA commission cost | `Σ room revenue × commission rate` for commissionable sources | currency | 🟡 estimated until channel invoices (Phase 5) |
| Available / sold room nights | base measures | nights | ✅ |
| OTB | `otb_room_nights` for future dates; OTB revenue from reservation rates | nights / currency | ✅ |
| Booking pickup | Δ OTB between two snapshot dates for the same stay dates | nights | ✅ (from reservation created/cancelled timestamps) |
| Booking pace | OTB at lead time *t* vs same lead time last year | nights | ✅ |
| BAR | Best available rate: lowest public, unrestricted rate for the room type and date | currency | ✅ (rate grid) |
| ARI | Availability, rates and inventory per room type and date | grid | ✅ (rate grid) |
| MPI | `own occupancy / comp-set occupancy × 100` | index | ⏳ licensed comp-set data |
| ARI index (rate) | `own ADR / comp-set ADR × 100` | index | ⏳ licensed comp-set data |
| RGI | `own RevPAR / comp-set RevPAR × 100` | index | ⏳ licensed comp-set data |

### 3.2 Revenue

| Metric | Formula | Status |
|---|---|---|
| Total operating revenue | Σ departmental net revenue | ✅ |
| Room / F&B / Banquet / Spa / Other revenue | departmental net revenue | ✅ (F&B from folio postings; POS outlets add in Phase 3) |
| Revenue by property / department / channel / room type | grouped `room_revenue` and departmental revenue | ✅ |
| Net revenue after distribution cost | `room_revenue − commission_cost` | 🟡 |
| Channel contribution % | channel room revenue / total room revenue × 100 | ✅ |

### 3.3 Financial performance (Finance module)

| Metric | Formula | Status |
|---|---|---|
| OPEX | Σ operating expense accounts (undistributed + departmental) | ⏳ Phase 4 |
| CAPEX | Σ capitalised additions in period | ⏳ Phase 4 |
| COGS | Σ cost of sales (consumption at inventory cost) | ⏳ Phase 3/4 |
| Gross profit | `revenue − COGS` | ⏳ |
| Departmental profit | `department revenue − department expenses` | ⏳ |
| GOP | `total operating revenue − departmental expenses − undistributed operating expenses` | ⏳ |
| GOP margin % | `GOP / total operating revenue × 100` | ⏳ |
| EBITDA | `GOP − management fees − non-operating income/expenses (rent, property tax, insurance)` | ⏳ |
| EBIT | `EBITDA − depreciation − amortisation` | ⏳ |
| Net profit | `EBIT − interest − income tax` | ⏳ |
| Net profit margin % | `net profit / total revenue × 100` | ⏳ |
| Operating cash flow | indirect method from net profit and working-capital movement | ⏳ |
| Working capital | `current assets − current liabilities` | ⏳ |
| Accounts receivable | City-ledger AR balance (+ guest ledger for in-house) | ✅ balances from GL; ageing ⏳ |
| Accounts payable | Vendor ledger balance | ⏳ Phase 3/4 |
| Budget variance | `actual − budget`, `% = (actual − budget) / budget × 100` | ⏳ |
| Forecast variance | `actual − forecast` | ⏳ |
| ROI | `(gain − cost) / cost × 100` | ⏳ |
| Contribution margin | `(revenue − variable cost) / revenue × 100` | ⏳ |

### 3.4 F&B (POS module, Phase 3)

| Metric | Formula |
|---|---|
| Food cost % | `food COGS / food sales × 100` |
| Beverage cost % | `beverage COGS / beverage sales × 100` |
| Prime cost | `F&B COGS + F&B labour cost`; % of F&B sales |
| APC (average per cover) | `restaurant net sales / covers` |
| AOV (average order value) | `net order sales / completed orders` |
| RevPASH | `restaurant revenue / (seats × open hours)` |
| Wastage % | `waste value / (consumption value) × 100` |
| Menu engineering | item contribution vs average contribution × popularity vs (1/items × 70 %) threshold (configurable) → Stars, Plowhorses, Puzzles, Dogs |

## 4. Periods and comparisons

Presets resolve against the property's **last closed business date** (business date − 1):

| Preset | Range (inclusive) |
|---|---|
| `today` | open business date (provisional) |
| `yesterday` | last closed business date |
| `last7`, `last30` | 7 / 30 days ending yesterday |
| `mtd`, `qtd`, `ytd` | first day of month / calendar quarter / calendar year to yesterday |
| `fy` | first day of the financial year (organisation setting, India default April) to yesterday |
| `custom` | `from`, `to` supplied |

Comparisons: `previous` (same number of days immediately before), `last_year` (same dates one
year earlier; 29 Feb maps to 28 Feb). DoD, WoW, MoM, YoY are `previous` comparisons of 1-day,
7-day, month and year ranges. Change is reported as absolute delta and percentage
`(current − prior) / |prior| × 100` (null when prior is 0). Percentage metrics report the delta
in percentage points.

## 5. Consolidation

```
consolidated ADR = Σ_p convert(room_revenue_p) / Σ_p sold_room_nights_p
consolidated Occupancy = Σ_p sold_room_nights_p / Σ_p available_room_nights_p
```

The engine never computes `mean(ADR_p)`. A test asserts that a 10-room property at 90 % and a
100-room property at 50 % consolidate to 53.6 %, not 70 %.

FX: `fx_rates(rate_date, from_currency, to_currency, rate)`; the engine uses the monthly rate on
or before the business date (demo rates are fixed and labelled). Amounts are converted per
property per month before summing.

## 6. Drill-down

| Metric family | Drill-down rows |
|---|---|
| Revenue measures | Folio postings (date, property, folio, reservation, department, description, net, tax) |
| Room-night measures | Reservation nights (date, property, room, reservation, guest, rate, source) |
| Arrivals / cancellations / no-shows | Reservations |
| Commission | Reservations with source, commission rate and posted revenue |

`GET /api/metrics/drilldown?metric=room_revenue&from=…&to=…&property=…` paginates rows; the sum
of the rows equals the metric value (tested).

## 7. Reconciliation checks

Run by `GET /api/finance/reconciliation` and in the test suite:

| Check | Rule |
|---|---|
| R1 Revenue ↔ GL | Σ net departmental revenue from folio postings = Σ (credits − debits) on revenue accounts, per property and date range |
| R2 Guest ledger ↔ GL | Σ balances of open guest folios = GL guest-ledger control account balance |
| R3 Room nights ↔ postings | For closed days, sold room nights = count of non-reversed night-audit room charges |
| R4 Journals balanced | Every journal entry Σ debit = Σ credit; trial balance nets to zero |
| R5 Invoice ↔ folio | Invoice totals = Σ the folio postings it covers |
| R6 City ledger ↔ GL | Σ open company account balances = GL city-ledger AR balance |

## 8. Tests

`hospitality/tests/metrics.test.js` covers every implemented formula (including null on zero
denominators), weighted consolidation, FX conversion, period resolution (month ends, leap years,
financial-year boundaries), and the reconciliation checks against the seeded demo.
