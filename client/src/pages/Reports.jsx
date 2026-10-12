import { useState } from 'react';
import { Users, TrendingDown, IndianRupee, Wallet, Download, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi } from '../lib/hooks.js';
import { download } from '../lib/api.js';
import { inrShort, inr } from '../lib/format.js';
import { Card, Kpi, Button, Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { Bars, LineChart, Donut, Legend, HBars } from '../components/charts.jsx';

export default function Reports() {
  const { meta } = useApp();
  const { data, error, reload } = useApi('/reports/summary');
  const { data: runs } = useApi('/payroll?month=' + meta.today.slice(0, 7));
  const [month, setMonth] = useState(meta.today.slice(0, 7));
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const last = [...data.months].reverse().find((m) => m.payrollCost != null);
  const withPay = data.months.filter((m) => m.payrollCost != null);
  const downloads = [
    ['Employee master', 'Every employee with job, statutory and bank details', '/employees/export.csv'],
    ['Headcount by vertical, department and location', 'Current headcount, gender split and average CTC', '/reports/headcount.csv'],
    ['Attendance register', 'Day-by-day attendance with LOP days for the month below', `/attendance/export.csv?month=${month}`],
    ['Leave register', 'Entitled, used and available leave by type', '/reports/leave-register.csv'],
    ['Leave requests', 'Every leave request with status', '/reports/leave-requests.csv'],
    ['Candidates', 'Hiring pipeline with sources, match scores and offers', '/reports/hiring.csv'],
    ['Resignations', 'Exits with reasons, rehire eligibility and settlements', '/reports/attrition.csv'],
    ['Performance', 'Ratings for every review cycle', '/reports/performance.csv'],
  ];
  return (
    <div>
      <div className="page-head"><div><h1>Reports</h1><div className="sub">Workforce trends and downloadable registers for audits and planning.</div></div></div>
      <div className="kpis">
        <Kpi icon={Users} tone="blue" label="Headcount" value={data.headcount} />
        <Kpi icon={TrendingDown} tone="red" label="Attrition (last 12 months)" value={`${data.annualAttrition}%`} />
        <Kpi icon={IndianRupee} tone="green" label="Annual CTC (current staff)" value={inrShort(data.totalCtc)} />
        <Kpi icon={Wallet} tone="amber" label={`Payroll cost (${last?.label || '—'})`} value={last ? inrShort(last.payrollCost) : '—'} />
      </div>
      <div className="grid">
        <Card className="span-6" title="Headcount, last 12 months">
          <LineChart height={210} categories={data.months.map((m) => m.label)} series={[{ name: 'Headcount', color: '#1A6DF0', values: data.months.map((m) => m.headcount) }]} min={Math.max(0, Math.floor((Math.min(...data.months.map((m) => m.headcount)) - 10) / 10) * 10)} format={(v) => String(Math.round(v))} />
        </Card>
        <Card className="span-6" title="Joiners and exits">
          <div className="row small mb-8" style={{ gap: 14 }}><span className="row gap-6"><span className="dot" style={{ background: '#1A6DF0' }} />Joiners</span><span className="row gap-6"><span className="dot" style={{ background: '#E5243B' }} />Exits</span></div>
          <Bars height={190} categories={data.months.map((m) => m.label)} series={[{ name: 'Joiners', color: '#1A6DF0', values: data.months.map((m) => m.joins) }, { name: 'Exits', color: '#E5243B', values: data.months.map((m) => m.exits) }]} />
        </Card>
      </div>
      <div className="grid">
        <Card className="span-4" title="Headcount by vertical">
          <div className="row donut-row" style={{ gap: 16 }}><Donut size={140} thickness={20} data={data.byVertical} center={{ value: data.headcount, label: 'People' }} /><Legend items={data.byVertical} /></div>
        </Card>
        <Card className="span-4" title="Payroll cost trend">
          {withPay.length ? <Bars height={190} categories={withPay.map((m) => m.label)} series={[{ name: 'Payroll cost', color: '#1FA855', values: withPay.map((m) => m.payrollCost) }]} tipFormat={inr} /> : <Empty text="No payroll runs yet" />}
        </Card>
        <Card className="span-4" title="Leave taken this year">
          <HBars items={data.leaveUse.map((l) => ({ label: l.name, value: l.days, color: l.color }))} format={(v) => `${v} d`} labelWidth={120} />
        </Card>
      </div>
      <Card title="Downloads" action={<label className="row small gap-6">Attendance month <input type="month" className="input sm" style={{ width: 160 }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, marginBottom: 0 }}>
          {downloads.map(([t, d, p]) => (
            <div key={t} className="card tight row" style={{ boxShadow: 'none', gap: 12 }}>
              <FileSpreadsheet size={26} className="green" style={{ flexShrink: 0 }} />
              <div className="grow" style={{ minWidth: 0 }}><div className="b6 small">{t}</div><div className="xs muted">{d}</div></div>
              <Button size="sm" icon={Download} onClick={() => download(p)}>CSV</Button>
            </div>
          ))}
          {runs?.run && <div className="card tight row" style={{ boxShadow: 'none', gap: 12 }}><FileSpreadsheet size={26} className="green" /><div className="grow"><div className="b6 small">Payroll register · {runs.label}</div><div className="xs muted">Earnings, deductions and employer cost per employee</div></div><Button size="sm" icon={Download} onClick={() => download(`/payroll/runs/${runs.run.id}/register.csv`)}>CSV</Button></div>}
        </div>
      </Card>
    </div>
  );
}
