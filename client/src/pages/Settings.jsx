import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Save, Plus, Trash2, KeyRound, Download, TriangleAlert, Pencil, Bot, Database, MapPin, X } from 'lucide-react';
import { getPosition } from '../lib/location.js';
import { useApp } from '../context.jsx';
import { useApi, useAction } from '../lib/hooks.js';
import { api, postDownload } from '../lib/api.js';
import { refreshWorkday } from '../lib/workday.js';
import { fmtDateTime } from '../lib/format.js';
import { Card, Badge, Button, Tabs, Empty, Loading, ErrorBox, Field, Input, Select, Modal, Toggle, useConfirm, Textarea, EmployeeSelect } from '../components/ui.jsx';
import { TempPasswordModal } from '../components/forms.jsx';
import { LEAVE_ICONS } from './Leave.jsx';

export default function SettingsPage() {
  const { isAdmin } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'company';
  const tabs = [{ value: 'company', label: 'Company' }, { value: 'payroll', label: 'Payroll Rules' }, { value: 'org', label: 'Organisation' }, { value: 'leave', label: 'Leave Types' },
    { value: 'offices', label: 'Office Locations' }, { value: 'users', label: 'Users & Roles' }, ...(isAdmin ? [{ value: 'audit', label: 'Audit Log' }, { value: 'data', label: 'Data' }] : [])];
  return (
    <div>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Company rules, masters, users and data.</div></div></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={tabs} />
      {tab === 'company' && <Company />}
      {tab === 'payroll' && <PayrollRules />}
      {tab === 'org' && <Org />}
      {tab === 'leave' && <LeaveTypes />}
      {tab === 'offices' && <Offices />}
      {tab === 'users' && <Users />}
      {tab === 'audit' && isAdmin && <Audit />}
      {tab === 'data' && isAdmin && <DataTab />}
    </div>
  );
}

function useSettings() {
  return useApi('/settings');
}

function Company() {
  const { toast, refreshMeta, loadMe, info } = useApp();
  const { data, error } = useSettings();
  const [f, setF] = useState(null);
  const [run, busy] = useAction(toast);
  useEffect(() => { if (data && !f) setF(data.settings); }, [data, f]);
  if (error) return <ErrorBox error={error} />;
  if (!f) return <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    <div className="grid">
      <Card className="span-8" title="Company & working rules">
        <div className="form-grid">
          <Field label="Company name"><Input value={f.companyName} onChange={set('companyName')} /></Field>
          <Field label="Time zone"><Input value={f.timezone} onChange={set('timezone')} /></Field>
          <Field label="Work day starts"><Input type="time" value={f.workdayStart} onChange={set('workdayStart')} /></Field>
          <Field label="Late after" hint="Check-ins after this time are flagged late"><Input type="time" value={f.lateAfter} onChange={set('lateAfter')} /></Field>
          <Field label="Work day ends" hint="A clock left running overnight stops at this time"><Input type="time" value={f.workdayEnd || '18:30'} onChange={set('workdayEnd')} /></Field>
          <Field label="Working hours per day" hint="Days below this need the manager's approval"><Input type="number" min="1" max="14" step="0.5" value={f.workHours ?? 8} onChange={set('workHours')} /></Field>
          <Field label="Short-hours grace (minutes)" hint="Days within this of the target are not flagged"><Input type="number" min="0" max="120" value={f.shortHoursGraceMinutes ?? 15} onChange={set('shortHoursGraceMinutes')} /></Field>
          <Field label="Weekly offs" className="full">
            <div className="row wrap" style={{ gap: 14 }}>{days.map((d, i) => <label key={d} className="check"><input type="checkbox" checked={f.weeklyOffs.includes(i)} onChange={(e) => setF({ ...f, weeklyOffs: e.target.checked ? [...f.weeklyOffs, i] : f.weeklyOffs.filter((x) => x !== i) })} />{d}</label>)}</div>
          </Field>
          <Field label="Employee code prefix"><Input value={f.employeeCodePrefix} onChange={set('employeeCodePrefix')} maxLength={5} /></Field>
          <Field label="Salary bank"><Input value={f.bankName} onChange={set('bankName')} /></Field>
          <Field label="Notice period (days)"><Input type="number" value={f.noticePeriodDays} onChange={set('noticePeriodDays')} /></Field>
          <Field label="Notice period for managers+ (days)"><Input type="number" value={f.noticePeriodSeniorDays} onChange={set('noticePeriodSeniorDays')} /></Field>
        </div>
        <Button variant="primary" icon={Save} className="mt-16" loading={busy} onClick={async () => {
          const { companyName, timezone, workdayStart, workdayEnd, lateAfter, workHours, shortHoursGraceMinutes, weeklyOffs, employeeCodePrefix, bankName, noticePeriodDays, noticePeriodSeniorDays } = f;
          if (await run(() => api.put('/settings', { companyName, timezone, workdayStart, workdayEnd, lateAfter, workHours, shortHoursGraceMinutes, weeklyOffs, employeeCodePrefix, bankName, noticePeriodDays, noticePeriodSeniorDays }), 'Settings saved')) { refreshMeta(); loadMe(); refreshWorkday().catch(() => {}); }
        }}>Save</Button>
      </Card>
      <Card className="span-4" title="AI resume screening">
        <div className="row gap-6 mb-12"><Bot size={20} className="blue" />{info.ai ? <Badge tone="green">Claude connected</Badge> : <Badge tone="amber">Rule-based scoring</Badge>}</div>
        <p className="small" style={{ lineHeight: 1.6, color: 'var(--text-2)' }}>
          {info.ai ? 'Resumes are read and scored by Claude. Each screening is one API call billed to your Anthropic account.'
            : <>To use Claude for resume screening and “Ask AI”, set <code>ANTHROPIC_API_KEY</code> in the server environment and restart. Until then the screener scores resumes with keyword and rule matching.</>}
        </p>
      </Card>
    </div>
  );
}

function PayrollRules() {
  const { toast } = useApp();
  const { data, error } = useSettings();
  const [p, setP] = useState(null);
  const [run, busy] = useAction(toast);
  useEffect(() => { if (data && !p) setP(data.settings.payroll); }, [data, p]);
  if (error) return <ErrorBox error={error} />;
  if (!p) return <Loading />;
  const num = (k, label, hint) => <Field label={label} hint={hint}><Input type="number" step="any" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></Field>;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <Card title="Payroll rules" style={{ maxWidth: 980 }}>
      <div className="alert info mb-16">Changes apply the next time payroll is run or re-run. Completed months are not changed.</div>
      <div className="form-grid three">
        <div className="form-section">Salary structure</div>
        {num('basicPct', 'Basic (% of monthly CTC)')}
        {num('hraPct', 'HRA (% of Basic)', '40% non-metro, 50% metro')}
        <div />
        <div className="form-section">Provident Fund</div>
        <label className="check"><Toggle on={p.pfEnabled} onChange={(v) => setP({ ...p, pfEnabled: v })} label="PF enabled" />PF enabled</label>
        {num('pfRate', 'PF rate (%)', 'Employee and employer each')}
        {num('pfWageCeiling', 'PF wage ceiling (₹)', 'PF is computed on Basic up to this')}
        <div className="form-section">ESI</div>
        {num('esiThreshold', 'ESI gross threshold (₹/month)')}
        {num('esiEmployeeRate', 'Employee rate (%)')}
        {num('esiEmployerRate', 'Employer rate (%)')}
        <div className="form-section">Professional Tax & LWF</div>
        {num('ptAmount', 'Professional tax (₹/month)')}
        {num('ptMinGross', 'PT applies from gross (₹)')}
        <div />
        {num('lwfEmployee', 'LWF employee (₹)')}
        {num('lwfEmployer', 'LWF employer (₹)')}
        <Field label="LWF deducted in"><div className="row wrap" style={{ gap: 8 }}>{months.map((m, i) => <label key={m} className="check small"><input type="checkbox" checked={p.lwfMonths.includes(i + 1)} onChange={(e) => setP({ ...p, lwfMonths: e.target.checked ? [...p.lwfMonths, i + 1] : p.lwfMonths.filter((x) => x !== i + 1) })} />{m}</label>)}</div></Field>
        <div className="form-section">Attendance</div>
        <Field label="Past working days with no attendance mark are paid as" className="full"><Select value={p.unmarkedAs} onChange={(e) => setP({ ...p, unmarkedAs: e.target.value })} options={[{ value: 'present', label: 'Present (recommended while attendance tracking is new)' }, { value: 'absent', label: 'Absent (loss of pay)' }]} /></Field>
      </div>
      <Button variant="primary" icon={Save} className="mt-16" loading={busy} onClick={() => run(() => api.put('/settings', { payroll: p }), 'Payroll rules saved')}>Save rules</Button>
    </Card>
  );
}

function Org() {
  const { data, error, reload } = useSettings();
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="grid">
      <Card className="span-4" title="Verticals"><Master table="verticals" items={data.verticals} reload={reload} withColor /></Card>
      <Card className="span-4" title="Departments"><Master table="departments" items={data.departments} reload={reload} /></Card>
      <Card className="span-4" title="Locations"><Master table="locations" items={data.locations} reload={reload} /></Card>
    </div>
  );
}

function Master({ table, items, reload, withColor }) {
  const { toast, refreshMeta } = useApp();
  const [name, setName] = useState('');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const done = () => { reload(); refreshMeta(); };
  return (
    <div>
      {items.map((x) => (
        <div key={x.id} className="list-item" style={{ padding: '8px 0' }}>
          {withColor && <span className="dot" style={{ background: x.color, width: 12, height: 12 }} />}
          <span className="grow">{x.name}{x.tagline && <div className="xs muted">{x.tagline}</div>}</span>
          <span className="pill-num">{x.employees}</span>
          <Button size="xs" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setEdit({ ...x })} />
          <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete ${x.name}?`, text: 'Only possible when nothing uses it.', danger: true, confirmLabel: 'Delete' })) { await run(() => api.del(`/settings/${table}/${x.id}`), 'Deleted'); done(); } }} />
        </div>
      ))}
      <div className="row mt-12" style={{ gap: 8 }}>
        <Input className="sm" value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${table.slice(0, -1)}`} />
        <Button size="sm" icon={Plus} loading={busy} onClick={async () => { if (await run(() => api.post(`/settings/${table}`, { name, short: name }), 'Added')) { setName(''); done(); } }}>Add</Button>
      </div>
      {edit && (
        <Modal title={`Edit ${edit.name}`} size="narrow" onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.put(`/settings/${table}/${edit.id}`, edit), 'Saved')) { setEdit(null); done(); } }}>Save</Button></>}>
          <div className="col" style={{ gap: 12 }}>
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {withColor && <><Field label="Short name (shown in the top bar)"><Input value={edit.short} onChange={(e) => setEdit({ ...edit, short: e.target.value })} /></Field>
              <Field label="Tagline"><Input value={edit.tagline || ''} onChange={(e) => setEdit({ ...edit, tagline: e.target.value })} /></Field>
              <Field label="Colour"><input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field></>}
          </div>
        </Modal>
      )}
      {confirmEl}
    </div>
  );
}

function LeaveTypes() {
  const { toast, refreshMeta } = useApp();
  const { data, reload } = useApi('/leave/types');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction(toast);
  if (!data) return <Loading />;
  const save = async () => {
    const body = { ...edit, annual_quota: edit.unlimited ? null : edit.annual_quota };
    if (await run(() => (edit.id ? api.put(`/leave/types/${edit.id}`, body) : api.post('/leave/types', body)), 'Leave type saved')) { setEdit(null); reload(); refreshMeta(); }
  };
  return (
    <Card flush title="Leave policy builder" action={<Button size="sm" variant="primary" icon={Plus} style={{ marginRight: 18 }} onClick={() => setEdit({ code: '', name: '', annual_quota: 12, accrual: 'annual', carry_forward_max: 0, paid: 1, calendar_days: 0, gender: '', kind: 'leave', color: '#1A6DF0', rule: '', active: 1 })}>New leave type</Button>}>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="table">
          <thead><tr><th style={{ paddingLeft: 18 }}>Leave type</th><th>Quota / year</th><th>Accrual</th><th>Carry forward</th><th>Paid</th><th>Applies to</th><th>Active</th><th /></tr></thead>
          <tbody>{data.items.map((t) => {
            const Icon = LEAVE_ICONS[t.icon] || LEAVE_ICONS.calendar;
            return (
              <tr key={t.id}>
                <td style={{ paddingLeft: 18 }}><div className="row gap-6"><Icon size={18} style={{ color: t.color }} /><b>{t.name}</b><span className="muted small">({t.code})</span></div><div className="xs muted">{t.rule}</div></td>
                <td>{t.annual_quota ?? 'Unlimited'}{t.calendar_days ? <span className="xs muted"> calendar days</span> : ''}</td>
                <td className="small">{t.accrual === 'monthly' ? 'Monthly' : 'Yearly (pro-rated)'}</td>
                <td className="small">{t.carry_forward_max ? `Up to ${t.carry_forward_max}` : 'No'}</td>
                <td>{t.paid ? <Badge tone="green">Paid</Badge> : <Badge tone="red">Unpaid</Badge>}</td>
                <td className="small">{t.gender === 'F' ? 'Women' : t.gender === 'M' ? 'Men' : 'Everyone'}{t.kind === 'wfh' ? ' · counts as WFH' : ''}</td>
                <td>{t.active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Off</Badge>}</td>
                <td className="right" style={{ paddingRight: 18 }}><Button size="xs" icon={Pencil} onClick={() => setEdit({ ...t, gender: t.gender || '', unlimited: t.annual_quota == null })}>Edit</Button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : 'New leave type'} onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
          <div className="form-grid">
            {!edit.id && <Field label="Code"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} maxLength={6} placeholder="e.g. BL" /></Field>}
            <Field label="Name" className={edit.id ? 'full' : ''}><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Days per year"><Input type="number" value={edit.unlimited ? '' : edit.annual_quota ?? ''} disabled={edit.unlimited} onChange={(e) => setEdit({ ...edit, annual_quota: e.target.value })} /></Field>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={Boolean(edit.unlimited)} onChange={(e) => setEdit({ ...edit, unlimited: e.target.checked })} />Unlimited</label>
            <Field label="Accrual"><Select value={edit.accrual} onChange={(e) => setEdit({ ...edit, accrual: e.target.value })} options={[{ value: 'annual', label: 'Credited yearly (pro-rated for joiners)' }, { value: 'monthly', label: 'Accrues monthly' }]} /></Field>
            <Field label="Carry forward up to (days)"><Input type="number" value={edit.carry_forward_max} onChange={(e) => setEdit({ ...edit, carry_forward_max: e.target.value })} /></Field>
            <Field label="Applies to"><Select value={edit.gender} onChange={(e) => setEdit({ ...edit, gender: e.target.value })} options={[{ value: '', label: 'Everyone' }, { value: 'F', label: 'Women' }, { value: 'M', label: 'Men' }]} /></Field>
            <Field label="Colour"><input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
            <Field label="Rule shown to employees" className="full"><Textarea value={edit.rule || ''} onChange={(e) => setEdit({ ...edit, rule: e.target.value })} style={{ minHeight: 60 }} /></Field>
            <label className="check"><input type="checkbox" checked={Boolean(edit.paid)} onChange={(e) => setEdit({ ...edit, paid: e.target.checked ? 1 : 0 })} />Paid leave</label>
            <label className="check"><input type="checkbox" checked={Boolean(edit.calendar_days)} onChange={(e) => setEdit({ ...edit, calendar_days: e.target.checked ? 1 : 0 })} />Count weekends & holidays</label>
            <label className="check"><input type="checkbox" checked={edit.kind === 'wfh'} onChange={(e) => setEdit({ ...edit, kind: e.target.checked ? 'wfh' : 'leave' })} />Counts as work from home</label>
            <label className="check"><input type="checkbox" checked={Boolean(edit.active)} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} />Active</label>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function Users() {
  const { toast, isAdmin, user } = useApp();
  const { data, reload } = useApi('/users');
  const [q, setQ] = useState('');
  const [temp, setTemp] = useState(null);
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  if (!data) return <Loading />;
  const items = data.users.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  const roles = [{ value: 'employee', label: 'Employee' }, { value: 'manager', label: 'Manager' }, { value: 'hr', label: 'HR' }, ...(isAdmin ? [{ value: 'admin', label: 'Administrator' }] : [])];
  return (
    <div>
      <div className="alert info mb-16" style={{ alignItems: 'center' }}>
        <span className="grow"><b>Roles:</b> Employee = self-service · Manager = their team's leave, attendance, reviews and hiring · HR = everything except admin settings · Administrator = everything, including payroll management approval and data reset.</span>
      </div>
      <Card flush title={`Logins (${data.users.length})`} action={
        <div className="row" style={{ gap: 8, marginRight: 18 }}>
          <Input className="sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={{ width: 200 }} />
          {data.withoutLogin > 0 && <Button size="sm" variant="primary" icon={Download} loading={busy} onClick={async () => { if (await confirm({ title: `Create ${data.withoutLogin} logins?`, text: 'Logins are created for every current employee without one. A CSV with one-time passwords downloads once; share each password privately.', confirmLabel: 'Create & download' })) { await run(() => postDownload('/users/bulk-create', {}, 'new-logins.csv'), 'Logins created. CSV downloaded.'); reload(); } }}>Create {data.withoutLogin} missing logins</Button>}
        </div>}>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead><tr><th style={{ paddingLeft: 18 }}>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>{items.map((u) => (
              <tr key={u.id}>
                <td style={{ paddingLeft: 18 }}><b>{u.name}</b><div className="small muted">{u.email}{u.code ? ` · ${u.code}` : ''}{u.must_change_password ? ' · must change password' : ''}</div></td>
                <td><select className="select sm" style={{ width: 150 }} value={u.role} disabled={u.id === user.id || (u.role === 'admin' && !isAdmin)} onChange={(e) => run(() => api.put(`/users/${u.id}`, { role: e.target.value }), 'Role updated').then(reload)}>{roles.concat(u.role === 'admin' && !isAdmin ? [{ value: 'admin', label: 'Administrator' }] : []).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></td>
                <td><Toggle on={Boolean(u.active)} disabled={u.id === user.id} label="Active" onChange={(v) => run(() => api.put(`/users/${u.id}`, { active: v }), v ? 'Login enabled' : 'Login disabled').then(reload)} /></td>
                <td className="small muted">{u.last_login ? fmtDateTime(u.last_login) : 'Never'}</td>
                <td className="right" style={{ paddingRight: 18 }}><Button size="xs" icon={KeyRound} disabled={u.role === 'admin' && !isAdmin} onClick={async () => { const out = await run(() => api.post(`/users/${u.id}/reset`)); if (out) setTemp(out); }}>Reset password</Button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
      {temp && <TempPasswordModal email={temp.email} password={temp.tempPassword} onClose={() => { setTemp(null); reload(); }} />}
      {confirmEl}
    </div>
  );
}

function Audit() {
  const { data } = useApi('/audit');
  if (!data) return <Loading />;
  return (
    <Card flush title="Audit log (latest 200)">
      {data.items.length ? (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table compact"><thead><tr><th style={{ paddingLeft: 18 }}>When</th><th>User</th><th>Action</th><th>Record</th></tr></thead>
            <tbody>{data.items.map((a) => <tr key={a.id}><td style={{ paddingLeft: 18 }} className="small nowrap">{fmtDateTime(a.created_at)}</td><td className="small">{a.email || 'System'}</td><td><code className="small">{a.action}</code></td><td className="small muted">{a.entity ? `${a.entity} #${a.entity_id ?? ''}` : ''}</td></tr>)}</tbody></table>
        </div>
      ) : <div style={{ padding: 18 }}><Empty text="No activity yet" /></div>}
    </Card>
  );
}

function DataTab() {
  const { toast, loadMe, info } = useApp();
  const navigate = useNavigate();
  const [run, busy] = useAction(toast);
  const [modal, setModal] = useState(null);
  const [text, setText] = useState('');
  const [login, setLogin] = useState({ email: '', password: '', repeat: '' });
  const fresh = modal === 'fresh';
  const mismatch = fresh && login.repeat && login.password !== login.repeat;
  const ready = text === (fresh ? 'START FRESH' : 'RESET') && (!fresh || (login.email && login.password && login.password === login.repeat));
  const go = async () => {
    const path = fresh ? '/settings/start-fresh' : '/settings/reset-demo';
    const body = fresh ? { confirm: text, email: login.email, password: login.password } : { confirm: text };
    if (await run(() => api.post(path, body), fresh ? 'All demo data removed' : 'Demo data restored')) { setModal(null); setText(''); navigate('/'); loadMe(); }
  };
  return (
    <div className="grid">
      <Card className="span-6" title="Start using with real data">
        <p className="small" style={{ lineHeight: 1.6, color: 'var(--text-2)' }}>Removes every demo employee, candidate, payroll run and record, keeping only your administrator login, the verticals, departments, locations, leave types, holidays and policy library. Then add your employees (Employees → Add) and create logins for them (Settings → Users).</p>
        {info.demo ? <Button variant="solid-red" icon={Database} className="mt-16" onClick={() => setModal('fresh')}>Remove demo data</Button> : <Badge tone="green" lg>You are on real data</Badge>}
      </Card>
      <Card className="span-6" title="Reset demo">
        <p className="small" style={{ lineHeight: 1.6, color: 'var(--text-2)' }}>Deletes everything and reloads the demo company. Useful for training sessions.</p>
        <Button variant="danger" icon={TriangleAlert} className="mt-16" onClick={() => setModal('reset')}>Reset to demo data</Button>
      </Card>
      {modal && (
        <Modal title={modal === 'fresh' ? 'Remove all demo data?' : 'Reset to demo data?'} size="narrow" onClose={() => setModal(null)}
          footer={<><Button onClick={() => setModal(null)}>Cancel</Button><Button variant="solid-red" loading={busy} disabled={!ready} onClick={go}>Confirm</Button></>}>
          <div className="col" style={{ gap: 12 }}>
            <div className="alert error"><TriangleAlert size={16} />This cannot be undone.</div>
            {fresh && <>
              <div className="small muted">Set the email and password you will sign in with from now on. The demo password stops working.</div>
              <Field label="Your email"><Input type="email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} placeholder="you@brainadz.com" autoComplete="username" /></Field>
              <Field label="New password" hint="At least 8 characters, with letters and numbers."><Input type="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} autoComplete="new-password" /></Field>
              <Field label="Repeat password" error={mismatch ? "Passwords don't match" : null}><Input type="password" value={login.repeat} onChange={(e) => setLogin({ ...login, repeat: e.target.value })} autoComplete="new-password" /></Field>
            </>}
            <Field label={`Type ${modal === 'fresh' ? 'START FRESH' : 'RESET'} to confirm`}><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
            {modal === 'reset' && <div className="small muted">You will be signed out. Sign back in with a demo account.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}


// ---------- office locations (sign-in only from the office) ----------
const GEO_MODES = [
  { value: 'off', label: 'Off: sign in from anywhere' },
  { value: 'login', label: 'Sign in and check in only at an office' },
  { value: 'strict', label: 'Also sign people out when they leave the office' },
];

function OfficeModal({ office, yourIp, onClose, onDone }) {
  const { meta, toast } = useApp();
  const [f, setF] = useState(office ? { ...office, ip_ranges: office.ip_ranges || '' } : { name: '', location_id: '', lat: '', lng: '', radius_m: 300, ip_ranges: '', active: 1 });
  const [run, busy] = useAction(toast);
  const [locating, setLocating] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const here = async () => {
    setLocating(true);
    try {
      const p = await getPosition({ maxAgeMs: 0 });
      setF((x) => ({ ...x, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }));
      toast(`Location set (accurate to about ${p.accuracy} m)`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLocating(false);
    }
  };
  const save = async () => {
    const body = { ...f, location_id: f.location_id || null, active: f.active ? 1 : 0 };
    if (await run(() => (office ? api.put(`/settings/offices/${office.id}`, body) : api.post('/settings/offices', body)), office ? 'Office updated' : 'Office added')) { onDone(); onClose(); }
  };
  return (
    <Modal title={office ? `Edit ${office.name}` : 'Add an office'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Save} loading={busy} onClick={save}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Name"><Input value={f.name} onChange={set('name')} placeholder="e.g. Bengaluru office" /></Field>
        <Field label="Location"><Select value={f.location_id || ''} onChange={set('location_id')} placeholder="—" options={(meta.locations || []).map((l) => ({ value: l.id, label: l.name }))} /></Field>
        <Field label="Latitude"><Input value={f.lat} onChange={set('lat')} placeholder="12.978400" inputMode="decimal" /></Field>
        <Field label="Longitude"><Input value={f.lng} onChange={set('lng')} placeholder="77.640800" inputMode="decimal" /></Field>
        <div className="full row wrap" style={{ gap: 10 }}>
          <Button icon={MapPin} loading={locating} onClick={here}>Use my current location</Button>
          <span className="small muted">Stand inside the office when you press this. Or copy the coordinates from Google Maps (right-click the building).</span>
        </div>
        <Field label="Radius (metres)" hint="How far from this point still counts as the office. 200–500 m suits most buildings."><Input type="number" min="50" max="5000" value={f.radius_m} onChange={set('radius_m')} /></Field>
        <Field label="Status"><Select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' ? 1 : 0 })} options={[{ value: '1', label: 'Active' }, { value: '0', label: 'Not used' }]} /></Field>
        <Field label="Office network addresses (optional)" className="full" hint={`Anyone connecting from these counts as in the office, even without GPS. Use the office's public IP, or LAN ranges like 192.168.1.0/24 if the HRMS runs on an office computer. You are connecting from ${yourIp || 'an unknown address'}.`}>
          <Input value={f.ip_ranges} onChange={set('ip_ranges')} placeholder="203.0.113.7, 192.168.1.0/24" />
        </Field>
      </div>
    </Modal>
  );
}

function Offices() {
  const { toast, refreshMeta } = useApp();
  const { data, error, reload } = useApi('/settings/offices');
  const [policy, setPolicy] = useState(null);
  const [modal, setModal] = useState(null);
  const [add, setAdd] = useState('');
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  useEffect(() => { if (data) setPolicy({ ...data.policy, exempt: data.exempt }); }, [data]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data || !policy) return <Loading />;
  const savePolicy = async () => {
    const body = { geofence: { mode: policy.mode, allowWfhAndLeave: policy.allowWfhAndLeave, maxAccuracyM: policy.maxAccuracyM, exemptEmployeeIds: policy.exempt.map((e) => e.id) } };
    if (await run(() => api.put('/settings', body), 'Sign-in location rule saved')) { reload(); refreshMeta(); }
  };
  return (
    <div className="grid">
      <Card className="span-5" title="Sign-in location rule">
        <div className="col" style={{ gap: 14 }}>
          <Field label="Rule"><Select value={policy.mode} onChange={(e) => setPolicy({ ...policy, mode: e.target.value })} options={GEO_MODES} /></Field>
          <label className="check"><input type="checkbox" checked={policy.allowWfhAndLeave} onChange={(e) => setPolicy({ ...policy, allowWfhAndLeave: e.target.checked })} />Allow sign-in from anywhere on approved work-from-home and leave days</label>
          <Field label="Allowed from anywhere" hint="Field staff who work at client sites. Administrators can always sign in, so nobody can be locked out.">
            <div className="row wrap" style={{ gap: 6, marginBottom: policy.exempt.length ? 8 : 0 }}>
              {policy.exempt.map((e) => <span key={e.id} className="chip gray">{e.name}<button type="button" aria-label={`Remove ${e.name}`} onClick={() => setPolicy({ ...policy, exempt: policy.exempt.filter((x) => x.id !== e.id) })}><X size={13} /></button></span>)}
            </div>
            <EmployeeSelect value={add} placeholder="Add an employee" exclude={policy.exempt.map((e) => e.id)} onChange={(e) => {
              const emp = e.target.value ? { id: Number(e.target.value), name: e.target.selectedOptions[0].text.split(' · ')[0] } : null;
              if (emp) setPolicy({ ...policy, exempt: [...policy.exempt, emp] });
              setAdd('');
            }} />
          </Field>
          <Field label="Least accurate location accepted (metres)" hint="Readings rougher than this are refused instead of trusted. Phones are usually within 50 m, laptops on Wi-Fi within 100–500 m."><Input type="number" min="100" max="10000" value={policy.maxAccuracyM} onChange={(e) => setPolicy({ ...policy, maxAccuracyM: e.target.value })} /></Field>
          <div className="alert info"><MapPin size={16} /><span>Browsers share location only over https (the cloud version). If the HRMS runs on an office computer over plain http, add the office network addresses to each office instead.</span></div>
          <div className="row"><Button variant="primary" icon={Save} loading={busy} onClick={savePolicy}>Save rule</Button></div>
        </div>
      </Card>
      <Card className="span-7" title="Offices" flush action={<Button size="sm" icon={Plus} onClick={() => setModal({})}>Add office</Button>}>
        {data.demo && <div className="alert warn" style={{ margin: '0 18px 12px' }}>These are sample coordinates. Set each office's real position before turning the rule on.</div>}
        {!data.offices.length ? <Empty icon={MapPin} text="No offices yet. Add one to use the sign-in location rule." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Office</th><th>Position</th><th>Radius</th><th className="hide-sm">Network</th><th /></tr></thead>
              <tbody>{data.offices.map((o) => (
                <tr key={o.id}>
                  <td><div className="b6">{o.name}</div><div className="xs muted">{o.location || '—'}{!o.active && ' · not used'}</div></td>
                  <td className="small"><a href={`https://www.google.com/maps?q=${o.lat},${o.lng}`} target="_blank" rel="noreferrer">{Number(o.lat).toFixed(4)}, {Number(o.lng).toFixed(4)}</a></td>
                  <td className="small">{o.radius_m} m</td>
                  <td className="hide-sm small muted">{o.ip_ranges || '—'}</td>
                  <td className="right nowrap">
                    <Button size="xs" variant="ghost" icon={Pencil} aria-label={`Edit ${o.name}`} onClick={() => setModal({ office: o })} />
                    <Button size="xs" variant="ghost" icon={Trash2} aria-label={`Delete ${o.name}`} onClick={async () => { if (await confirm({ title: `Delete ${o.name}?`, text: 'People will no longer be able to sign in from here.', danger: true, confirmLabel: 'Delete' })) { await run(() => api.del(`/settings/offices/${o.id}`), 'Office removed'); reload(); } }} />
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      {modal && <OfficeModal office={modal.office} yourIp={data.yourIp} onClose={() => setModal(null)} onDone={reload} />}
      {confirmEl}
    </div>
  );
}
