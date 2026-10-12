import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Users, UserCheck, CalendarPlus, UserPlus, Search, Mail, Phone, CalendarDays, MapPin, Pencil, KeyRound, Camera, Download, Upload, Trash2,
  CircleCheck, CircleAlert, CalendarCheck, FileText, User, Plus, BadgeCheck, Briefcase, Clock3, UserX, ArrowRight, Undo2,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi, useAction, useDebounced } from '../lib/hooks.js';
import { api, download } from '../lib/api.js';
import { fmtDate, inr, lpa, fmtMonth, addMonths, fmtTime } from '../lib/format.js';
import {
  Card, Avatar, Person, VChip, StatusDot, Badge, Button, Modal, Field, Input, Select, Textarea, Tabs, Empty, Loading, ErrorBox, Pagination,
  Menu, Progress, useConfirm, FileDrop, EmployeeSelect, toneOf,
} from '../components/ui.jsx';
import { ApplyLeaveModal, RaiseRequestModal, TempPasswordModal } from '../components/forms.jsx';
import { VerticalFilterNote } from './Dashboard.jsx';

export default function Employees() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const { isHR } = useApp();
  const tab = sp.get('tab') || 'people';
  return (
    <div>
      {isHR && <Tabs value={tab} onChange={(t) => setSp(t === 'people' ? {} : { tab: t })} tabs={[{ value: 'people', label: 'People' }, { value: 'requests', label: 'Helpdesk Requests' }]} />}
      {tab === 'requests' && isHR ? <Requests /> : <People selectedId={id ? Number(id) : null} />}
    </div>
  );
}

function People({ selectedId }) {
  const { meta, isHR, vertical, user } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [filters, setFilters] = useState({ department: '', type: '', location: '', status: 'current', sort: 'name' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [adding, setAdding] = useState(false);
  const qs = new URLSearchParams({ page, pageSize, search: dq, ...filters, ...(vertical ? { vertical } : {}) });
  for (const [k, v] of [...qs.entries()]) if (!v) qs.delete(k);
  const { data, error, reload } = useApi(`/employees?${qs}`);
  useEffect(() => setPage(1), [dq, filters, vertical]);
  const first = data?.items[0]?.id;
  const shown = selectedId || (window.innerWidth > 1100 ? first : null);
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const k = data?.kpis;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Employees</h1>
          <div className="sub">Our people make BrainADZ extraordinary. <VerticalFilterNote /></div>
        </div>
        {k && (
          <div className="row wrap" style={{ gap: 12 }}>
            <MiniStat icon={Users} tone="blue" label="Total Employees" value={k.total} />
            <MiniStat icon={UserCheck} tone="green" label="Active Employees" value={k.active} dot="var(--green)" />
            <MiniStat icon={CalendarPlus} tone="amber" label="On Leave" value={k.onLeave} dot="var(--amber)" />
            <MiniStat icon={UserPlus} tone="green" label="New Joiners (This Month)" value={k.joiners} dot="var(--green)" />
          </div>
        )}
      </div>
      <div className="grid" style={{ alignItems: 'start' }}>
        <div className={`card ${shown ? 'span-5' : 'span-12'}`}>
          <div className="row mb-12">
            <div className="search grow" style={{ width: 'auto' }}>
              <Search size={18} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, ID, role, department…" aria-label="Search employees" />
            </div>
            {isHR && <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>Add</Button>}
            {isHR && <Button icon={Download} onClick={() => download('/employees/export.csv')} title="Export CSV" aria-label="Export CSV" />}
          </div>
          <div className="form-grid mb-12" style={{ gap: 10 }}>
            <Select value={filters.department} onChange={setF('department')} placeholder="All Departments" options={meta.departments.map((d) => ({ value: d.id, label: d.name }))} />
            <Select value={filters.type} onChange={setF('type')} placeholder="All Employment Types" options={['Full-time', 'Part-time', 'Contract', 'Intern']} />
            <Select value={filters.location} onChange={setF('location')} placeholder="All Locations" options={meta.locations.map((l) => ({ value: l.id, label: l.name }))} />
            <Select value={filters.status} onChange={setF('status')} options={[{ value: 'current', label: 'Current employees' }, { value: 'Active', label: 'Active' }, { value: 'Notice', label: 'Serving notice' }, { value: 'Exited', label: 'Exited' }, { value: 'all', label: 'Everyone' }]} />
          </div>
          {error && <ErrorBox error={error} onRetry={reload} />}
          {data ? (
            <>
              <div className="row between small muted mb-8">
                <span>Showing {data.total ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, data.total)} of {data.total} employees</span>
                <span className="row gap-6">Sort by:
                  <select className="select sm" style={{ width: 130 }} value={filters.sort} onChange={setF('sort')}>
                    <option value="name">Name A - Z</option><option value="-name">Name Z - A</option><option value="code">Employee ID</option><option value="-join">Newest first</option><option value="join">Oldest first</option>
                  </select>
                </span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Employee</th><th>ID</th>{!shown && <th className="hide-sm">Role</th>}<th>Vertical</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.items.map((e) => (
                      <tr key={e.id} className={`click ${e.id === shown ? 'sel' : ''}`} onClick={() => nav(`/employees/${e.id}`)}>
                        <td><Person name={e.name} sub={e.designation} id={e.id} hasPhoto={e.has_photo} link={false} /></td>
                        <td className="muted nowrap">{e.code}</td>
                        {!shown && <td className="hide-sm">{e.grade || '—'}</td>}
                        <td><VChip vertical={e.vertical_short} color={e.vertical_color} department={e.department} /></td>
                        <td><StatusDot status={e.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.items.length && <Empty text="No employees match these filters" />}
              </div>
              <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
            </>
          ) : <Loading />}
        </div>
        {shown && <div className="span-7"><EmployeeProfile key={shown} id={shown} onChanged={reload} isSelf={shown === user.employeeId} /></div>}
      </div>
      {adding && <EmployeeForm onClose={() => setAdding(false)} onSaved={(newId) => { reload(); nav(`/employees/${newId}`); }} />}
    </div>
  );
}

function MiniStat({ icon: Icon, tone, label, value, dot }) {
  return (
    <div className="card tight row" style={{ gap: 12, minWidth: 170 }}>
      <div className={`tone-${tone}`} style={{ width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={22} /></div>
      <div><div className="small" style={{ color: 'var(--text-2)' }}>{label}</div><div className="row gap-6" style={{ fontSize: 22, fontWeight: 700 }}>{value}{dot && <span className="dot" style={{ background: dot }} />}</div></div>
    </div>
  );
}

// ---------------------------------------------------------------- profile
export function EmployeeProfile({ id, onChanged, isSelf }) {
  const { isHR, toast, refreshMeta } = useApp();
  const [month, setMonth] = useState(null);
  const { data, error, reload } = useApi(`/employees/${id}${month ? `?month=${month}` : ''}`);
  const [tab, setTab] = useState('Overview');
  const [modal, setModal] = useState(null);
  const [run] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const photoRef = useRef(null);
  if (error && !data) return <Card><ErrorBox error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading /></Card>;
  const e = data.employee;
  const refresh = () => { reload(); onChanged?.(); };
  const canEdit = isHR || isSelf;
  const tabs = data.limited ? ['Overview'] : ['Overview', 'Documents', 'Attendance', 'Leave', 'Performance', ...(data.compensation ? ['Compensation'] : []), 'Assets'];
  const uploadPhoto = async (file) => {
    const form = new FormData();
    form.append('photo', file);
    if (await run(() => api.upload(`/employees/${id}/photo`, form), 'Photo updated')) { refresh(); refreshMeta(); }
  };
  const menu = [
    canEdit && { label: 'Change photo', icon: Camera, onClick: () => photoRef.current?.click() },
    isHR && { label: data.login ? 'Reset login password' : 'Create login', icon: KeyRound, onClick: () => setModal('login') },
    isHR && e.status !== 'Exited' && { label: 'Apply leave on behalf', icon: CalendarCheck, onClick: () => setModal('leave') },
    isHR && e.status !== 'Exited' && { label: 'Mark as exited', icon: UserX, danger: true, onClick: () => setModal('exit') },
    isHR && e.status === 'Exited' && { label: 'Re-activate', icon: Undo2, onClick: async () => { if (await confirm({ title: 'Re-activate employee?', text: `${e.name} will be marked Active again.` })) { await run(() => api.put(`/employees/${id}`, { status: 'Active' }), 'Employee re-activated'); refresh(); } } },
  ];
  return (
    <div className="card" style={{ padding: 0 }}>
      <input ref={photoRef} type="file" hidden accept=".jpg,.jpeg,.png,.webp" onChange={(ev) => { if (ev.target.files[0]) uploadPhoto(ev.target.files[0]); ev.target.value = ''; }} />
      <div className="row wrap" style={{ gap: 22, padding: 22, alignItems: 'flex-start' }}>
        <div style={{ position: 'relative' }}>
          <Avatar name={e.name} id={e.id} hasPhoto={e.has_photo} size={112} online={e.status === 'Active'} />
        </div>
        <div className="grow" style={{ minWidth: 240 }}>
          <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="row wrap" style={{ gap: 10 }}><h2 style={{ fontSize: 26, letterSpacing: '-0.5px' }}>{e.name}</h2><span className="badge b-blue lg">{e.code}</span></div>
              <div className="muted" style={{ fontSize: 16, marginTop: 4 }}>{e.designation}</div>
            </div>
            <div className="row">
              {canEdit && !data.limited && <Button variant="primary" icon={Pencil} onClick={() => setModal('edit')}>Edit Profile</Button>}
              <Menu items={menu} />
            </div>
          </div>
          <div className="row wrap mt-12" style={{ gap: 8 }}>
            <VChip vertical={e.vertical_short} color={e.vertical_color} department={e.department} />
            <span className="vchip" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>{e.employment_type}</span>
            {e.location && <span className="row gap-4 small" style={{ color: 'var(--text-2)' }}><MapPin size={15} />{e.location}</span>}
            {e.status !== 'Active' && <Badge>{e.status}</Badge>}
          </div>
          <div className="row wrap mt-12 small" style={{ gap: 18, color: 'var(--text-2)' }}>
            <span className="row gap-6"><Mail size={15} />{e.email}</span>
            {e.phone && <span className="row gap-6"><Phone size={15} />{e.phone}</span>}
            <span className="row gap-6"><CalendarDays size={15} />Joined {fmtDate(e.join_date)}</span>
            {e.exit_date && <span className="row gap-6 red"><CalendarDays size={15} />Last day {fmtDate(e.exit_date)}</span>}
          </div>
        </div>
      </div>
      <div style={{ padding: '0 22px' }}><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      <div style={{ padding: '0 22px 22px' }}>
        {tab === 'Overview' && <Overview data={data} isSelf={isSelf} onAction={setModal} reload={refresh} />}
        {tab === 'Documents' && <Documents data={data} reload={refresh} />}
        {tab === 'Attendance' && <AttendanceTab data={data} month={data.attendance.month} setMonth={setMonth} />}
        {tab === 'Leave' && <LeaveTab data={data} onApply={() => setModal(isSelf ? 'leave-self' : 'leave')} canApply={isSelf || isHR} />}
        {tab === 'Performance' && <PerformanceTab data={data} />}
        {tab === 'Compensation' && <Compensation data={data} />}
        {tab === 'Assets' && <Assets data={data} reload={refresh} />}
      </div>
      {modal === 'edit' && <EmployeeForm employee={data} selfOnly={!isHR} onClose={() => setModal(null)} onSaved={() => { refresh(); refreshMeta(); }} />}
      {modal === 'login' && <LoginModal employee={e} login={data.login} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'leave' && <ApplyLeaveModal onBehalf employeeId={e.id} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'leave-self' && <ApplyLeaveModal onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'request' && <RaiseRequestModal onClose={() => setModal(null)} />}
      {modal === 'exit' && <ExitModal employee={e} onClose={() => setModal(null)} onDone={refresh} />}
      {confirmEl}
    </div>
  );
}

function Overview({ data, isSelf, onAction, reload }) {
  const { isHR } = useApp();
  const nav = useNavigate();
  const e = data.employee;
  const team = data.reports.length ? data.reports : data.peers;
  return (
    <div className="grid" style={{ marginBottom: 0 }}>
      <div className="span-7 col" style={{ gap: 16 }}>
        <div className="card tight">
          <h3 className="mb-8" style={{ fontSize: 15 }}>About</h3>
          <p className="prose" style={{ fontSize: 14 }}>{e.about || <span className="muted">No bio yet.</span>}</p>
          <dl className="kv mt-16">
            <dt><User size={15} />Reporting Manager</dt><dd>{data.manager ? <Person name={data.manager.name} sub={data.manager.designation} id={data.manager.id} hasPhoto={data.manager.has_photo} size={30} /> : '—'}</dd>
            <dt><BadgeCheck size={15} />Employee ID</dt><dd>{e.code}</dd>
            <dt><CalendarDays size={15} />Joining Date</dt><dd>{fmtDate(e.join_date)}</dd>
            <dt><Briefcase size={15} />Employment Type</dt><dd>{e.employment_type}</dd>
            <dt><MapPin size={15} />Work Location</dt><dd>{e.location ? `${e.location}, India` : '—'}</dd>
            {e.dob && <><dt><CalendarDays size={15} />Date of Birth</dt><dd>{fmtDate(e.dob)}</dd></>}
            {e.address && <><dt><MapPin size={15} />Address</dt><dd>{e.address}</dd></>}
            {e.emergency_contact && <><dt><Phone size={15} />Emergency</dt><dd>{e.emergency_contact}</dd></>}
          </dl>
        </div>
        <div className="card tight">
          <h3 className="mb-8" style={{ fontSize: 15 }}>Skills</h3>
          <div className="row wrap" style={{ gap: 8 }}>{e.skills.length ? e.skills.map((s) => <span key={s} className="chip">{s}</span>) : <span className="muted small">No skills added</span>}</div>
        </div>
        {e.certifications?.length > 0 && (
          <div className="card tight">
            <h3 className="mb-8" style={{ fontSize: 15 }}>Certifications</h3>
            {e.certifications.map((c) => <div key={c.name} className="list-item"><CircleCheck size={18} className="green" /><span className="grow">{c.name}{c.issuer && <span className="muted small"> · {c.issuer}</span>}</span>{c.issued && <span className="small muted">Issued {fmtDate(c.issued, { month: 'short', year: 'numeric' })}</span>}</div>)}
          </div>
        )}
      </div>
      <div className="span-5 col" style={{ gap: 16 }}>
        <div className="card tight">
          <h3 className="mb-12" style={{ fontSize: 15 }}>Organization Structure</h3>
          <div className="col" style={{ alignItems: 'center', gap: 6 }}>
            {data.manager && <OrgNode p={data.manager} tone="var(--red-soft)" />}
            {data.manager && <div style={{ width: 2, height: 14, background: 'var(--border-strong)' }} />}
            <OrgNode p={{ id: e.id, name: e.name, designation: e.designation, has_photo: e.has_photo }} tone="var(--blue-soft)" />
            {data.reports.length > 0 && <div style={{ width: 2, height: 14, background: 'var(--border-strong)' }} />}
            {data.reports.length > 0 && <div className="row wrap" style={{ gap: 6, justifyContent: 'center' }}>{data.reports.slice(0, 4).map((r) => <OrgNode key={r.id} p={r} small />)}{data.reports.length > 4 && <span className="small muted">+{data.reports.length - 4} more</span>}</div>}
          </div>
        </div>
        {!data.limited && (
          <div className="card tight">
            <h3 className="mb-8" style={{ fontSize: 15 }}>Document Acknowledgements</h3>
            {data.acknowledgements.map((a) => {
              const ok = a.acked_at && a.acked_version === a.version;
              return <div key={a.id} className="list-item" style={{ padding: '7px 0' }}>{ok ? <CircleCheck size={17} className="green" /> : <CircleAlert size={17} className="amber" />}<span className="grow small">{a.title} <span className="muted">v{a.version}</span></span><span className="small muted">{ok ? fmtDate(a.acked_at) : 'Pending'}</span></div>;
            })}
            {data.poshTraining !== undefined && <div className="list-item" style={{ padding: '7px 0' }}>{data.poshTraining ? <CircleCheck size={17} className="green" /> : <CircleAlert size={17} className="amber" />}<span className="grow small">POSH awareness training</span><span className="small muted">{data.poshTraining ? fmtDate(data.poshTraining) : 'Pending'}</span></div>}
          </div>
        )}
        {team.length > 0 && (
          <div className="card tight">
            <h3 className="mb-8" style={{ fontSize: 15 }}>{data.reports.length ? 'Team' : 'Teammates'} ({team.length})</h3>
            {team.slice(0, 5).map((t) => <div key={t.id} className="list-item" style={{ padding: '7px 0' }}><Person name={t.name} sub={t.designation} id={t.id} hasPhoto={t.has_photo} size={32} /><span className="grow" /><span className="dot" style={{ background: 'var(--green)' }} /></div>)}
          </div>
        )}
        {data.onboarding?.length > 0 && <Onboarding tasks={data.onboarding} reload={reload} canEdit={isHR || (!isSelf && !data.limited)} />}
        {isSelf && (
          <div className="card tight">
            <h3 className="mb-12" style={{ fontSize: 15 }}>Quick Actions (Self Service)</h3>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 0 }}>
              <QuickAction icon={CalendarCheck} color="var(--blue)" label="Apply Leave" onClick={() => onAction('leave-self')} />
              <QuickAction icon={FileText} color="var(--red)" label="Raise a Request" onClick={() => onAction('request')} />
              <QuickAction icon={User} color="var(--green)" label="Update Profile" onClick={() => onAction('edit')} />
              <QuickAction icon={Download} color="var(--purple)" label="My Payslips" onClick={() => nav('/my?tab=payslips')} />
            </div>
          </div>
        )}
        {isHR && !isSelf && data.login !== undefined && (
          <div className="card tight small">
            <h3 className="mb-8" style={{ fontSize: 15 }}>Login</h3>
            {data.login ? <div className="col gap-4"><span>{data.login.email} · <Badge tone="blue">{data.login.role}</Badge> {!data.login.active && <Badge tone="red">Inactive</Badge>}</span><span className="muted">Last sign-in: {data.login.last_login ? fmtDate(data.login.last_login) : 'never'}</span></div>
              : <div className="row between"><span className="muted">No login yet</span><Button size="sm" icon={KeyRound} onClick={() => onAction('login')}>Create login</Button></div>}
          </div>
        )}
      </div>
    </div>
  );
}

function OrgNode({ p, tone = '#fff', small }) {
  return (
    <Link to={`/employees/${p.id}`} className="row" style={{ gap: 8, padding: small ? '6px 8px' : '8px 12px', borderRadius: 10, background: tone, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)', maxWidth: small ? 150 : 240 }}>
      <Avatar name={p.name} id={p.id} hasPhoto={p.has_photo} size={small ? 26 : 34} />
      <div style={{ minWidth: 0 }}><div className={`b6 ellipsis ${small ? 'small' : ''}`}>{p.name}</div><div className="xs muted ellipsis">{p.designation}</div></div>
    </Link>
  );
}

function QuickAction({ icon: Icon, color, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="col" style={{ alignItems: 'center', gap: 6, padding: '14px 8px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-2)', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
      <Icon size={24} style={{ color }} />{label}
    </button>
  );
}

export function Onboarding({ tasks, reload, canEdit }) {
  const { toast } = useApp();
  const [run] = useAction(toast);
  const done = tasks.filter((t) => t.done).length;
  return (
    <div className="card tight">
      <div className="row between mb-8"><h3 style={{ fontSize: 15 }}>Onboarding</h3><span className="small muted">{done}/{tasks.length} done</span></div>
      <Progress value={(done / tasks.length) * 100} color="var(--green)" />
      <div className="mt-8">
        {tasks.map((t) => (
          <label key={t.id} className="check list-item" style={{ padding: '7px 0', width: '100%' }}>
            <input type="checkbox" checked={Boolean(t.done)} disabled={!canEdit} onChange={async (ev) => { await run(() => api.put(`/onboarding/${t.id}`, { done: ev.target.checked })); reload(); }} />
            <span className={t.done ? 'muted' : ''} style={t.done ? { textDecoration: 'line-through' } : undefined}>{t.title}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Documents({ data, reload }) {
  const { isHR, toast, user, meta } = useApp();
  const e = data.employee;
  const [cat, setCat] = useState(meta.documentCategories?.[0] || 'Other');
  const [run, busy] = useAction(toast);
  const [confirm, confirmEl] = useConfirm();
  const canUpload = isHR || user.employeeId === e.id;
  const upload = async (files) => {
    for (const f of files) {
      const form = new FormData();
      form.append('file', f);
      form.append('category', cat);
      await run(() => api.upload(`/employees/${e.id}/documents`, form), `Uploaded ${f.name}`);
    }
    reload();
  };
  return (
    <div>
      {canUpload && (
        <div className="row wrap mb-16" style={{ gap: 12, alignItems: 'stretch' }}>
          <Field label="Category" className="" ><Select value={cat} onChange={(ev) => setCat(ev.target.value)} options={meta.documentCategories || ['Other']} /></Field>
          <div className="grow" style={{ minWidth: 220 }}>
            <FileDrop onFiles={upload} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.txt">
              <div className="row" style={{ justifyContent: 'center', gap: 8 }}><Upload size={18} className="blue" /><b>{busy ? 'Uploading…' : 'Drop files or click to upload'}</b><span className="small muted">PDF, images, Office · 10 MB max</span></div>
            </FileDrop>
          </div>
        </div>
      )}
      {data.documents.length ? (
        <table className="table">
          <thead><tr><th>Document</th><th>Category</th><th>Size</th><th>Uploaded</th><th /></tr></thead>
          <tbody>
            {data.documents.map((d) => (
              <tr key={d.id}>
                <td className="row gap-6"><FileText size={16} className="blue" />{d.name}</td>
                <td><Badge tone="gray">{d.category}</Badge></td>
                <td className="small muted">{d.size ? `${Math.max(1, Math.round(d.size / 1024))} KB` : '—'}</td>
                <td className="small muted">{fmtDate(d.uploaded_at)}</td>
                <td className="right nowrap">
                  <Button size="xs" icon={Download} onClick={() => download(`/documents/${d.id}/download`)}>Download</Button>
                  {isHR && <Button size="xs" variant="ghost" icon={Trash2} aria-label="Delete" onClick={async () => { if (await confirm({ title: 'Delete document?', text: d.name, danger: true, confirmLabel: 'Delete' })) { await run(() => api.del(`/documents/${d.id}`), 'Deleted'); reload(); } }} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty icon={FileText} text="No documents uploaded yet" />}
      {confirmEl}
    </div>
  );
}

const CODE_LABEL = { P: 'Present', WFH: 'Work from home', HD: 'Half day', A: 'Absent', L: 'On leave', H: 'Holiday', WO: 'Weekly off', U: 'Not marked', F: 'Upcoming', NA: '—' };
function AttendanceTab({ data, month, setMonth }) {
  const days = data.attendance.days;
  const counts = days.reduce((m, d) => ({ ...m, [d.code]: (m[d.code] || 0) + 1 }), {});
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  return (
    <div>
      <div className="row between mb-12">
        <div className="row"><Button size="sm" onClick={() => setMonth(addMonths(month, -1))}>‹</Button><b style={{ minWidth: 130, textAlign: 'center' }}>{fmtMonth(month)}</b><Button size="sm" onClick={() => setMonth(addMonths(month, 1))}>›</Button></div>
        <div className="row wrap small" style={{ gap: 12 }}>{['P', 'WFH', 'HD', 'A', 'L', 'U'].map((c) => <span key={c} className="row gap-4"><span className={`badge c-${c}`} style={{ padding: '2px 6px' }}>{counts[c] || 0}</span>{CODE_LABEL[c]}</span>)}</div>
      </div>
      <div className="calendar" style={{ gap: 6 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="dh">{d}</div>)}
        {Array.from({ length: first }, (_, i) => <div key={`b${i}`} />)}
        {days.map((d) => (
          <div key={d.date} className={`c-${d.code}`} title={`${d.date}: ${d.leave || CODE_LABEL[d.code]}${d.checkIn ? ` · in ${fmtTime(d.checkIn)}` : ''}${d.checkOut ? ` · out ${fmtTime(d.checkOut)}` : ''}`}
            style={{ borderRadius: 10, padding: '6px 4px', minHeight: 54, border: '1px solid #eef2f7' }}>
            <div className="small b6" style={{ color: 'var(--text)' }}>{Number(d.date.slice(8))}</div>
            <div className="xs b7">{d.code === 'L' ? d.leave : ['WO', 'F', 'NA'].includes(d.code) ? '' : d.code}</div>
            {d.checkIn && <div className="xs muted">{fmtTime(d.checkIn)}</div>}
          </div>
        ))}
      </div>
      {!days.length && <Empty text="No attendance for this month yet" />}
    </div>
  );
}

function LeaveTab({ data, onApply, canApply }) {
  return (
    <div>
      <div className="row between mb-12"><b>Leave balance {new Date().getFullYear()}</b>{canApply && <Button size="sm" variant="primary" icon={Plus} onClick={onApply}>Apply leave</Button>}</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {data.leave.balances.map((b) => (
          <div key={b.code} className="card tight" style={{ boxShadow: 'none' }}>
            <div className="small muted">{b.name}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{b.available ?? '∞'}<span className="small muted" style={{ fontWeight: 500 }}>{b.entitled != null ? ` / ${b.entitled + b.carried}` : ''}</span></div>
            {b.entitled != null && <Progress value={((b.entitled + b.carried - b.available) / Math.max(1, b.entitled + b.carried)) * 100} color={b.color} height={6} />}
            <div className="xs muted mt-8">Used {b.used}{b.pending ? ` · ${b.pending} pending` : ''}</div>
          </div>
        ))}
      </div>
      <h3 className="mt-16 mb-8" style={{ fontSize: 15 }}>Recent requests</h3>
      {data.leave.requests.length ? (
        <table className="table compact">
          <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th className="hide-sm">Reason</th></tr></thead>
          <tbody>{data.leave.requests.map((r) => <tr key={r.id}><td><span className="row gap-6"><span className="dot" style={{ background: r.color }} />{r.type}</span></td><td className="nowrap">{fmtDate(r.from_date)}{r.to_date !== r.from_date ? ` – ${fmtDate(r.to_date)}` : ''}</td><td>{r.days}</td><td><Badge>{r.status}</Badge></td><td className="hide-sm small muted">{r.reason}</td></tr>)}</tbody>
        </table>
      ) : <Empty text="No leave requests" />}
    </div>
  );
}

function PerformanceTab({ data }) {
  const p = data.performance;
  return (
    <div>
      {p.cycle && (
        <>
          <div className="row between mb-8"><b>{p.cycle.name}</b><Link className="link" to="/performance">Open performance <ArrowRight size={14} /></Link></div>
          {p.goals.length ? p.goals.map((g) => (
            <div key={g.id} className="list-item"><div className="grow"><div className="b6">{g.title}</div><div className="small muted">Weight {g.weight}%</div></div><div style={{ width: 160 }}><Progress value={g.progress} color={g.progress >= 80 ? 'var(--green)' : 'var(--blue)'} /></div><b className="small" style={{ width: 40 }}>{g.progress}%</b></div>
          )) : <Empty text="No goals set for this cycle" />}
        </>
      )}
      <h3 className="mt-16 mb-8" style={{ fontSize: 15 }}>Review history</h3>
      {p.reviews.length ? (
        <table className="table compact"><thead><tr><th>Cycle</th><th>Status</th><th>Self</th><th>Manager</th><th>Final</th></tr></thead>
          <tbody>{p.reviews.map((r) => <tr key={r.id}><td>{r.cycle_name}</td><td><Badge>{r.status}</Badge></td><td>{r.self_rating ?? '—'}</td><td>{r.manager_rating ?? '—'}</td><td className="b7">{r.final_rating ?? '—'}</td></tr>)}</tbody></table>
      ) : <Empty text="No reviews yet" />}
    </div>
  );
}

function Compensation({ data }) {
  const c = data.compensation;
  const s = c.structure;
  const rows = [['Basic Salary', s.basic], ['House Rent Allowance', s.hra], ['Special Allowance', s.special], ['Gross Salary', s.gross], ['Employer PF', s.employerPf], ['Cost to Company', s.monthlyCtc]];
  return (
    <div className="grid" style={{ marginBottom: 0 }}>
      <div className="span-7">
        <div className="row between mb-8"><b>Salary structure</b><span className="badge b-blue lg">CTC {lpa(c.ctc / 100000)}</span></div>
        <table className="table compact">
          <thead><tr><th>Component</th><th className="num">Monthly</th><th className="num">Annual</th></tr></thead>
          <tbody>{rows.map(([l, v]) => <tr key={l} className={l === 'Gross Salary' || l === 'Cost to Company' ? 'b7' : ''}><td>{l}</td><td className="num">{inr(v)}</td><td className="num">{inr(v * 12)}</td></tr>)}</tbody>
        </table>
        <div className="small muted mt-8">Estimated TDS: {inr(c.monthlyTds)}/month (new regime estimate; update after investment declaration).</div>
      </div>
      <div className="span-5 col" style={{ gap: 16 }}>
        <div className="card tight">
          <b>Statutory & bank</b>
          <dl className="kv mt-12" style={{ gridTemplateColumns: '110px 1fr' }}>
            <dt>PAN</dt><dd>{c.pan || <Badge tone="red">Missing</Badge>}</dd>
            <dt>UAN</dt><dd>{c.uan || <Badge tone="red">Missing</Badge>}</dd>
            <dt>Bank</dt><dd>{c.bank_name || '—'}</dd>
            <dt>Account</dt><dd>{c.bank_account ? `XXXX${c.bank_account.slice(-4)}` : <Badge tone="red">Missing</Badge>}</dd>
            <dt>IFSC</dt><dd>{c.ifsc || '—'}</dd>
          </dl>
        </div>
        <div className="card tight">
          <b>Payslips</b>
          {c.payslips.length ? c.payslips.map((p) => (
            <div key={p.id} className="list-item"><span className="grow">{fmtMonth(p.month)}</span><span className="small b6">{inr(p.net)}</span><Badge>{p.status}</Badge><a className="link" href={`/print/payslip/${p.id}`} target="_blank" rel="noreferrer">View</a></div>
          )) : <Empty text="No payslips yet" />}
        </div>
      </div>
    </div>
  );
}

function Assets({ data, reload }) {
  const { isHR, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ type: 'Laptop', name: '', serial: '' });
  const [run, busy] = useAction(toast);
  return (
    <div>
      {isHR && <div className="row between mb-12"><b>Assets issued</b><Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Issue asset</Button></div>}
      {data.assets.length ? (
        <table className="table">
          <thead><tr><th>Asset</th><th>Serial</th><th>Issued</th><th>Status</th>{isHR && <th />}</tr></thead>
          <tbody>{data.assets.map((a) => (
            <tr key={a.id}>
              <td><div className="b6">{a.name}</div><div className="small muted">{a.type}</div></td>
              <td className="small muted">{a.serial || '—'}</td>
              <td className="small">{fmtDate(a.issued_on)}</td>
              <td><Badge>{a.status}</Badge>{a.returned_on && <div className="xs muted">{fmtDate(a.returned_on)}</div>}</td>
              {isHR && <td className="right">{a.status === 'Issued' ? <Button size="xs" onClick={async () => { await run(() => api.put(`/assets/${a.id}`, { status: 'Returned' }), 'Marked returned'); reload(); }}>Mark returned</Button> : <Button size="xs" variant="ghost" onClick={async () => { await run(() => api.put(`/assets/${a.id}`, { status: 'Issued' })); reload(); }}>Re-issue</Button>}</td>}
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty text="No assets issued" />}
      {adding && (
        <Modal title="Issue asset" onClose={() => setAdding(false)} footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.post(`/employees/${data.employee.id}/assets`, f), 'Asset issued')) { setAdding(false); reload(); } }}>Issue</Button></>}>
          <div className="form-grid">
            <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={['Laptop', 'Phone', 'ID Card', 'Monitor', 'Headset', 'Vehicle', 'Other']} /></Field>
            <Field label="Name / model"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Dell Latitude 5440" /></Field>
            <Field label="Serial / tag" className="full"><Input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- forms
export function EmployeeForm({ employee, onClose, onSaved, selfOnly }) {
  const { meta, toast, isAdmin } = useApp();
  const e = employee?.employee;
  const c = employee?.compensation || {};
  const [f, setF] = useState(() => ({
    first_name: e?.first_name || '', last_name: e?.last_name || '', email: e?.email || '', phone: e?.phone || '', gender: e?.gender || '', dob: e?.dob || '',
    vertical_id: e?.vertical_id || '', department_id: e?.department_id || '', designation: e?.designation || '', grade: e?.grade || 'Executive',
    manager_id: e?.manager_id || '', employment_type: e?.employment_type || 'Full-time', location_id: e?.location_id || '', join_date: e?.join_date || meta.today,
    ctc: c.ctc ?? '', monthly_tds: c.monthlyTds ?? '', pan: c.pan || '', uan: c.uan || '', bank_name: c.bank_name || '', bank_account: c.bank_account || '', ifsc: c.ifsc || '',
    address: e?.address || '', emergency_contact: e?.emergency_contact || '', about: e?.about || '', skills: (e?.skills || []).join(', '),
    create_login: true, role: 'employee',
  }));
  const [run, busy] = useAction(toast);
  const [temp, setTemp] = useState(null);
  const set = (k) => (ev) => setF((s) => ({ ...s, [k]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value }));
  const save = async () => {
    const body = selfOnly
      ? { phone: f.phone, address: f.address, emergency_contact: f.emergency_contact, about: f.about, skills: f.skills }
      : { ...f, ctc: f.ctc === '' ? 0 : Number(f.ctc), monthly_tds: f.monthly_tds === '' ? '' : Number(f.monthly_tds) };
    if (!e) {
      const out = await run(() => api.post('/employees', body), 'Employee added');
      if (out) {
        onSaved?.(out.id);
        if (out.tempPassword) setTemp({ email: f.email, password: out.tempPassword });
        else onClose();
      }
    } else if (await run(() => api.put(`/employees/${e.id}`, body), 'Profile saved')) {
      onSaved?.(e.id);
      onClose();
    }
  };
  if (temp) return <TempPasswordModal email={temp.email} password={temp.password} onClose={onClose} />;
  const opts = (list) => list.map((x) => ({ value: x.id, label: x.name }));
  return (
    <Modal title={e ? (selfOnly ? 'Update my profile' : `Edit ${e.name}`) : 'Add employee'} size="wide" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{e ? 'Save changes' : 'Add employee'}</Button></>}>
      <div className="form-grid three">
        {!selfOnly && <>
          <div className="form-section">Personal</div>
          <Field label="First name *"><Input value={f.first_name} onChange={set('first_name')} /></Field>
          <Field label="Last name"><Input value={f.last_name} onChange={set('last_name')} /></Field>
          <Field label="Work email *"><Input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Gender"><Select value={f.gender} onChange={set('gender')} placeholder="Select" options={[{ value: 'F', label: 'Female' }, { value: 'M', label: 'Male' }, { value: 'O', label: 'Other' }]} /></Field>
          <Field label="Date of birth"><Input type="date" value={f.dob || ''} onChange={set('dob')} /></Field>
        </>}
        <Field label="Phone"><Input value={f.phone} onChange={set('phone')} placeholder="+91 98765 43210" /></Field>
        {!selfOnly && <>
          <div className="form-section">Job</div>
          <Field label="Vertical"><Select value={f.vertical_id} onChange={set('vertical_id')} placeholder="Select" options={opts(meta.verticals)} /></Field>
          <Field label="Department"><Select value={f.department_id} onChange={set('department_id')} placeholder="Select" options={opts(meta.departments)} /></Field>
          <Field label="Designation"><Input value={f.designation} onChange={set('designation')} /></Field>
          <Field label="Grade"><Select value={f.grade} onChange={set('grade')} options={['Executive', 'Senior', 'Manager', 'Head', 'CXO']} /></Field>
          <Field label="Reporting manager"><EmployeeSelect value={f.manager_id} onChange={set('manager_id')} placeholder="None" exclude={e ? [e.id] : []} /></Field>
          <Field label="Employment type"><Select value={f.employment_type} onChange={set('employment_type')} options={['Full-time', 'Part-time', 'Contract', 'Intern']} /></Field>
          <Field label="Work location"><Select value={f.location_id} onChange={set('location_id')} placeholder="Select" options={opts(meta.locations)} /></Field>
          <Field label="Joining date *"><Input type="date" value={f.join_date} onChange={set('join_date')} /></Field>
          <div className="form-section">Pay & statutory</div>
          <Field label="Annual CTC (₹)" hint={f.ctc ? `${lpa(Number(f.ctc) / 100000)}` : 'Gross cost to company per year'}><Input type="number" min="0" value={f.ctc} onChange={set('ctc')} /></Field>
          <Field label="Monthly TDS (₹)" hint="Leave blank to estimate (new regime)"><Input type="number" min="0" value={f.monthly_tds} onChange={set('monthly_tds')} /></Field>
          <Field label="PAN"><Input value={f.pan} onChange={set('pan')} placeholder="ABCDE1234F" maxLength={10} style={{ textTransform: 'uppercase' }} /></Field>
          <Field label="UAN"><Input value={f.uan} onChange={set('uan')} placeholder="12 digits" maxLength={12} /></Field>
          <Field label="Bank name"><Input value={f.bank_name} onChange={set('bank_name')} /></Field>
          <Field label="Account number"><Input value={f.bank_account} onChange={set('bank_account')} maxLength={18} /></Field>
          <Field label="IFSC"><Input value={f.ifsc} onChange={set('ifsc')} placeholder="HDFC0001234" maxLength={11} style={{ textTransform: 'uppercase' }} /></Field>
        </>}
        <div className="form-section">Profile</div>
        <Field label="Address" className="full"><Input value={f.address} onChange={set('address')} /></Field>
        <Field label="Emergency contact"><Input value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="Name · phone" /></Field>
        <Field label="Skills" hint="Comma separated" className="full" ><Input value={f.skills} onChange={set('skills')} /></Field>
        <Field label="About" className="full"><Textarea value={f.about} onChange={set('about')} maxLength={1000} /></Field>
        {!e && <>
          <div className="form-section">Login</div>
          <label className="check"><input type="checkbox" checked={f.create_login} onChange={set('create_login')} />Create HRMS login</label>
          {f.create_login && <Field label="Role"><Select value={f.role} onChange={set('role')} options={[{ value: 'employee', label: 'Employee' }, { value: 'manager', label: 'Manager' }, { value: 'hr', label: 'HR' }, ...(isAdmin ? [{ value: 'admin', label: 'Administrator' }] : [])]} /></Field>}
        </>}
      </div>
    </Modal>
  );
}

function LoginModal({ employee, login, onClose, onDone }) {
  const { toast, isAdmin } = useApp();
  const [role, setRole] = useState(login?.role || 'employee');
  const [run, busy] = useAction(toast);
  const [temp, setTemp] = useState(null);
  if (temp) return <TempPasswordModal email={temp.email} password={temp.tempPassword} onClose={() => { onDone(); onClose(); }} />;
  return (
    <Modal title={login ? 'Reset login' : 'Create login'} size="narrow" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { const out = await run(() => api.post(`/employees/${employee.id}/login`, { role })); if (out) setTemp(out); }}>{login ? 'Reset password' : 'Create login'}</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="small muted">{employee.name} will sign in with <b>{employee.email}</b>. A temporary password is generated; they must change it at first sign-in.</div>
        <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: 'employee', label: 'Employee' }, { value: 'manager', label: 'Manager' }, { value: 'hr', label: 'HR' }, ...(isAdmin ? [{ value: 'admin', label: 'Administrator' }] : [])]} /></Field>
      </div>
    </Modal>
  );
}

function ExitModal({ employee, onClose, onDone }) {
  const { toast, meta } = useApp();
  const [f, setF] = useState({ status: 'Exited', exit_date: meta.today });
  const [run, busy] = useAction(toast);
  return (
    <Modal title={`Exit ${employee.name}`} size="narrow" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="solid-red" loading={busy} onClick={async () => { if (await run(() => api.put(`/employees/${employee.id}`, f), 'Employee updated')) { onDone(); onClose(); } }}>Save</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="alert warn">For resignations use the Resignation module, which runs the offboarding checklist. Use this for terminations or corrections.</div>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'Notice', label: 'Serving notice' }, { value: 'Exited', label: 'Exited' }]} /></Field>
        <Field label={f.status === 'Exited' ? 'Last working day' : 'Planned last day'}><Input type="date" value={f.exit_date} onChange={(e) => setF({ ...f, exit_date: e.target.value })} /></Field>
        {f.status === 'Exited' && <div className="small muted">Their login is deactivated.</div>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- helpdesk
function Requests() {
  const { toast } = useApp();
  const { data, reload } = useApi('/requests');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction(toast);
  const [filter, setFilter] = useState('open');
  const items = useMemo(() => (data?.items || []).filter((r) => (filter === 'open' ? r.status !== 'Resolved' : true)), [data, filter]);
  return (
    <div>
      <div className="page-head"><div><h1>Helpdesk Requests</h1><div className="sub">Questions and requests raised by employees.</div></div>
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} options={[{ value: 'open', label: 'Open requests' }, { value: 'all', label: 'All requests' }]} style={{ width: 180 }} /></div>
      <Card flush>
        {!data ? <Loading /> : items.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Employee</th><th>Category</th><th>Subject</th><th>Raised</th><th>Status</th><th /></tr></thead>
            <tbody>{items.map((r) => (
              <tr key={r.id}>
                <td><Person name={r.employee} sub={r.code} id={r.employee_id} size={30} /></td>
                <td><Badge tone="blue">{r.category}</Badge></td>
                <td><div className="b6">{r.subject}</div>{r.description && <div className="small muted">{r.description}</div>}{r.response && <div className="small green">↳ {r.response}</div>}</td>
                <td className="small muted nowrap">{fmtDate(r.created_at)}</td>
                <td><Badge tone={toneOf(r.status === 'Open' ? 'Pending' : r.status)}>{r.status}</Badge></td>
                <td className="right"><Button size="sm" onClick={() => setEdit({ ...r, response: r.response || '' })}>Update</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty icon={Clock3} text="No open requests" />}
      </Card>
      {edit && (
        <Modal title={edit.subject} onClose={() => setEdit(null)} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={async () => { if (await run(() => api.put(`/requests/${edit.id}`, { status: edit.status, response: edit.response }), 'Request updated')) { setEdit(null); reload(); } }}>Save</Button></>}>
          <div className="col" style={{ gap: 12 }}>
            <div className="small muted">{edit.employee} · {edit.category}</div>
            {edit.description && <p>{edit.description}</p>}
            <Field label="Status"><Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })} options={['Open', 'In Progress', 'Resolved']} /></Field>
            <Field label="Response to employee"><Textarea value={edit.response} onChange={(e) => setEdit({ ...edit, response: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

