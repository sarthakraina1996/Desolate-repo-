// A module that is not built yet says so: scope, phase and what exists today. No mock screens.
import { Link } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { useApi } from '../lib/hooks.js';
import { Async, Badge, Card, PageHead } from '../components/ui.jsx';

const DETAILS = {
  channels: {
    scope: ['OTA connection registry and credential vault', 'Room, rate and inventory mapping', 'Availability, rate and restriction updates (MLOS, max LOS, CTA, CTD, stop sell)', 'Reservation, modification and cancellation import with duplicate protection', 'Sync history, failed-sync alerts and retries', 'Commission and channel profitability, rate parity where permitted', 'Direct booking engine'],
    honest: 'No OTA connection is live. Certified adapters need contracts and credentials; until then a simulator with test accounts and failure scenarios will be provided. Scraping is never used.',
    today: 'OTA bookings in the demo are entered with their channel and channel reference; a channel reservation can only be imported once (database constraint).',
  },
  pos: {
    scope: ['Outlets, tables and covers', 'Orders with modifiers, allergens, KOT and kitchen display', 'Bill splitting, discounts, comps, taxes, payments and room posting', 'Recipe-linked inventory consumption', 'Day close and cashier reconciliation', 'Food/beverage cost %, prime cost, APC, AOV, RevPASH and menu engineering'],
    honest: 'Not started.',
    today: 'Restaurant, bar, in-room dining and minibar charges can be posted to guest folios with correct GST/VAT and appear in F&B revenue.',
  },
  inventory: {
    scope: ['Item, UoM, ingredient, recipe and vendor masters', 'Requisitions → approval → purchase orders → GRN → invoice match → payables', 'Stock ledger, transfers, counts, waste, expiry and batches', 'Central kitchen production and transfers'],
    honest: 'Not started.',
    today: '—',
  },
  operations: {
    scope: ['Maintenance & engineering: work orders, preventive maintenance, assets, spare parts', 'Banquets & events: calendar, halls, BEOs, deposits, contracts, event P&L', 'Spa: appointments, therapists, treatment rooms', 'Workforce: rosters, attendance and labour cost via the BrainADZ HRMS'],
    honest: 'Not started.',
    today: 'Rooms can be blocked out of order with a reason, maintenance can be flagged from housekeeping and guest requests, and banquet revenue can be posted to event (house) folios.',
  },
};

export default function Planned({ moduleKey }) {
  const q = useApi('/system/modules');
  const d = DETAILS[moduleKey];
  return (
    <Async q={q}>
      {(mods) => {
        const m = mods.find((x) => x.key === moduleKey);
        return (
          <>
            <PageHead title={m?.label || 'Module'} sub={<span className="row"><Badge>Planned — Phase {m?.phase}</Badge> {m?.summary}</span>} />
            <div className="grid g2">
              <Card title="What this module will do">
                <ul>{d.scope.map((s) => <li key={s} style={{ marginBottom: 6 }}>{s}</li>)}</ul>
              </Card>
              <div className="stack">
                <Card title="Status">
                  <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                    <Construction size={22} className="muted" />
                    <p>{d.honest}</p>
                  </div>
                </Card>
                <Card title="Available today">
                  <p className="muted">{d.today}</p>
                </Card>
                <div className="small muted">See <Link to="/settings/system">System status</Link> for every module’s status.</div>
              </div>
            </div>
          </>
        );
      }}
    </Async>
  );
}
