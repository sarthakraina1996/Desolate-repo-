// Module registry for navigation and status pages; mirrors docs/MODULE_STATUS.md, which holds
// the test evidence and outstanding items for each module.
// status: live (principal workflows usable) | partial (usable, scope incomplete) | planned (not started).
export const MODULES = [
  { key: 'dashboard', label: 'Dashboard', path: '/', status: 'partial', phase: 1, summary: 'Executive and role dashboards from the metrics engine. GOP, EBITDA and net profit need the Finance module.' },
  { key: 'reservations', label: 'Reservations', path: '/reservations', status: 'live', phase: 1, summary: 'Bookings, multi-room and group reservations, quotes, modifications, cancellation and no-show with policy fees.' },
  { key: 'calendar', label: 'Calendar', path: '/calendar', status: 'live', phase: 1, summary: 'Timeline by room with drag-and-drop moves validated on the server, splits, blocks, unassigned bookings and availability.' },
  { key: 'frontdesk', label: 'Front Desk', path: '/front-desk', status: 'live', phase: 1, summary: 'Arrivals, in-house, departures, check-in/out, walk-ins, room moves, guest requests, cashier shifts, night audit.' },
  { key: 'rooms', label: 'Rooms', path: '/rooms', status: 'live', phase: 1, summary: 'Room types, individual room profiles with inherited amenities and exceptions, floor view, out-of-order blocks.' },
  { key: 'housekeeping', label: 'Housekeeping', path: '/housekeeping', status: 'partial', phase: 2, summary: 'Room status, schedule, attendant tasks and supervisor inspection. Linen, minibar, lost & found and supplies are planned.' },
  { key: 'guests', label: 'Guests', path: '/guests', status: 'partial', phase: 1, summary: 'Profiles, stay history, identity capture, consent, export and erasure, companies. Loyalty and segmentation are planned.' },
  { key: 'revenue', label: 'Revenue', path: '/revenue', status: 'partial', phase: 5, summary: 'Rate plans, rate grid and restrictions are live. Forecasting and dynamic pricing are Phase 5.' },
  { key: 'channels', label: 'Channel Manager', path: '/channels', status: 'planned', phase: 5, summary: 'OTA connectivity through certified adapters with a simulator until credentials exist. Not started.' },
  { key: 'pos', label: 'POS & F&B', path: '/pos', status: 'planned', phase: 3, summary: 'Outlets, orders, KOT/KDS, recipes and menu engineering. Not started; F&B can be charged to folios today.' },
  { key: 'finance', label: 'Finance', path: '/finance', status: 'partial', phase: 4, summary: 'Accounting-backed folios, general ledger, trial balance, city ledger and reconciliation. OPEX, CAPEX, budgets and P&L are Phase 4.' },
  { key: 'inventory', label: 'Inventory', path: '/inventory', status: 'planned', phase: 3, summary: 'Items, procurement, stock ledger and central kitchen. Not started.' },
  { key: 'operations', label: 'Operations', path: '/operations', status: 'planned', phase: 6, summary: 'Maintenance and engineering, banquets and events, spa. Not started.' },
  { key: 'reports', label: 'Reports', path: '/reports', status: 'partial', phase: 1, summary: 'Manager report, revenue drill-down, reservation and invoice registers with CSV export. Scheduled and custom reports are planned.' },
  { key: 'multiproperty', label: 'Multi-Property', path: '/portfolio', status: 'partial', phase: 6, summary: 'Portfolio comparison with weighted consolidation and currency conversion. Central approvals and intercompany are planned.' },
];
