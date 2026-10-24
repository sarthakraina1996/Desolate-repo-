// Multi-property control: every property side by side for the chosen period, in the
// reporting currency, with weighted portfolio totals.
import { useApp } from '../context.jsx';
import { useApi, usePref } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { money, moneyCompact, number, pct } from '../lib/format.js';
import { Async, Card, Delta, Notice, PageHead } from '../components/ui.jsx';
import { HBars } from '../components/charts.jsx';
import { PeriodPicker, periodQuery } from '../components/Metrics.jsx';

export default function Portfolio() {
  const [period, setPeriod] = usePref('pf-period', { preset: 'mtd', compare: 'last_year' });
  const q = useApi(`/metrics/kpis${qs({ property: 'all', ...periodQuery(period) })}`);
  const { properties } = useApp();
  return (
    <>
      <PageHead title="Multi-Property" sub={`${properties.length} ${properties.length === 1 ? 'property' : 'properties'} · weighted consolidation in the reporting currency`}>
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHead>
      <Async q={q}>
        {(d) => {
          const ccy = d.reportingCurrency;
          const rows = d.properties.map((p) => ({ ...p, prior: d.prior?.properties.find((x) => x.id === p.id)?.reporting }));
          const by = (k) => rows.map((p) => ({ label: p.name, value: p.reporting[k] }));
          return (
            <div className="stack">
              <Notice>Portfolio ratios are computed from summed rooms and revenue (weighted), never by averaging property percentages. {d.fx.length ? `EUR converted at monthly demo rates.` : ''}</Notice>
              <div className="grid g3">
                <Card title="Occupancy">
                  <HBars bars={by('occupancy_pct')} format={(v) => pct(v)} max={100} />
                </Card>
                <Card title="RevPAR">
                  <HBars bars={by('revpar')} format={(v) => money(v, ccy, { decimals: 0 })} color="var(--series-3)" />
                </Card>
                <Card title="Total operating revenue">
                  <HBars bars={by('total_operating_revenue')} format={(v) => moneyCompact(v, ccy)} color="var(--series-2)" />
                </Card>
              </div>
              <Card title="Property comparison" flush>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th className="num">Rooms avail.</th>
                        <th className="num">Sold</th>
                        <th className="num">Occupancy</th>
                        <th className="num">ADR</th>
                        <th className="num">RevPAR</th>
                        <th className="num">TRevPAR</th>
                        <th className="num">Rooms revenue</th>
                        <th className="num">F&B</th>
                        <th className="num">Total revenue</th>
                        <th className="num">vs {d.compare?.mode === 'last_year' ? 'LY' : 'prev.'}</th>
                        <th className="num">ALOS</th>
                        <th className="num">Direct</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id}>
                          <td><b>{p.name}</b><div className="sub">{p.code} · local {p.currency}</div></td>
                          <td className="num">{number(p.reporting.available_room_nights)}</td>
                          <td className="num">{number(p.reporting.sold_room_nights)}</td>
                          <td className="num">{pct(p.reporting.occupancy_pct)}</td>
                          <td className="num">{money(p.reporting.adr, ccy, { decimals: 0 })}</td>
                          <td className="num">{money(p.reporting.revpar, ccy, { decimals: 0 })}</td>
                          <td className="num">{money(p.reporting.trevpar, ccy, { decimals: 0 })}</td>
                          <td className="num">{moneyCompact(p.reporting.room_revenue, ccy)}</td>
                          <td className="num">{moneyCompact(p.reporting.fnb_revenue, ccy)}</td>
                          <td className="num">{moneyCompact(p.reporting.total_operating_revenue, ccy)}</td>
                          <td className="num">{p.prior ? <Delta change={{ abs: 1, pct: p.prior.total_operating_revenue ? ((p.reporting.total_operating_revenue - p.prior.total_operating_revenue) / p.prior.total_operating_revenue) * 100 : null }} /> : '—'}</td>
                          <td className="num">{number(p.reporting.alos, 2)}</td>
                          <td className="num">{pct(p.reporting.direct_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Portfolio</td>
                        <td className="num">{number(d.consolidated.metrics.available_room_nights)}</td>
                        <td className="num">{number(d.consolidated.metrics.sold_room_nights)}</td>
                        <td className="num">{pct(d.consolidated.metrics.occupancy_pct)}</td>
                        <td className="num">{money(d.consolidated.metrics.adr, ccy, { decimals: 0 })}</td>
                        <td className="num">{money(d.consolidated.metrics.revpar, ccy, { decimals: 0 })}</td>
                        <td className="num">{money(d.consolidated.metrics.trevpar, ccy, { decimals: 0 })}</td>
                        <td className="num">{moneyCompact(d.consolidated.metrics.room_revenue, ccy)}</td>
                        <td className="num">{moneyCompact(d.consolidated.metrics.fnb_revenue, ccy)}</td>
                        <td className="num">{moneyCompact(d.consolidated.metrics.total_operating_revenue, ccy)}</td>
                        <td className="num">{d.deltas ? <Delta change={d.deltas.total_operating_revenue} /> : '—'}</td>
                        <td className="num">{number(d.consolidated.metrics.alos, 2)}</td>
                        <td className="num">{pct(d.consolidated.metrics.direct_pct)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
              <Card title="Planned for multi-property control">
                <p className="muted">Central approvals, shared procurement, intercompany accounting and consolidated P&L arrive with Phases 4 and 6.</p>
              </Card>
            </div>
          );
        }}
      </Async>
    </>
  );
}
