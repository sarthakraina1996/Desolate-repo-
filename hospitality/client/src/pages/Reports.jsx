// Reports: the manager's report (day / month / year to date) and monthly revenue by
// department, both exportable. Scheduled and custom reports are planned.
import { useState } from 'react';
import { useApp } from '../context.jsx';
import { useApi, usePref } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { date, money, monthLabel, number, pct } from '../lib/format.js';
import { Async, Card, Notice, PageHead, Select, Tabs } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';

const ROWS = [
  ['available_room_nights', 'Rooms available', (v) => number(v)],
  ['sold_room_nights', 'Rooms sold', (v) => number(v)],
  ['comp_room_nights', 'Complimentary rooms', (v) => number(v)],
  ['ooo_room_nights', 'Out-of-order room nights', (v) => number(v)],
  ['occupancy_pct', 'Occupancy %', (v) => pct(v)],
  ['adr', 'ADR', (v, c) => money(v, c, { decimals: 0 })],
  ['revpar', 'RevPAR', (v, c) => money(v, c, { decimals: 0 })],
  ['trevpar', 'TRevPAR', (v, c) => money(v, c, { decimals: 0 })],
  ['room_revenue', 'Room revenue', (v, c) => money(v, c, { decimals: 0 })],
  ['fnb_revenue', 'F&B revenue', (v, c) => money(v, c, { decimals: 0 })],
  ['banquet_revenue', 'Banquet revenue', (v, c) => money(v, c, { decimals: 0 })],
  ['spa_revenue', 'Spa revenue', (v, c) => money(v, c, { decimals: 0 })],
  ['other_revenue', 'Other revenue', (v, c) => money(v, c, { decimals: 0 })],
  ['total_operating_revenue', 'Total operating revenue', (v, c) => money(v, c, { decimals: 0 })],
  ['arrivals_expected', 'Arrivals', (v) => number(v)],
  ['stays_departed', 'Departed stays', (v) => number(v)],
  ['no_shows', 'No-shows', (v) => number(v)],
  ['arrivals_cancelled', 'Cancellations (by arrival date)', (v) => number(v)],
  ['alos', 'ALOS (nights)', (v) => number(v, 2)],
  ['direct_pct', 'Direct booking share', (v) => pct(v)],
];

export default function Reports() {
  const [tab, setTab] = usePref('rep-tab', 'manager');
  return (
    <>
      <PageHead title="Reports" sub="Figures from the metrics engine; every number is reproducible from its source rows" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'manager', label: 'Manager’s report' }, { value: 'monthly', label: 'Monthly revenue by department' }, { value: 'planned', label: 'Scheduled & custom reports' }]} />
      {tab === 'manager' && <ManagerReport />}
      {tab === 'monthly' && <Monthly />}
      {tab === 'planned' && (
        <Card title="Planned">
          <p className="muted">Scheduled e-mail reports, saved filters, custom report builder and PDF/Excel exports of every register are part of Reports & BI (Phase 6). Today every table offers CSV export.</p>
        </Card>
      )}
    </>
  );
}

// Days before a property's first record are excluded, and a period with no records shows "—".
function CoverageNote({ kpis }) {
  const starts = kpis.flatMap((k) => [k.coverage, k.prior?.coverage]).filter((c) => c?.partial).map((c) => c.from);
  const empty = kpis.some((k) => k.prior && !k.prior.coverage);
  if (!starts.length && !empty) return null;
  const first = kpis[2].properties.map((p) => p.recordsFrom).sort()[0];
  return (
    <div style={{ padding: '0 16px 12px' }}>
      <Notice>
        Records in this system begin {date(first)}. Earlier days are left out of every figure rather than counted as zero; columns with no records show “—”.
      </Notice>
    </div>
  );
}

function ManagerReport() {
  const { scope, property, properties } = useApp();
  const y = useApi(`/metrics/kpis${qs({ property: scope, preset: 'yesterday', compare: 'last_year' })}`);
  const m = useApi(`/metrics/kpis${qs({ property: scope, preset: 'mtd', compare: 'last_year' })}`);
  const a = useApi(`/metrics/kpis${qs({ property: scope, preset: 'fy', compare: 'last_year' })}`);
  const ready = y.data && m.data && a.data;
  const ccy = y.data?.reportingCurrency;
  const rows = ready
    ? ROWS.map(([k, label, f]) => ({
        id: k,
        label,
        day: f(y.data.consolidated.metrics[k], ccy),
        dayLy: f(y.data.prior?.consolidated?.[k], ccy),
        mtd: f(m.data.consolidated.metrics[k], ccy),
        mtdLy: f(m.data.prior?.consolidated?.[k], ccy),
        ytd: f(a.data.consolidated.metrics[k], ccy),
        ytdLy: f(a.data.prior?.consolidated?.[k], ccy),
      }))
    : [];
  return (
    <Card
      title={`Manager’s report — ${property ? property.name : `all ${properties.length} properties`}`}
      sub={ready ? `Day ${date(y.data.period.from)} · month to date · financial year to date (${date(a.data.period.from)} – ${date(a.data.period.to)}), each vs the same period last year${ccy ? ` · ${ccy}` : ''}` : 'Loading…'}
      flush
    >
      {ready && <CoverageNote kpis={[y.data, m.data, a.data]} />}
      <Async q={a}>
        {() => (
          <DataTable
            rows={rows}
            pageSize={50}
            exportName="managers-report.csv"
            columns={[
              { key: 'label', label: 'Measure', sortable: false, render: (r) => <b>{r.label}</b> },
              { key: 'day', label: 'Day', num: true, sortable: false },
              { key: 'dayLy', label: 'Day LY', num: true, sortable: false },
              { key: 'mtd', label: 'MTD', num: true, sortable: false },
              { key: 'mtdLy', label: 'MTD LY', num: true, sortable: false },
              { key: 'ytd', label: 'FYTD', num: true, sortable: false },
              { key: 'ytdLy', label: 'FYTD LY', num: true, sortable: false },
            ]}
          />
        )}
      </Async>
    </Card>
  );
}

function Monthly() {
  const { scope } = useApp();
  const [preset, setPreset] = useState('fy');
  const q = useApi(`/metrics/series${qs({ property: scope, preset, granularity: 'month' })}`);
  return (
    <Card title="Monthly revenue by department" sub="Net of tax, in the reporting currency" flush action={<Select value={preset} onChange={(e) => setPreset(e.target.value)} options={[{ value: 'fy', label: 'Financial year to date' }, { value: 'ytd', label: 'Calendar year to date' }, { value: 'qtd', label: 'Quarter to date' }]} />}>
      <Async q={q}>
        {(d) => (
          <DataTable
            rows={d.points.map((p) => ({ ...p, id: p.bucket }))}
            pageSize={24}
            exportName="monthly-revenue.csv"
            columns={[
              { key: 'bucket', label: 'Month', render: (p) => monthLabel(p.bucket) },
              { key: 'sold_room_nights', label: 'Rooms sold', num: true, render: (p) => number(p.sold_room_nights) },
              { key: 'occupancy_pct', label: 'Occupancy', num: true, render: (p) => pct(p.occupancy_pct) },
              { key: 'adr', label: 'ADR', num: true, render: (p) => money(p.adr, d.reportingCurrency, { decimals: 0 }) },
              { key: 'room_revenue', label: 'Rooms', num: true, render: (p) => money(p.room_revenue, d.reportingCurrency, { decimals: 0 }) },
              { key: 'fnb_revenue', label: 'F&B', num: true, render: (p) => money(p.fnb_revenue, d.reportingCurrency, { decimals: 0 }) },
              { key: 'banquet_revenue', label: 'Banquets', num: true, render: (p) => money(p.banquet_revenue, d.reportingCurrency, { decimals: 0 }) },
              { key: 'spa_revenue', label: 'Spa', num: true, render: (p) => money(p.spa_revenue, d.reportingCurrency, { decimals: 0 }) },
              { key: 'other_revenue', label: 'Other', num: true, render: (p) => money(p.other_revenue, d.reportingCurrency, { decimals: 0 }) },
              { key: 'total_operating_revenue', label: 'Total', num: true, render: (p) => <b>{money(p.total_operating_revenue, d.reportingCurrency, { decimals: 0 })}</b> },
            ]}
          />
        )}
      </Async>
    </Card>
  );
}
