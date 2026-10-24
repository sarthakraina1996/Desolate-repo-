// Metric registry: the machine-readable form of docs/FINANCIAL_METRICS.md, served to the UI
// so every number can explain itself. status: live | estimated | needs:<module>.
const ROOM_SRC = ['rooms', 'room_blocks', 'room_nights'];
const NIGHT_SRC = ['reservation_nights', 'reservations'];
const REV_SRC = ['folio_postings'];

const def = (id, name, unit, formula, definition, extra = {}) => ({
  id,
  name,
  unit,
  formula,
  definition,
  granularity: 'property × business date',
  currency: unit === 'currency' ? 'property currency; consolidated in the organisation reporting currency' : null,
  sources: extra.sources || [],
  assumptions: extra.assumptions || [],
  exclusions: extra.exclusions || [],
  drilldown: extra.drilldown || null,
  status: extra.status || 'live',
  higherIsBetter: extra.higherIsBetter ?? true,
});

export const METRICS = [
  def('available_room_nights', 'Available room nights', 'nights', 'Σ active rooms per night (− OOO if policy excludes)', 'Room nights the property could sell in the period.', {
    sources: ROOM_SRC,
    assumptions: ['Out-of-order rooms are included by default (USALI 11th / STR supply); property policy may exclude them.'],
    drilldown: 'room_nights',
  }),
  def('sold_room_nights', 'Sold room nights', 'nights', 'Count of paid nights stayed', 'Nights stayed by paying guests.', {
    sources: NIGHT_SRC,
    exclusions: ['Complimentary and house-use nights', 'No-shows and cancellations', 'Unstayed nights of early departures'],
    drilldown: 'sold_room_nights',
  }),
  def('occupancy_pct', 'Occupancy', 'percent', 'Sold room nights ÷ Available room nights × 100', 'Share of available rooms sold.', {
    sources: [...ROOM_SRC, ...NIGHT_SRC],
    assumptions: ['Consolidated occupancy is Σ sold ÷ Σ available across properties (weighted).'],
    drilldown: 'sold_room_nights',
  }),
  def('adr', 'ADR / ARR', 'currency', 'Room revenue ÷ Sold room nights', 'Average net room rate per sold night.', {
    sources: [...REV_SRC, ...NIGHT_SRC],
    assumptions: ['Room revenue is net of tax and discounts; package F&B components are F&B revenue.', 'The open business day uses rates on the books (provisional).'],
    exclusions: ['Cancellation and no-show fees', 'Complimentary nights (denominator)'],
    drilldown: 'room_revenue',
  }),
  def('revpar', 'RevPAR', 'currency', 'Room revenue ÷ Available room nights', 'Room revenue per available room night (≡ ADR × Occupancy).', { sources: [...REV_SRC, ...ROOM_SRC], drilldown: 'room_revenue' }),
  def('trevpar', 'TRevPAR', 'currency', 'Total operating revenue ÷ Available room nights', 'All departmental revenue per available room night.', { sources: [...REV_SRC, ...ROOM_SRC], drilldown: 'total_operating_revenue' }),
  def('total_operating_revenue', 'Total operating revenue', 'currency', 'Σ net revenue of operated departments', 'Rooms, F&B, banquets, spa, other operated departments and miscellaneous income, net of tax.', {
    sources: REV_SRC,
    exclusions: ['Taxes', 'Payments and transfers between folios'],
    drilldown: 'total_operating_revenue',
  }),
  def('room_revenue', 'Room revenue', 'currency', 'Σ net room charges', 'Net room charges posted by the night audit, with adjustments.', { sources: REV_SRC, drilldown: 'room_revenue' }),
  def('fnb_revenue', 'F&B revenue', 'currency', 'Σ net F&B charges', 'Food and beverage charged to folios (POS outlet sales join in Phase 3).', { sources: REV_SRC, drilldown: 'fnb_revenue' }),
  def('banquet_revenue', 'Banquet revenue', 'currency', 'Σ net banquet charges', 'Banquet and event revenue posted to folios.', { sources: REV_SRC, drilldown: 'banquet_revenue' }),
  def('spa_revenue', 'Spa revenue', 'currency', 'Σ net spa charges', 'Spa and wellness revenue posted to folios.', { sources: REV_SRC, drilldown: 'spa_revenue' }),
  def('other_revenue', 'Other revenue', 'currency', 'Σ net other operated + misc', 'Laundry, transport, miscellaneous income.', { sources: REV_SRC, drilldown: 'other_revenue' }),
  def('alos', 'ALOS', 'nights', 'Σ nights of departed stays ÷ departed stays', 'Average length of stay of guests who departed in the period.', { sources: NIGHT_SRC, drilldown: 'stays_departed' }),
  def('cancellation_rate_pct', 'Cancellation rate', 'percent', 'Cancelled ÷ (Expected + Cancelled) arrivals × 100', 'Share of reservations due to arrive in the period that were cancelled.', { sources: NIGHT_SRC, higherIsBetter: false, drilldown: 'arrivals_cancelled' }),
  def('no_show_rate_pct', 'No-show rate', 'percent', 'No-shows ÷ Expected arrivals × 100', 'Share of expected arrivals that did not arrive.', { sources: NIGHT_SRC, higherIsBetter: false, drilldown: 'no_shows' }),
  def('direct_pct', 'Direct booking share', 'percent', 'Direct sold nights ÷ Sold nights × 100', 'Share of sold nights booked without an intermediary (direct, website, phone, walk-in, corporate, group).', { sources: NIGHT_SRC, drilldown: 'sold_room_nights' }),
  def('commission_cost', 'OTA / agent commission', 'currency', 'Σ room revenue × commission rate', 'Distribution commission on commissionable bookings.', { sources: [...REV_SRC, 'reservations.commission_bp'], status: 'estimated', higherIsBetter: false, assumptions: ['Estimated from the contracted rate until channel invoices are reconciled (Phase 5).'] }),
  def('net_room_revenue', 'Net room revenue after distribution', 'currency', 'Room revenue − commission', 'Room revenue after distribution cost.', { status: 'estimated' }),
  def('otb_room_nights', 'On the books', 'nights', 'Future nights of confirmed and in-house stays', 'Room nights already booked for future dates.', { sources: NIGHT_SRC }),
  ...[
    ['gop', 'GOP', 'Total operating revenue − departmental − undistributed expenses'],
    ['gop_margin_pct', 'GOP margin', 'GOP ÷ Total operating revenue × 100'],
    ['goppar', 'GOPPAR', 'GOP ÷ Available room nights'],
    ['cpor', 'CPOR', 'Rooms department expenses ÷ Sold room nights'],
    ['ebitda', 'EBITDA', 'GOP − management fees − non-operating expenses'],
    ['ebit', 'EBIT', 'EBITDA − depreciation − amortisation'],
    ['net_profit', 'Net profit', 'EBIT − interest − income tax'],
    ['opex', 'OPEX', 'Σ operating expense accounts'],
    ['capex', 'CAPEX', 'Σ capitalised additions'],
    ['budget_variance', 'Budget variance', 'Actual − Budget'],
    ['accounts_payable', 'Accounts payable', 'Vendor ledger balance'],
  ].map(([id, name, formula]) =>
    def(id, name, id.endsWith('_pct') ? 'percent' : 'currency', formula, `${name} from the general ledger.`, { status: 'needs:finance', sources: ['journal_lines', 'accounts'] }),
  ),
  ...[
    ['food_cost_pct', 'Food cost %', 'Food COGS ÷ Food sales × 100'],
    ['beverage_cost_pct', 'Beverage cost %', 'Beverage COGS ÷ Beverage sales × 100'],
    ['prime_cost', 'Prime cost', 'F&B COGS + F&B labour'],
    ['apc', 'APC', 'Restaurant net sales ÷ Covers'],
    ['aov', 'AOV', 'Net order sales ÷ Completed orders'],
    ['revpash', 'RevPASH', 'Restaurant revenue ÷ Available seat hours'],
  ].map(([id, name, formula]) =>
    def(id, name, id.endsWith('_pct') ? 'percent' : 'currency', formula, `${name} from POS and inventory.`, { status: 'needs:pos', sources: ['pos_orders', 'stock_ledger'] }),
  ),
  ...[
    ['mpi', 'MPI', 'Own occupancy ÷ Comp-set occupancy × 100'],
    ['ari_index', 'ARI (rate index)', 'Own ADR ÷ Comp-set ADR × 100'],
    ['rgi', 'RGI', 'Own RevPAR ÷ Comp-set RevPAR × 100'],
  ].map(([id, name, formula]) => def(id, name, 'index', formula, `${name} against a licensed competitive set.`, { status: 'needs:compset' })),
];

export const METRIC_IDS = new Set(METRICS.map((m) => m.id));
