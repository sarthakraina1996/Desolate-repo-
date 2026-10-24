// Starting configuration for a new organisation or property: USALI-style departments, a chart
// of accounts, transaction (charge) codes, payment methods and tax rules for the supported
// regimes. Tax rates are DEMONSTRATION values with the source noted; they must be verified by
// a qualified adviser before production use.

export const DEPARTMENTS = [
  ['rooms', 'Rooms', 'operated'],
  ['fnb', 'Food & Beverage', 'operated'],
  ['banquets', 'Banquets & Events', 'operated'],
  ['spa', 'Spa & Wellness', 'operated'],
  ['other', 'Other Operated Departments', 'operated'],
  ['misc', 'Miscellaneous Income', 'operated'],
  ['ag', 'Administrative & General', 'undistributed'],
  ['it', 'Information & Telecommunications', 'undistributed'],
  ['sm', 'Sales & Marketing', 'undistributed'],
  ['pom', 'Property Operation & Maintenance', 'undistributed'],
  ['utilities', 'Utilities', 'undistributed'],
  ['mgmt', 'Management Fees', 'non_operating'],
  ['nonop', 'Non-Operating Income & Expenses', 'non_operating'],
];

// [code, name, type, usali_section, department]
export const ACCOUNTS = [
  ['1010', 'Cash on Hand', 'asset', 'Current Assets', null],
  ['1020', 'Card Settlement Clearing', 'asset', 'Current Assets', null],
  ['1030', 'UPI / Digital Wallet Clearing', 'asset', 'Current Assets', null],
  ['1040', 'Bank — Operating Account', 'asset', 'Current Assets', null],
  ['1210', 'Guest Ledger (In-house Receivables)', 'asset', 'Current Assets', null],
  ['1220', 'City Ledger (Accounts Receivable)', 'asset', 'Current Assets', null],
  ['2310', 'Output CGST Payable', 'liability', 'Current Liabilities', null],
  ['2311', 'Output SGST Payable', 'liability', 'Current Liabilities', null],
  ['2312', 'Output IGST Payable', 'liability', 'Current Liabilities', null],
  ['2320', 'Output VAT Payable', 'liability', 'Current Liabilities', null],
  ['3010', 'Retained Earnings', 'equity', 'Equity', null],
  ['4010', 'Room Revenue', 'revenue', 'Rooms', 'rooms'],
  ['4090', 'Rooms Other Revenue (Cancellation / No-show)', 'revenue', 'Rooms', 'rooms'],
  ['4110', 'Food Revenue', 'revenue', 'Food & Beverage', 'fnb'],
  ['4120', 'Beverage Revenue', 'revenue', 'Food & Beverage', 'fnb'],
  ['4210', 'Banquet & Event Revenue', 'revenue', 'Banquets & Events', 'banquets'],
  ['4310', 'Spa Revenue', 'revenue', 'Other Operated Departments', 'spa'],
  ['4410', 'Laundry & Guest Services Revenue', 'revenue', 'Other Operated Departments', 'other'],
  ['4420', 'Transportation Revenue', 'revenue', 'Other Operated Departments', 'other'],
  ['4910', 'Miscellaneous Income', 'revenue', 'Miscellaneous Income', 'misc'],
];

// Which control account a folio kind posts to.
export const CONTROL_ACCOUNT = { guest: '1210', master: '1210', house: '1210', company: '1220' };

// [code, name, department, category, tax_category, account, hsn/sac, manual]
export const CHARGE_CODES = [
  ['ROOM', 'Room charge', 'rooms', 'room', 'room', '4010', '996311', 0],
  ['EXTRABED', 'Extra bed', 'rooms', 'room', 'room', '4010', '996311', 1],
  ['EARLYCI', 'Early check-in', 'rooms', 'room', 'room', '4010', '996311', 1],
  ['LATECO', 'Late checkout', 'rooms', 'room', 'room', '4010', '996311', 1],
  ['NOSHOW', 'No-show fee', 'rooms', 'fee', 'room', '4090', '996311', 0],
  ['CANCEL', 'Cancellation fee', 'rooms', 'fee', 'room', '4090', '996311', 0],
  ['BRKF', 'Breakfast (package)', 'fnb', 'food', 'fnb', '4110', '996331', 0],
  ['REST', 'Restaurant — food', 'fnb', 'food', 'fnb', '4110', '996331', 1],
  ['BEV', 'Restaurant / bar — beverages', 'fnb', 'beverage', 'fnb_beverage', '4120', '996331', 1],
  ['IRD', 'In-room dining', 'fnb', 'food', 'fnb', '4110', '996331', 1],
  ['MINIBAR', 'Minibar', 'fnb', 'beverage', 'fnb_beverage', '4120', '996331', 1],
  ['BANQ', 'Banquet & event', 'banquets', 'banquet', 'banquet', '4210', '996334', 1],
  ['SPA', 'Spa treatment', 'spa', 'spa', 'spa', '4310', '999722', 1],
  ['LAUNDRY', 'Laundry', 'other', 'other', 'other', '4410', '999712', 1],
  ['TRANSFER', 'Airport transfer', 'other', 'other', 'other', '4420', '996412', 1],
  ['MISC', 'Miscellaneous', 'misc', 'other', 'other', '4910', '999799', 1],
];

export function paymentMethodsFor(country) {
  const base = [
    ['CASH', 'Cash', 'cash', '1010'],
    ['CARD', 'Card (tokenised terminal)', 'card', '1020'],
    ['BANK', 'Bank transfer', 'bank', '1040'],
    ['CL', 'City ledger (company account)', 'city_ledger', '1220'],
  ];
  if (country === 'IN') base.splice(2, 0, ['UPI', 'UPI', 'upi', '1030']);
  return base;
}

// India GST on hotel accommodation is set per room per night by the value of supply:
// up to ₹1,000 exempt; ₹1,001–7,500 at 5 % (12 % before 22 Sep 2025); above ₹7,500 at 18 %.
// Restaurant service is 5 %, or 18 % in "specified premises" (hotels with tariffs above ₹7,500).
const gst = (rateBp) => [
  { code: 'CGST', rate_bp: rateBp / 2, account: '2310' },
  { code: 'SGST', rate_bp: rateBp / 2, account: '2311' },
];
const vat = (rateBp) => [{ code: 'VAT', rate_bp: rateBp, account: '2320' }];

export function taxRulesFor(regime, { specifiedPremises = false } = {}) {
  if (regime === 'IN_GST') {
    const fnb = specifiedPremises ? 1800 : 500;
    return [
      { category: 'room', name: 'GST exempt (≤ ₹1,000)', rate_bp: 0, slab_min_minor: 0, slab_max_minor: 100000, components: [], effective_from: '2017-07-01', note: 'Demo configuration — verify' },
      { category: 'room', name: 'GST 12% (₹1,001–7,500)', rate_bp: 1200, slab_min_minor: 100001, slab_max_minor: 750000, components: gst(1200), effective_from: '2017-07-01', effective_to: '2025-09-21', note: 'Superseded 22 Sep 2025' },
      { category: 'room', name: 'GST 5% (₹1,001–7,500)', rate_bp: 500, slab_min_minor: 100001, slab_max_minor: 750000, components: gst(500), effective_from: '2025-09-22', note: 'Demo configuration — verify' },
      { category: 'room', name: 'GST 18% (> ₹7,500)', rate_bp: 1800, slab_min_minor: 750001, slab_max_minor: null, components: gst(1800), effective_from: '2017-07-01', note: 'Demo configuration — verify' },
      { category: 'fnb', name: `GST ${fnb / 100}% restaurant`, rate_bp: fnb, components: gst(fnb), effective_from: '2017-07-01', note: specifiedPremises ? 'Specified premises' : 'Not specified premises' },
      { category: 'fnb_beverage', name: `GST ${fnb / 100}% beverages`, rate_bp: fnb, components: gst(fnb), effective_from: '2017-07-01', note: 'Non-alcoholic; alcohol is outside GST (state excise/VAT) — not modelled' },
      { category: 'banquet', name: 'GST 18% events', rate_bp: 1800, components: gst(1800), effective_from: '2017-07-01' },
      { category: 'spa', name: 'GST 18% spa', rate_bp: 1800, components: gst(1800), effective_from: '2017-07-01' },
      { category: 'other', name: 'GST 18% services', rate_bp: 1800, components: gst(1800), effective_from: '2017-07-01' },
    ];
  }
  if (regime === 'EU_VAT') {
    // Portugal (mainland) demonstration rates: accommodation 6 %, food 13 %, drinks/services 23 %.
    return [
      { category: 'room', name: 'IVA 6% accommodation', rate_bp: 600, components: vat(600), effective_from: '2020-01-01', note: 'Demo configuration — verify' },
      { category: 'fnb', name: 'IVA 13% food', rate_bp: 1300, components: vat(1300), effective_from: '2020-01-01' },
      { category: 'fnb_beverage', name: 'IVA 23% beverages', rate_bp: 2300, components: vat(2300), effective_from: '2020-01-01' },
      { category: 'banquet', name: 'IVA 13% catering', rate_bp: 1300, components: vat(1300), effective_from: '2020-01-01' },
      { category: 'spa', name: 'IVA 23% spa', rate_bp: 2300, components: vat(2300), effective_from: '2020-01-01' },
      { category: 'other', name: 'IVA 23% services', rate_bp: 2300, components: vat(2300), effective_from: '2020-01-01' },
    ];
  }
  return [];
}

export const AMENITIES = [
  ['WIFI', 'High-speed Wi-Fi', 'Technology', 'wifi'],
  ['SMART_TV', 'Smart TV', 'Technology', 'tv'],
  ['AC', 'Air conditioning', 'Comfort', 'snowflake'],
  ['MINIBAR', 'Minibar', 'Food & drink', 'wine'],
  ['COFFEE', 'Coffee machine', 'Food & drink', 'coffee'],
  ['KETTLE', 'Tea & coffee kettle', 'Food & drink', 'cup-soda'],
  ['SAFE', 'In-room safe', 'Security', 'lock'],
  ['DESK', 'Work desk', 'Business', 'briefcase'],
  ['HAIRDRYER', 'Hair dryer', 'Bathroom', 'wind'],
  ['IRON', 'Iron & board', 'Comfort', 'shirt'],
  ['TOILETRIES', 'Premium toiletries', 'Bathroom', 'sparkles'],
  ['BATHTUB', 'Bathtub', 'Bathroom', 'bath'],
  ['RAINSHOWER', 'Rain shower', 'Bathroom', 'shower-head'],
  ['BATHROBE', 'Bathrobe & slippers', 'Bathroom', 'shirt'],
  ['BALCONY', 'Balcony', 'Outdoor', 'sun'],
  ['PLUNGE_POOL', 'Private plunge pool', 'Outdoor', 'waves'],
  ['LOUNGE', 'Club lounge access', 'Services', 'crown'],
  ['BUTLER', 'Butler service', 'Services', 'concierge-bell'],
  ['BLACKOUT', 'Blackout curtains', 'Comfort', 'moon'],
  ['SOUNDPROOF', 'Soundproofing', 'Comfort', 'volume-x'],
];
