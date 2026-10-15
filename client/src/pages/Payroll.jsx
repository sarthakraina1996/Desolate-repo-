import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Banknote, Users, FileClock, Play, RefreshCw, Download, TriangleAlert, Info, CircleCheck, Plus, Wallet, Send, Undo2, Trash2,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { inr, inrShort, fmtDate, fmtMonth, addMonths, fmtShort } from '../lib/format.js';
import { Card, Kpi, Badge, Button, Empty, Loading, ErrorBox, Person, Modal, Select, Pagination, useConfirm, Menu } from '../components/ui.jsx';
import { Steps, Donut, Legend, Bars, Ring, CAT, STATUS } from '../components/charts.jsx';
import { BrandBanner } from '../components/Layout.jsx';
import { ClaimModal } from '../components/forms.jsx';

export default function Payroll() {
  const { meta, vertical, toast, isAdmin } = useApp();
  const [sp, setSp] = useSearchParams();
  const month = sp.get('month') || meta.today.slice(0, 7);
  const [dept, setDept] = useState('');
  const [loc, setLoc] = useState('');
  const qs = new URLSearchParams({ month, ...(vertical ? { vertical } : {}), ...(dept ? { department: dept } : {}), ...(loc ? { location: loc } : {}) });
  const { data, error, reload } = useApi(`/payroll?${qs}`);
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  useEffect(() => setSel(null), [month]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const r = data.run;
  const status = r?.status;
  const line = data.lines.find((l) => l.employeeId === sel) || data.lines[0];
  const act = async (fn, msg) => { if (await run(fn, msg)) reload(); };
  const canRecompute = !r || ['In Review', 'Finance Reviewed'].includes(status);

  const steps = r?.steps || {};
  const stepper = [
    { label: 'Data Collation', at: steps.collation },
    { label: 'Attendance & Leave Sync', at: steps.sync },
    { label: 'Payroll Processing', at: steps.processing },
    { label: 'Approvals', at: steps.approvals },
    { label: 'Bank Transfer', at: steps.transfer },
    { label: 'Completed', at: steps.completed },
  ].map((s, i, arr) => {
    const firstOpen = arr.findIndex((x) => !x.at);
    return { label: s.label, state: s.at ? 'done' : i === firstOpen ? 'current' : 'todo', sub: s.at ? fmtShort(s.at) : i === firstOpen ? (r ? 'In Progress' : 'Not started') : '' };
  });
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Payroll <Wallet size={26} className="blue" /></h1>
          <div className="sub">Simplified. Accurate. Compliant.</div>
        </div>
        <div className="filters">
          <input type="month" className="input" style={{ width: 170 }} value={month} onChange={(e) => e.target.value && setSp({ month: e.target.value })} aria-label="Payroll month" />
          <Select value={dept} onChange={(e) => setDept(e.target.value)} placeholder="All Departments" options={meta.departments.map((d) => ({ value: d.id, label: d.name }))} />
          <Select value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="All Locations" options={meta.locations.map((l) => ({ value: l.id, label: l.name }))} />
        </div>
        <BrandBanner />
      </div>

      <div className="kpis">
        <Kpi icon={Banknote} tone="green" label="Total Payroll Cost" value={inrShort(data.kpis.cost)} delta={data.kpis.costChange} invert />
        <Kpi icon={Users} tone="blue" label={status === 'Completed' ? 'Net Pay Disbursed' : 'Net Pay'} value={inrShort(data.kpis.net)} delta={data.kpis.netChange} invert />
        <Kpi icon={FileClock} tone="red" label="Claims Awaiting Approval" value={data.kpis.pendingClaims} onClick={() => document.getElementById('adjustments')?.scrollIntoView({ behavior: 'smooth' })} />
        <div className="card kpi">
          <Ring size={76} thickness={8} value={data.kpis.completionPct} />
          <div className="grow"><div className="lbl">Payroll Completion</div><div className="b7" style={{ fontSize: 20 }}>{data.kpis.processed} / {data.kpis.eligible}</div><div className="small muted">Employees processed</div></div>
          {canRecompute
            ? <Button variant="primary" icon={r ? RefreshCw : Play} loading={busy} onClick={async () => { if (!r || await confirm({ title: 'Re-run payroll?', text: 'Payslips are recalculated from the latest attendance, leave and adjustments. Finance approval, if given, is cleared.', confirmLabel: 'Re-run' })) act(() => api.post('/payroll/runs', { month }), r ? 'Payroll recalculated' : 'Payroll processed'); }}>{r ? 'Re-run' : 'Run Payroll'}</Button>
            : <Badge tone="green" lg>{status}</Badge>}
        </div>
      </div>

      <div className="grid">
        <Card className="span-6" title={`Payroll Run Status (${fmtMonth(month)})`} action={r ? <Badge lg>{status}</Badge> : <Badge lg tone="gray">Not run</Badge>}>
          <div className="small muted right" style={{ marginTop: -8, marginBottom: 12 }}>Run ID: {data.ref}</div>
          <Steps steps={stepper} />
          {!r && <div className="alert info mt-16"><Info size={16} />Preview below uses live attendance and leave. Click <b>Run Payroll</b> to create payslips for review.</div>}
        </Card>
        <Card className="span-3" title="Payroll Calendar">
          <PayCalendar month={month} steps={steps} payDate={data.payDate} />
        </Card>
        <Card className="span-3" title="Attendance & Leave Sync">
          <div className="row" style={{ justifyContent: 'space-around' }}>
            <Ring value={data.sync.attendancePct} color={data.sync.attendancePct === 100 ? STATUS.good : STATUS.warn} label="Attendance Sync" sub={`${data.sync.attendanceSynced} / ${data.sync.eligible}`} />
            <Ring value={100} color={STATUS.good} label="Leave Sync" sub={`${data.sync.leaveRecords} leave records`} />
          </div>
          {data.sync.attendancePct < 100 && <div className="small muted mt-12 center">Unmarked days are paid as present by default (Settings → Payroll).</div>}
        </Card>
      </div>

      <div className="grid">
        <Card className="span-6" title={<>Employee Salary Details <span className="sub">({fmtMonth(month)})</span></>} action={r && <Menu items={[{ label: 'Payroll register (CSV)', icon: Download, onClick: () => download(`/payroll/runs/${r.id}/register.csv`) }, { label: 'Bank transfer file (CSV)', icon: Download, onClick: () => download(`/payroll/runs/${r.id}/bank-file.csv`) }]} />}>
          <SalaryTable lines={data.lines} selected={line?.employeeId} onSelect={setSel} canHold={r && canRecompute} onHold={(l, hold) => act(() => api.put(`/payroll/payslips/${l.payslipId}/hold`, { hold }), hold ? 'Payslip put on hold' : 'Hold released')} />
        </Card>
        <Card className="span-3" title="Salary Structure Breakdown">
          {line ? <Structure line={line} lines={data.lines} onSelect={setSel} /> : <Empty />}
        </Card>
        <Card className="span-3" title="Payslip Preview">
          {line ? <PayslipCard line={line} label={data.label} onDetails={() => setModal({ type: 'payslip', line })} /> : <Empty />}
        </Card>
      </div>

      <div className="grid">
        <Card className="span-4" title="CTC vs Net Pay Comparison">
          <div className="row small mb-8" style={{ gap: 14 }}><span className="row gap-6"><span className="dot" style={{ background: '#1A6DF0' }} />Cost to company</span><span className="row gap-6"><span className="dot" style={{ background: '#1FA855' }} />Net pay</span></div>
          {data.trend.length ? <Bars height={200} categories={data.trend.map((t) => t.label)} series={[{ name: 'Cost to company', color: '#1A6DF0', values: data.trend.map((t) => t.cost) }, { name: 'Net pay', color: '#1FA855', values: data.trend.map((t) => t.net) }]} tipFormat={inr} /> : <Empty text="Run payroll to see trends" />}
        </Card>
        <Card className="span-4" title="Compensation Insights">
          <Composition comp={data.composition} />
        </Card>
        <Card className="span-4" title="Approval Workflow">
          <Approval run={r} busy={busy} isAdmin={isAdmin}
            onApprove={(stage) => act(() => api.post(`/payroll/runs/${r.id}/approve`, { stage }), stage === 'finance' ? 'Finance review recorded' : 'Payroll approved')}
            onSendBack={() => act(() => api.post(`/payroll/runs/${r.id}/send-back`), 'Sent back for corrections')}
            onTransfer={() => act(() => api.post(`/payroll/runs/${r.id}/transfer`), 'Bank transfer scheduled')}
            onComplete={async () => { if (await confirm({ title: 'Mark salaries as paid?', text: 'Employees are notified that their payslips are available. This cannot be undone.', confirmLabel: 'Mark as paid' })) act(() => api.post(`/payroll/runs/${r.id}/complete`), 'Payroll completed. Employees notified.'); }}
            onDelete={async () => { if (await confirm({ title: 'Delete this payroll run?', text: 'Payslips for this month are removed. You can run payroll again.', danger: true, confirmLabel: 'Delete run' })) act(() => api.del(`/payroll/runs/${r.id}`), 'Payroll run deleted'); }}
          />
        </Card>
      </div>

      <div className="grid">
        <Card className="span-4" title="Statutory & Compliance"><Statutory s={data.statutory} month={month} /></Card>
        <Card className="span-4" title="Payroll Exceptions & Alerts"><Exceptions list={data.exceptions} onView={(x) => setModal({ type: 'exc', x })} /></Card>
        <Card className="span-4" title="Bank Transfer Batch Status">
          {r?.bankBatch ? (
            <div>
              <table className="table compact"><thead><tr><th>Batch ID</th><th>Bank</th><th>Employees</th><th className="num">Amount</th></tr></thead>
                <tbody><tr><td className="small">{r.bankBatch.id}</td><td>{r.bankBatch.bank}</td><td>{r.bankBatch.count}</td><td className="num">{inr(r.bankBatch.amount)}</td></tr></tbody></table>
              <div className="row between mt-12"><span className="small muted">Initiated {fmtDate(r.bankBatch.initiatedAt)} · pay date {fmtDate(r.bankBatch.payDate)}</span><Badge tone={r.bankBatch.status === 'Completed' ? 'green' : 'blue'}>{r.bankBatch.status}</Badge></div>
              <Button size="sm" icon={Download} className="mt-12" onClick={() => download(`/payroll/runs/${r.id}/bank-file.csv`)}>Bank file (CSV)</Button>
            </div>
          ) : <Empty text={r ? 'Created once the run is approved' : 'No run yet'} />}
        </Card>
      </div>

      <Card id="adjustments" title={`Bonuses, Reimbursements & Deductions (${fmtMonth(month)})`} action={<Button size="sm" variant="primary" icon={Plus} onClick={() => setModal({ type: 'claim' })}>Add adjustment</Button>}>
        <Adjustments items={data.adjustments} onChange={reload} locked={!canRecompute} />
      </Card>

      {modal?.type === 'payslip' && <Modal title={`Payslip · ${modal.line.name}`} size="wide" onClose={() => setModal(null)}><PayslipView data={modal.line.payslip} label={data.label} /></Modal>}
      {modal?.type === 'exc' && (
        <Modal title={modal.x.label} onClose={() => setModal(null)}>
          {modal.x.people.length ? modal.x.people.map((p) => <div key={p.id} className="list-item"><Person name={p.name} sub={p.code} id={p.id} size={30} /><span className="grow" /><span className="small muted">{p.text}</span></div>) : <Empty text="Nothing to fix" />}
        </Modal>
      )}
      {modal?.type === 'claim' && <ClaimModal hr onClose={() => setModal(null)} onDone={reload} />}
      {confirmEl}
    </div>
  );
}

function SalaryTable({ lines, selected, onSelect, canHold, onHold }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => lines.filter((l) => !q || `${l.name} ${l.code} ${l.department}`.toLowerCase().includes(q.toLowerCase())), [lines, q]);
  const size = 8;
  const items = filtered.slice((page - 1) * size, page * size);
  return (
    <div>
      <input className="input sm mb-12" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search employee" />
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>Employee</th><th>Emp ID</th><th className="hide-sm">Department</th><th className="num">Gross (₹)</th><th className="num">Net Pay (₹)</th><th>Status</th></tr></thead>
          <tbody>{items.map((l) => (
            <tr key={l.employeeId} className={`click ${l.employeeId === selected ? 'sel' : ''}`} onClick={() => onSelect(l.employeeId)}>
              <td><Person name={l.name} id={l.employeeId} hasPhoto={l.has_photo} size={28} link={false} /></td>
              <td className="small muted">{l.code}</td>
              <td className="hide-sm small">{l.department}</td>
              <td className="num">{inr(l.gross).replace('₹', '')}</td>
              <td className="num b6">{inr(l.net).replace('₹', '')}</td>
              <td className="nowrap"><Badge>{l.status === 'Processed' ? 'Processing' : l.status}</Badge>
                {canHold && l.payslipId && <button type="button" className="link xs" style={{ marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); onHold(l, l.status !== 'On Hold'); }}>{l.status === 'On Hold' ? 'Release' : 'Hold'}</button>}
                {l.exceptions.length > 0 && <TriangleAlert size={14} className="amber" style={{ marginLeft: 6, verticalAlign: -2 }} title={l.exceptions.map((x) => x.text).join(', ')} />}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!filtered.length && <Empty text="No employees" />}
      <Pagination page={page} pageSize={size} total={filtered.length} onPage={setPage} />
    </div>
  );
}

function Structure({ line, lines, onSelect }) {
  const p = line.payslip;
  const gross = p.gross || 1;
  const rows = [
    ['Basic Salary', p.earnings.basic], ['HRA', p.earnings.hra], ['Special Allowance', p.earnings.special], ['Performance Bonus', p.earnings.bonus], ['Reimbursements', p.earnings.reimbursement],
  ];
  const ded = [['Provident Fund (PF)', p.deductions.pf], ['ESI', p.deductions.esi], ['Professional Tax', p.deductions.pt], ['Income Tax (TDS)', p.deductions.tds], ['LWF', p.deductions.lwf], ['Other Deductions', p.deductions.other]].filter(([, v]) => v);
  return (
    <div>
      <select className="select sm mb-12" value={line.employeeId} onChange={(e) => onSelect(Number(e.target.value))}>
        {lines.map((l) => <option key={l.employeeId} value={l.employeeId}>{l.name} ({l.code})</option>)}
      </select>
      <table className="table compact">
        <tbody>
          {rows.map(([l, v]) => <tr key={l}><td>{l}</td><td className="num">{inr(v)}</td><td className="num small muted">{Math.round((v / gross) * 100)}%</td></tr>)}
          <tr style={{ background: 'var(--blue-soft)' }}><td className="b7 blue">Gross Earnings</td><td className="num b7 blue">{inr(p.totalEarnings)}</td><td className="num small blue">100%</td></tr>
          {ded.map(([l, v]) => <tr key={l}><td>{l}</td><td className="num">{inr(v)}</td><td /></tr>)}
          <tr style={{ background: 'var(--blue-soft)' }}><td className="b7 blue">Total Deductions</td><td className="num b7 blue">{inr(p.totalDeductions)}</td><td /></tr>
        </tbody>
      </table>
      <div className="row between mt-12" style={{ background: 'var(--blue-soft)', padding: '12px 14px', borderRadius: 10 }}><b className="blue">Net Pay</b><b className="blue" style={{ fontSize: 18 }}>{inr(p.net)}</b></div>
      {p.lopDays > 0 && <div className="small muted mt-8">{p.lopDays} loss-of-pay day(s) · paid days {p.paidDays}/{p.daysInMonth}</div>}
    </div>
  );
}

function PayslipCard({ line, label, onDetails }) {
  const p = line.payslip;
  return (
    <div className="card tight" style={{ boxShadow: 'none' }}>
      <div className="row between"><div className="logo sm"><div className="b" style={{ fontSize: 18 }}>BrainADZ</div><div className="h" style={{ fontSize: 18 }}>HRMS</div></div><div className="right"><b>Payslip</b><div className="small muted">{label}</div></div></div>
      <div className="row mt-16" style={{ gap: 12 }}>
        <Person name={line.name} id={line.employeeId} hasPhoto={line.has_photo} size={48} sub={`${line.code} | ${line.designation || ''}`} />
        <span className="grow" /><Badge>{line.status === 'Processed' ? 'Processing' : line.status}</Badge>
      </div>
      <div className="mt-16 small">
        <div className="row between mb-8"><span>Gross Earnings</span><b>{inr(p.totalEarnings)}</b></div>
        <div className="row between mb-8"><span>Total Deductions</span><b>{inr(p.totalDeductions)}</b></div>
      </div>
      <div className="row between" style={{ background: 'var(--blue-soft)', padding: '12px 14px', borderRadius: 10 }}><b className="blue">Net Pay</b><b className="blue" style={{ fontSize: 20 }}>{inr(p.net)}</b></div>
      <div className="row mt-12">
        {line.payslipId ? <a className="btn sm grow" href={`/print/payslip/${line.payslipId}`} target="_blank" rel="noreferrer"><Download size={15} />Download PDF</a> : <Button size="sm" className="grow" disabled title="Run payroll to generate the payslip">Download PDF</Button>}
        <Button size="sm" className="grow" onClick={onDetails}>View Details</Button>
      </div>
    </div>
  );
}

export function PayslipView({ data: p, label, company = 'BrainADZ' }) {
  const e = p.employee || {};
  const earn = [['Basic Salary', p.earnings.basic], ['House Rent Allowance', p.earnings.hra], ['Special Allowance', p.earnings.special], ['Bonus / Arrears', p.earnings.bonus], ['Reimbursements', p.earnings.reimbursement]];
  const ded = [['Provident Fund', p.deductions.pf], ['ESI', p.deductions.esi], ['Professional Tax', p.deductions.pt], ['Income Tax (TDS)', p.deductions.tds], ['Labour Welfare Fund', p.deductions.lwf], ['Other Deductions', p.deductions.other]];
  const n = Math.max(earn.length, ded.length);
  return (
    <div>
      <div className="row between" style={{ borderBottom: '2px solid var(--navy)', paddingBottom: 12 }}>
        <div className="logo"><div className="b">{company}</div><div className="tg">Payslip for {label}</div></div>
        <div className="right small"><div className="b7" style={{ fontSize: 16 }}>Salary Slip</div><div className="muted">{label}</div></div>
      </div>
      <dl className="kv mt-16" style={{ gridTemplateColumns: '130px 1fr 130px 1fr' }}>
        <dt>Employee</dt><dd>{e.name}</dd><dt>Employee ID</dt><dd>{e.code}</dd>
        <dt>Designation</dt><dd>{e.designation || '—'}</dd><dt>Department</dt><dd>{e.department || '—'}</dd>
        <dt>PAN</dt><dd>{e.pan || '—'}</dd><dt>UAN</dt><dd>{e.uan || '—'}</dd>
        <dt>Bank</dt><dd>{e.bankName || '—'} {e.bankAccount || ''}</dd><dt>Paid days</dt><dd>{p.paidDays} / {p.daysInMonth}{p.lopDays ? ` (LOP ${p.lopDays})` : ''}</dd>
      </dl>
      <table className="table mt-16" style={{ border: '1px solid var(--border)' }}>
        <thead><tr><th>Earnings</th><th className="num">Amount</th><th>Deductions</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {Array.from({ length: n }, (_, i) => (
            <tr key={i}><td>{earn[i]?.[0]}</td><td className="num">{earn[i] ? inr(earn[i][1]) : ''}</td><td>{ded[i]?.[0]}</td><td className="num">{ded[i] ? inr(ded[i][1]) : ''}</td></tr>
          ))}
          <tr className="b7"><td>Total Earnings</td><td className="num">{inr(p.totalEarnings)}</td><td>Total Deductions</td><td className="num">{inr(p.totalDeductions)}</td></tr>
        </tbody>
      </table>
      <div className="row between mt-16" style={{ background: 'var(--blue-soft)', padding: '14px 16px', borderRadius: 10 }}><b>Net Pay</b><b style={{ fontSize: 22 }}>{inr(p.net)}</b></div>
      <div className="small muted mt-12">Employer contributions (not deducted): PF {inr(p.employer.pf)} · ESI {inr(p.employer.esi)}{p.employer.lwf ? ` · LWF ${inr(p.employer.lwf)}` : ''}. This is a system-generated payslip and does not need a signature.</div>
    </div>
  );
}

function PayCalendar({ month, steps, payDate }) {
  const marks = {};
  const add = (iso, label, color) => { if (iso && iso.slice(0, 7) === month) marks[iso.slice(0, 10)] = { label, color }; };
  add(steps.collation, 'Data lock', '#1FA855');
  add(steps.approvals, 'Approved', '#7C5CFC');
  add(steps.transfer, 'Bank transfer', '#F2A600');
  add(steps.completed, 'Paid', '#1FA855');
  if (!steps.completed) marks[payDate] = marks[payDate] || { label: 'Pay day', color: '#E5243B' };
  const entries = Object.entries(marks).sort();
  return (
    <div>
      <div className="row wrap" style={{ gap: 8 }}>
        {entries.map(([d, m]) => (
          <div key={d} className="center" style={{ width: 62, padding: '8px 4px', borderRadius: 10, background: `${m.color}18`, border: `1px solid ${m.color}40` }}>
            <div className="b7" style={{ fontSize: 18 }}>{Number(d.slice(8))}</div><div className="xs" style={{ color: 'var(--text-2)' }}>{m.label}</div>
          </div>
        ))}
      </div>
      <div className="small muted mt-12">Pay day: {fmtDate(payDate)}</div>
    </div>
  );
}

function Composition({ comp }) {
  const items = [
    { label: 'Basic', value: comp.basic, color: CAT[0] },
    { label: 'Allowances', value: comp.allowances, color: CAT[1] },
    { label: 'Bonuses', value: comp.bonus, color: CAT[2] },
    { label: 'Reimbursements', value: comp.reimbursement, color: CAT[3] },
    { label: 'Employer PF / ESI', value: comp.employer, color: CAT[4] },
  ];
  const total = items.reduce((t, i) => t + i.value, 0);
  if (!total) return <Empty text="No payroll data" />;
  return (
    <div className="row donut-row" style={{ gap: 18 }}>
      <Donut size={150} thickness={22} data={items} center={{ value: inrShort(total), label: 'Total Cost' }} format={inr} />
      <Legend items={items} format={inrShort} />
    </div>
  );
}

function Approval({ run, busy, isAdmin, onApprove, onSendBack, onTransfer, onComplete, onDelete }) {
  if (!run) return <Empty text="Run payroll to start approvals" />;
  const s = run.status;
  const has = (stage) => run.approvals.find((a) => a.stage === stage);
  const flow = [
    { label: 'Prepared by HR', a: has('Prepared by HR') },
    { label: 'Review by Finance', a: has('Review by Finance') },
    { label: 'Management', a: has('Management Approval') },
    { label: 'Transfer', a: run.steps.transfer && { at: run.steps.transfer } },
    { label: 'Completed', a: run.steps.completed && { at: run.steps.completed } },
  ];
  const firstOpen = flow.findIndex((f) => !f.a);
  return (
    <div>
      <Steps steps={flow.map((f, i) => ({ label: f.label, state: f.a ? 'done' : i === firstOpen ? 'current' : 'todo', sub: f.a ? `${f.a.by ? `${f.a.by.split(' ')[0]} · ` : ''}${fmtShort(f.a.at)}` : '' }))} />
      <div className="row wrap mt-16" style={{ gap: 8 }}>
        {s === 'In Review' && <Button variant="primary" icon={CircleCheck} loading={busy} onClick={() => onApprove('finance')}>Approve (Finance)</Button>}
        {s === 'Finance Reviewed' && (isAdmin ? <Button variant="primary" icon={CircleCheck} loading={busy} onClick={() => onApprove('management')}>Approve (Management)</Button> : <span className="small muted">Waiting for an administrator to approve.</span>)}
        {['Finance Reviewed', 'Approved'].includes(s) && <Button icon={Undo2} loading={busy} onClick={onSendBack}>Send back</Button>}
        {s === 'Approved' && <Button variant="primary" icon={Send} loading={busy} onClick={onTransfer}>Schedule bank transfer</Button>}
        {s === 'Transfer Scheduled' && <Button variant="primary" icon={CircleCheck} loading={busy} onClick={onComplete}>Mark salaries paid</Button>}
        {['In Review', 'Finance Reviewed'].includes(s) && <Button variant="ghost" icon={Trash2} onClick={onDelete}>Delete run</Button>}
        {s === 'Completed' && <span className="row gap-6 green b6"><CircleCheck size={18} />Salaries paid</span>}
      </div>
    </div>
  );
}

function Statutory({ s, month }) {
  const due = (day) => fmtShort(`${addMonths(month, 1)}-${day}`);
  const rows = [
    ['PF (EPF)', s.pfEmployee + s.pfEmployer, `Employee ${inr(s.pfEmployee)} + employer ${inr(s.pfEmployer)}`, due('15')],
    ['ESI', s.esiEmployee + s.esiEmployer, `Employee ${inr(s.esiEmployee)} + employer ${inr(s.esiEmployer)}`, due('15')],
    ['TDS', s.tds, 'Deducted at source', due('07')],
    ['Professional Tax', s.pt, 'State PT', due('20')],
    ['LWF', s.lwf, 'Labour Welfare Fund', s.lwf ? due('15') : '—'],
  ];
  return (
    <table className="table compact">
      <thead><tr><th>Item</th><th className="num">Amount</th><th>Due by</th></tr></thead>
      <tbody>{rows.map(([l, v, hint, d]) => <tr key={l} title={hint}><td>{l}</td><td className="num">{inr(v)}</td><td><Badge tone={v ? 'green' : 'gray'}>{v ? d : 'Nil'}</Badge></td></tr>)}</tbody>
    </table>
  );
}

function Exceptions({ list, onView }) {
  const icon = (t) => (t === 'attendance' || t === 'bank' || t === 'salary' ? <TriangleAlert size={16} className="red" /> : t === 'reimbursement' ? <TriangleAlert size={16} className="amber" /> : <Info size={16} className="blue" />);
  return (
    <div>
      {list.map((x) => (
        <div key={x.type} className="list-item" style={{ padding: '8px 0' }}>
          {icon(x.type)}<span className="grow small">{x.label}</span><b>{x.count}</b>
          <button type="button" className="link" disabled={!x.count} onClick={() => onView(x)} style={{ opacity: x.count ? 1 : 0.4 }}>View</button>
        </div>
      ))}
    </div>
  );
}

function Adjustments({ items, onChange, locked }) {
  const { toast } = useApp();
  const [run] = useAction(toast);
  if (!items.length) return <Empty text="No adjustments this month" />;
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead><tr><th>Employee</th><th>Type</th><th>Note</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
        <tbody>{items.map((a) => (
          <tr key={a.id}>
            <td><Person name={a.name} sub={a.code} id={a.employee_id} size={28} /></td>
            <td><Badge tone={a.kind === 'Deduction' ? 'red' : a.kind === 'Bonus' ? 'purple' : 'blue'}>{a.kind}</Badge></td>
            <td className="small muted">{a.note}</td>
            <td className="num b6">{inr(a.amount)}</td>
            <td><Badge>{a.status}</Badge></td>
            <td className="right nowrap">
              {!locked && a.status === 'Pending' && <><Button size="xs" variant="success" onClick={async () => { await run(() => api.put(`/payroll/adjustments/${a.id}`, { status: 'Approved' }), 'Approved. Re-run payroll to include it.'); onChange(); }}>Approve</Button> <Button size="xs" variant="reject" onClick={async () => { await run(() => api.put(`/payroll/adjustments/${a.id}`, { status: 'Rejected' }), 'Rejected'); onChange(); }}>Reject</Button></>}
              {!locked && <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete" onClick={async () => { await run(() => api.del(`/payroll/adjustments/${a.id}`), 'Removed'); onChange(); }} />}
            </td>
          </tr>
        ))}</tbody>
      </table>
      {!locked && <div className="small muted mt-8">After approving claims, click <b>Re-run</b> above so payslips include them.</div>}
    </div>
  );
}

