// Dashboard: one page, role-aware sections. Every figure comes from the metrics engine;
// cards drill down to their source rows; metrics without a live source say why.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, BedDouble, CalendarCheck, CalendarX, Coins, Hotel, Percent, TrendingUp } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, usePref } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { date, dayName, money, moneyCompact, monthLabel, number, pct } from '../lib/format.js';
import { Async, Badge, Card, Delta, Empty, Kpi, Notice, PageHead } from '../components/ui.jsx';
import { Columns, Donut, HBars, LineChart, SERIES } from '../components/charts.jsx';
import { Drilldown, PeriodPicker, periodQuery } from '../components/Metrics.jsx';

const TITLES = {
  executive: ['Executive Dashboard', 'Portfolio performance and key metrics'],
  finance: ['Financial Overview', 'Revenue, receivables and reconciliation-backed figures'],
  revenue: ['Revenue Dashboard', 'Occupancy, rate and channel performance'],
  operations: ['Front Office Dashboard', 'Today’s operations and the days ahead'],
  housekeeping: ['Housekeeping Overview', 'Room readiness and today’s workload'],
  fnb: ['F&B Dashboard', 'Food and beverage charged to guest folios'],
  procurement: ['Procurement Dashboard', 'Portfolio activity'],
  banquets: ['Banquets Dashboard', 'Events and group business'],
};

// The trend subtitle says plainly when months are missing or incomplete.
function trendSub(d) {
  const parts = ['Total operating revenue by month vs the same month a year earlier'];
  const first = d.trend.find((m) => m.current);
  if (first && first !== d.trend[0]) parts.push(`records begin ${monthLabel(first.bucket)}`);
  if (d.trend[11]?.monthToDate) parts.push(`${monthLabel(d.trend[11].bucket)} is month to date`);
  return parts.join(' · ');
}

export default function Dashboard() {
  const { scope, property, properties, can, user, opProperty } = useApp();
  const [period, setPeriod] = usePref('dash-period', { preset: 'mtd', compare: 'previous' });
  const [drill, setDrill] = useState(null);
  const q = useApi(`/dashboard${qs({ property: scope, ...periodQuery(period) })}`);
  const money$ = can('dashboard.financial');
  const scopeName = property ? property.name : properties.length > 1 ? `All ${properties.length} properties` : properties[0]?.name;
  const view = q.data?.view || 'executive';
  const [title, sub] = TITLES[view] || TITLES.executive;
  return (
    <>
      <PageHead title={title} sub={`${sub} · ${scopeName}`}>
        <PeriodPicker value={period} onChange={setPeriod} />
      </PageHead>
      <Async q={q}>
        {(d) => (
          <DashboardBody
            d={d}
            view={view}
            money$={money$}
            user={user}
            onDrill={(metric, label) => setDrill({ metric, label })}
            opProperty={property || opProperty}
            multi={!property && properties.length > 1}
          />
        )}
      </Async>
      {drill && q.data && (
        <Drilldown metric={drill.metric} title={drill.label} scope={scope} period={period} currency={q.data.reportingCurrency} onClose={() => setDrill(null)} />
      )}
    </>
  );
}

function DashboardBody({ d, view, money$, onDrill, opProperty, multi }) {
  const k = d.kpis;
  const ccy = d.reportingCurrency;
  const dl = d.deltas || {};
  const cmpLabel = d.compare ? (d.compare.mode === 'last_year' ? 'vs last year' : 'vs prev.') : null;
  const ops = view === 'operations' || view === 'housekeeping';
  const periodText = `${date(d.period.from)} – ${date(d.period.to)}`;
  return (
    <div className="stack">
      {d.provisional && (
        <Notice tone="warn">
          The period includes today’s open business day: room revenue for tonight is estimated from rates on the books until the night audit posts it.
        </Notice>
      )}
      {d.fx?.length > 0 && money$ && (
        <div className="small muted">
          Consolidated in {ccy}. Euro amounts converted at monthly demo rates ({d.fx.slice(0, 2).map((f) => `${f.pair}: ${f.rate.toFixed(2)}`).join(', ')}{d.fx.length > 2 ? ', …' : ''}).
        </div>
      )}
      <div className="kpi-strip">
        {money$ && (
          <Kpi
            icon={Coins}
            label="Total operating revenue"
            value={moneyCompact(k.total_operating_revenue, ccy)}
            onClick={() => onDrill('total_operating_revenue', 'Total operating revenue')}
            foot={cmpLabel && <Delta change={dl.total_operating_revenue} suffix={cmpLabel} />}
          />
        )}
        <Kpi
          icon={Percent}
          label="Occupancy"
          value={pct(k.occupancy_pct)}
          onClick={() => onDrill('occupancy_pct', 'Occupancy — sold room nights')}
          foot={cmpLabel && <Delta change={dl.occupancy_pct} isPercent suffix={cmpLabel} />}
        />
        {money$ && (
          <Kpi icon={BedDouble} label="ADR / ARR" value={money(k.adr, ccy, { decimals: 0 })} onClick={() => onDrill('adr', 'ADR — room revenue by night')} foot={cmpLabel && <Delta change={dl.adr} suffix={cmpLabel} />} />
        )}
        {money$ && (
          <Kpi icon={TrendingUp} label="RevPAR" value={money(k.revpar, ccy, { decimals: 0 })} onClick={() => onDrill('room_revenue', 'Room revenue')} foot={cmpLabel && <Delta change={dl.revpar} suffix={cmpLabel} />} />
        )}
        {money$ && (
          <Kpi icon={TrendingUp} label="TRevPAR" value={money(k.trevpar, ccy, { decimals: 0 })} onClick={() => onDrill('total_operating_revenue', 'Total operating revenue')} foot={cmpLabel && <Delta change={dl.trevpar} suffix={cmpLabel} />} />
        )}
        <Kpi
          icon={Hotel}
          label="Room nights sold"
          value={number(k.sold_room_nights)}
          onClick={() => onDrill('sold_room_nights', 'Sold room nights')}
          foot={<span>of {number(k.available_room_nights)} available</span>}
        />
        {!money$ && <Kpi icon={CalendarCheck} label="ALOS" value={k.alos == null ? '—' : `${number(k.alos, 2)} nights`} foot={cmpLabel && <Delta change={dl.alos} suffix={cmpLabel} />} />}
        {!money$ && <Kpi icon={CalendarX} label="Cancellation rate" value={pct(k.cancellation_rate_pct)} foot={cmpLabel && <Delta change={dl.cancellation_rate_pct} isPercent good={false} suffix={cmpLabel} />} />}
        {!money$ && <Kpi icon={CalendarX} label="No-show rate" value={pct(k.no_show_rate_pct)} foot={cmpLabel && <Delta change={dl.no_show_rate_pct} isPercent good={false} suffix={cmpLabel} />} />}
      </div>

      {ops ? (
        <>
          <TodayOps d={d} />
          <Forecast property={opProperty} />
        </>
      ) : (
        <>
          <div className="grid g-2-1">
            {money$ ? (
              <Card title="Revenue trend" sub={trendSub(d)}>
                <LineChart
                  labels={d.trend.map((m) => monthLabel(m.bucket))}
                  notes={d.trend.map((m) => (m.monthToDate ? 'month to date' : m.current?.partial ? 'records begin mid-month' : ''))}
                  series={[
                    { key: 'cur', label: 'Total revenue', color: 'var(--series-1)', values: d.trend.map((m) => m.current?.total_operating_revenue ?? null), area: true },
                    { key: 'room', label: 'Room revenue', color: 'var(--series-3)', values: d.trend.map((m) => m.current?.room_revenue ?? null) },
                    { key: 'prior', label: 'Total revenue, prior year', color: 'var(--series-muted)', muted: true, values: d.trend.map((m) => m.prior?.total_operating_revenue ?? null) },
                  ]}
                  format={(v) => moneyCompact(v, ccy)}
                />
              </Card>
            ) : (
              <Card title="Occupancy by day" sub={periodText}>
                <Columns bars={d.daily.map((p) => ({ label: p.bucket.slice(8), value: p.occupancy_pct, note: date(p.bucket) }))} format={(v) => pct(v)} axisFormat={(v) => `${v}%`} />
              </Card>
            )}
            {money$ ? (
              <Card title="Revenue by department" sub={periodText}>
                <Donut
                  data={[
                    { label: 'Rooms', value: k.room_revenue + k.rooms_other_revenue, color: SERIES[0] },
                    { label: 'F&B', value: k.fnb_revenue, color: SERIES[1] },
                    { label: 'Banquets', value: k.banquet_revenue, color: SERIES[2] },
                    { label: 'Spa', value: k.spa_revenue, color: SERIES[3] },
                    { label: 'Other', value: k.other_revenue, color: SERIES[4] },
                  ]}
                  center={moneyCompact(k.total_operating_revenue, ccy)}
                  sub="Total revenue"
                  format={(v) => moneyCompact(v, ccy)}
                />
              </Card>
            ) : (
              <Card title="Stay pattern" sub={periodText}>
                <div className="dl">
                  <dt>Average length of stay</dt>
                  <dd>{k.alos == null ? '—' : `${number(k.alos, 2)} nights`}</dd>
                  <dt>Direct booking share</dt>
                  <dd>{pct(k.direct_pct)}</dd>
                  <dt>Arrivals expected</dt>
                  <dd>{number(k.arrivals_expected)}</dd>
                  <dt>Cancelled</dt>
                  <dd>{number(k.arrivals_cancelled)}</dd>
                  <dt>No-shows</dt>
                  <dd>{number(k.no_shows)}</dd>
                </div>
              </Card>
            )}
          </div>

          <div className="kpi-strip">
            <Kpi label="ALOS" value={k.alos == null ? '—' : `${number(k.alos, 2)} nights`} onClick={() => onDrill('alos', 'Departed stays')} foot={cmpLabel && <Delta change={dl.alos} suffix={cmpLabel} />} />
            <Kpi label="Cancellation rate" value={pct(k.cancellation_rate_pct)} onClick={() => onDrill('cancellation_rate_pct', 'Cancelled reservations')} foot={cmpLabel && <Delta change={dl.cancellation_rate_pct} isPercent good={false} suffix={cmpLabel} />} />
            <Kpi label="No-show rate" value={pct(k.no_show_rate_pct)} onClick={() => onDrill('no_show_rate_pct', 'No-shows')} foot={cmpLabel && <Delta change={dl.no_show_rate_pct} isPercent good={false} suffix={cmpLabel} />} />
            <Kpi label="Direct booking share" value={pct(k.direct_pct)} onClick={() => onDrill('direct_pct', 'Sold room nights by source')} foot={cmpLabel && <Delta change={dl.direct_pct} isPercent suffix={cmpLabel} />} />
            {money$ && <Kpi label="OTA & agent commission" value={moneyCompact(k.commission_cost, ccy)} title="Estimated from contracted commission rates until channel invoices are reconciled" foot={<Badge tone="warn">Estimated</Badge>} />}
            {money$ && <Kpi label="Net room revenue" value={moneyCompact(k.net_room_revenue, ccy)} foot={<span>after distribution cost</span>} />}
          </div>

          {multi && <PropertyTable d={d} money$={money$} />}

          <div className="grid g2">
            {money$ && d.breakdowns && (
              <Card title="Room revenue by booking source" sub={periodText}>
                {d.breakdowns.bySource.length ? (
                  <HBars bars={d.breakdowns.bySource.slice(0, 8).map((s) => ({ label: s.source, value: s.revenue, sub: `${number(s.nights)} nights` }))} format={(v) => moneyCompact(v, ccy)} />
                ) : (
                  <Empty title="No room revenue in this period" />
                )}
              </Card>
            )}
            {money$ && d.breakdowns && (
              <Card title="Room revenue by room type" sub={periodText}>
                {d.breakdowns.byRoomType.length ? (
                  <HBars bars={d.breakdowns.byRoomType.slice(0, 8).map((s) => ({ label: s.room_type, value: s.revenue, sub: `${number(s.nights)} nights · ADR ${money(s.nights ? s.revenue / s.nights : null, ccy, { decimals: 0 })}` }))} format={(v) => moneyCompact(v, ccy)} color="var(--series-3)" />
                ) : (
                  <Empty title="No room revenue in this period" />
                )}
              </Card>
            )}
          </div>

          <TodayOps d={d} />
          {money$ && <Unavailable list={d.unavailable} />}
        </>
      )}
    </div>
  );
}

function PropertyTable({ d, money$ }) {
  const navigate = useNavigate();
  const { setScope } = useApp();
  const ccy = d.reportingCurrency;
  return (
    <Card title="Properties" sub="Weighted figures in the reporting currency; click a property to focus on it" flush>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Property</th>
              <th className="num">Occupancy</th>
              {money$ && <th className="num">ADR</th>}
              {money$ && <th className="num">RevPAR</th>}
              {money$ && <th className="num">TRevPAR</th>}
              {money$ && <th className="num">Total revenue</th>}
              <th className="num">Sold / available</th>
              {money$ && <th className="num">Revenue change</th>}
            </tr>
          </thead>
          <tbody>
            {d.properties.map((p) => {
              const m = p.reporting;
              const prior = p.prior;
              const chg = prior?.total_operating_revenue ? ((m.total_operating_revenue - prior.total_operating_revenue) / prior.total_operating_revenue) * 100 : null;
              return (
                <tr
                  key={p.id}
                  className="clickable"
                  onClick={() => {
                    setScope(String(p.id));
                    navigate('/');
                  }}
                >
                  <td>
                    <b>{p.name}</b>
                    <div className="sub">
                      {p.code} · {p.currency}
                      {p.currency !== ccy && money$ && ` · local ${moneyCompact(p.metrics.total_operating_revenue, p.currency)}`}
                    </div>
                  </td>
                  <td className="num">{pct(m.occupancy_pct)}</td>
                  {money$ && <td className="num">{money(m.adr, ccy, { decimals: 0 })}</td>}
                  {money$ && <td className="num">{money(m.revpar, ccy, { decimals: 0 })}</td>}
                  {money$ && <td className="num">{money(m.trevpar, ccy, { decimals: 0 })}</td>}
                  {money$ && <td className="num">{moneyCompact(m.total_operating_revenue, ccy)}</td>}
                  <td className="num">
                    {number(m.sold_room_nights)} / {number(m.available_room_nights)}
                  </td>
                  {money$ && <td className="num">{chg == null ? '—' : <Delta change={{ abs: 1, pct: chg }} />}</td>}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Portfolio (weighted)</td>
              <td className="num">{pct(d.kpis.occupancy_pct)}</td>
              {money$ && <td className="num">{money(d.kpis.adr, ccy, { decimals: 0 })}</td>}
              {money$ && <td className="num">{money(d.kpis.revpar, ccy, { decimals: 0 })}</td>}
              {money$ && <td className="num">{money(d.kpis.trevpar, ccy, { decimals: 0 })}</td>}
              {money$ && <td className="num">{moneyCompact(d.kpis.total_operating_revenue, ccy)}</td>}
              <td className="num">
                {number(d.kpis.sold_room_nights)} / {number(d.kpis.available_room_nights)}
              </td>
              {money$ && <td className="num">{d.deltas ? <Delta change={d.deltas.total_operating_revenue} /> : '—'}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function TodayOps({ d }) {
  return (
    <div className="grid g-2-1">
      <Card title="Today’s operations" sub="Each property on its own business date" flush>
        <div className="table-wrap">
          <table className="table ops-table">
            <thead>
              <tr>
                <th>Property</th>
                <th className="num">Arrivals</th>
                <th className="num">Departures</th>
                <th className="num">In house</th>
                <th className="num">Tonight</th>
                <th className="num">Dirty rooms</th>
                <th className="num">Out of order</th>
                <th className="num">Open requests</th>
              </tr>
            </thead>
            <tbody>
              {d.today.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/front-desk?property=${p.id}`}>
                      <b>{p.name}</b>
                    </Link>
                    <div className="sub">Business date {date(p.business_date)}</div>
                  </td>
                  <td className="num">
                    {p.arrived}/{p.arrivals}
                  </td>
                  <td className="num">
                    {p.departed}/{p.departures}
                  </td>
                  <td className="num">{p.in_house}</td>
                  <td className="num">
                    {pct(p.rooms ? (p.rooms_tonight / p.rooms) * 100 : null, 0)}
                    <div className="sub">
                      {p.rooms_tonight}/{p.rooms} rooms
                    </div>
                  </td>
                  <td className="num">{p.dirty}</td>
                  <td className="num">{p.ooo}</td>
                  <td className="num">{p.open_requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Needs attention" sub={`${d.alerts.length} item(s)`}>
        {d.alerts.length ? (
          d.alerts.map((a, i) => (
            <div className="alert-item" key={i}>
              <span className={`lvl ${a.level}`} aria-hidden />
              <div style={{ flex: 1 }}>
                <span className="sr-only">{a.level}: </span>
                {a.text}
              </div>
              {a.link && (
                <Link to={a.link} className="small">
                  Open
                </Link>
              )}
            </div>
          ))
        ) : (
          <Empty icon={AlertTriangle} title="Nothing needs attention" />
        )}
      </Card>
    </div>
  );
}

function Forecast({ property }) {
  const q = useApi(property ? `/frontdesk/forecast${qs({ property: property.id, days: 14 })}` : null);
  return (
    <Card title={`House forecast — ${property?.name || ''}`} sub="Next 14 nights from reservations on the books" flush>
      <Async q={q}>
        {(rows) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  {rows.map((r) => (
                    <th key={r.night} className="num">
                      {dayName(r.night)} {r.night.slice(8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Occupancy', (r) => pct(r.occupancy_pct, 0)],
                  ['Rooms occupied', (r) => r.occupied],
                  ['Available', (r) => r.available],
                  ['Arrivals', (r) => r.arrivals],
                  ['Departures', (r) => r.departures],
                  ['Guests', (r) => r.guests],
                  ['Out of order', (r) => r.blocked],
                ].map(([label, fn]) => (
                  <tr key={label}>
                    <td className="strong">{label}</td>
                    {rows.map((r) => (
                      <td key={r.night} className="num">
                        {fn(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
    </Card>
  );
}

function Unavailable({ list }) {
  const items = useMemo(() => list || [], [list]);
  return (
    <Card title="Profitability metrics" sub="Shown only when their source data is live — never estimated">
      <ul className="list-plain unavail-list">
        {items.map((u) => (
          <li key={u.metric}>
            <Badge>Not available yet</Badge>
            <div>
              <b>{u.metric}</b>
              <div className="small muted">{u.reason}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
