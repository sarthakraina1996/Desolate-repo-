// Settings: profile and two-step sign-in, property configuration, users and roles, the audit
// trail and system / module status.
import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useApi } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { date, dateTime, money, titleCase } from '../lib/format.js';
import { Async, Badge, Button, Card, Empty, Field, Input, Modal, Notice, PageHead, Select, useAction } from '../components/ui.jsx';
import { DataTable } from '../components/DataTable.jsx';

export default function Settings({ forceMfa }) {
  const { can } = useApp();
  if (forceMfa)
    return (
      <>
        <PageHead title="Set up two-step sign-in" sub="Your organisation requires it for your role before you continue" />
        <Mfa />
      </>
    );
  const links = [
    can('property.manage') && ['/settings', 'Property'],
    can('users.manage') && ['/settings/users', 'Users & roles'],
    ['/settings/profile', 'Profile & security'],
    can('audit.view') && ['/settings/audit', 'Audit trail'],
    ['/settings/system', 'System status'],
  ].filter(Boolean);
  return (
    <>
      <PageHead title="Settings" />
      <div className="tabs">
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {label}
          </NavLink>
        ))}
      </div>
      <Routes>
        <Route index element={can('property.manage') ? <PropertySettings /> : <Profile />} />
        <Route path="users" element={<Users />} />
        <Route path="profile" element={<Profile />} />
        <Route path="audit" element={<Audit />} />
        <Route path="system" element={<SystemStatus />} />
      </Routes>
    </>
  );
}

function Profile() {
  const { user } = useApp();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [run, busy] = useAction();
  return (
    <div className="grid g2">
      <Card title="Your account">
        <div className="dl">
          <dt>Name</dt>
          <dd>{user.name}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>{user.roleLabel}</dd>
          <dt>Organisation</dt>
          <dd>{user.orgName}</dd>
          <dt>Property access</dt>
          <dd>{user.allProperties ? 'All properties' : 'Assigned properties'}</dd>
        </div>
        <div className="divider" />
        <div className="stack" style={{ gap: 10 }}>
          <div className="small strong">Change password</div>
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="New password" hint="At least 10 characters with letters and numbers">
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Button busy={busy} disabled={!pw.current || !pw.next} onClick={() => run(async () => { await api.post('/auth/password', pw); setPw({ current: '', next: '' }); }, { success: 'Password changed' })}>
            Change password
          </Button>
        </div>
      </Card>
      <Mfa />
    </div>
  );
}

function Mfa() {
  const { user, setSession } = useApp();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [run, busy] = useAction();
  return (
    <Card title="Two-step sign-in" sub="A 6-digit code from an authenticator app (Google, Microsoft, 1Password…) at every sign-in">
      {user.mfaEnabled ? (
        <div className="stack">
          <Notice tone="good" icon={ShieldCheck}>Two-step sign-in is on.</Notice>
          <Field label="Code from your app (to turn it off)">
            <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Button busy={busy} disabled={code.length !== 6} onClick={() => run(async () => setSession(await api.post('/auth/mfa/disable', { code })), { success: 'Two-step sign-in turned off' })}>
            Turn off
          </Button>
        </div>
      ) : setup ? (
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} />
            <div className="small">
              <p>1. Scan the code with your authenticator app, or enter this key:</p>
              <p className="kbd" style={{ display: 'inline-block', margin: '6px 0', wordBreak: 'break-all' }}>{setup.secret}</p>
              <p>2. Enter the 6-digit code it shows.</p>
            </div>
          </div>
          <Field label="Code">
            <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
          </Field>
          <Button variant="primary" busy={busy} disabled={code.length !== 6} onClick={() => run(async () => setSession(await api.post('/auth/mfa/enable', { code })), { success: 'Two-step sign-in is on' })}>
            Turn on
          </Button>
        </div>
      ) : (
        <div className="stack">
          <p className="muted">Recommended for everyone, and required for owners, executives, finance and administrators when your organisation enables the policy.</p>
          <Button variant="primary" icon={KeyRound} busy={busy} onClick={() => run(async () => setSetup(await api.post('/auth/mfa/setup')))}>
            Set up two-step sign-in
          </Button>
        </div>
      )}
    </Card>
  );
}

function PropertySettings() {
  const { opProperty, property, properties, setScope, refresh } = useApp();
  const prop = property || opProperty;
  const q = useApi(prop ? `/properties/${prop.id}` : null);
  const [run, busy] = useAction();
  const [f, setF] = useState(null);
  return (
    <Async q={q}>
      {(d) => {
        const p = d.property;
        const v = f || p;
        const set = (k, val) => setF({ ...v, [k]: val });
        return (
          <div className="stack">
            {properties.length > 1 && (
              <div>
                <Select aria-label="Property" value={prop.id} onChange={(e) => { setScope(e.target.value); setF(null); }} options={properties.map((x) => ({ value: x.id, label: x.name }))} />
              </div>
            )}
            <div className="grid g2">
              <Card title="Property">
                <div className="form-grid">
                  <Field label="Name"><Input value={v.name} onChange={(e) => set('name', e.target.value)} /></Field>
                  <Field label="Brand"><Input value={v.brand || ''} onChange={(e) => set('brand', e.target.value)} /></Field>
                  <Field label="Category"><Input value={v.category || ''} onChange={(e) => set('category', e.target.value)} /></Field>
                  <Field label="Time zone"><Input value={v.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
                  <Field label="Address" className="span2"><Input value={v.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
                  <Field label="City"><Input value={v.city || ''} onChange={(e) => set('city', e.target.value)} /></Field>
                  <Field label="State / region"><Input value={v.state || ''} onChange={(e) => set('state', e.target.value)} /></Field>
                  <Field label="Check-in time"><Input type="time" value={v.check_in_time} onChange={(e) => set('check_in_time', e.target.value)} /></Field>
                  <Field label="Check-out time"><Input type="time" value={v.check_out_time} onChange={(e) => set('check_out_time', e.target.value)} /></Field>
                </div>
                <div className="dl" style={{ marginTop: 14 }}>
                  <dt>Code</dt><dd>{p.code}</dd>
                  <dt>Currency</dt><dd>{p.currency} (fixed: posted transactions depend on it)</dd>
                  <dt>Tax regime</dt><dd>{p.tax_regime === 'IN_GST' ? 'India GST' : p.tax_regime === 'EU_VAT' ? 'EU VAT' : 'None'} · prices {p.prices_include_tax ? 'include' : 'exclude'} tax</dd>
                  <dt>Business date</dt><dd>{date(p.business_date)} (moves only by night audit)</dd>
                </div>
              </Card>
              <Card title="Operating policies">
                <div className="stack">
                  <label className="check"><input type="checkbox" checked={Boolean(v.inspection_required)} onChange={(e) => set('inspection_required', e.target.checked)} /> Rooms must pass supervisor inspection before check-in</label>
                  <label className="check"><input type="checkbox" checked={Boolean(v.require_id_at_checkin)} onChange={(e) => set('require_id_at_checkin', e.target.checked)} /> Record an identity document at check-in</label>
                  <label className="check"><input type="checkbox" checked={Boolean(v.exclude_ooo_from_available)} onChange={(e) => set('exclude_ooo_from_available', e.target.checked)} /> Exclude out-of-order rooms from available rooms (metrics)</label>
                  <Field label="Overbooking allowance (% of sellable rooms, manager override only)"><Input type="number" min={0} max={20} value={v.overbooking_pct} onChange={(e) => set('overbooking_pct', Number(e.target.value))} /></Field>
                  <Button variant="primary" busy={busy} disabled={!f} onClick={() => run(async () => { await api.put(`/properties/${p.id}`, { name: v.name, brand: v.brand, category: v.category, timezone: v.timezone, address: v.address, city: v.city, state: v.state, check_in_time: v.check_in_time, check_out_time: v.check_out_time, inspection_required: v.inspection_required, require_id_at_checkin: v.require_id_at_checkin, exclude_ooo_from_available: v.exclude_ooo_from_available, overbooking_pct: v.overbooking_pct }); setF(null); q.reload(); refresh(); }, { success: 'Property saved' })}>
                    Save changes
                  </Button>
                </div>
              </Card>
            </div>
            <div className="grid g2">
              <Card title="Tax rules" sub="Demonstration values — verify with a tax adviser before production" flush>
                <DataTable rows={d.taxRules} pageSize={20} columns={[{ key: 'category', label: 'Category', render: (t) => titleCase(t.category) }, { key: 'name', label: 'Rule' }, { key: 'rate_bp', label: 'Rate', num: true, render: (t) => `${t.rate_bp / 100}%` }, { key: 'slab', label: 'Per-night value', sortable: false, render: (t) => (t.slab_min_minor != null ? `${money(t.slab_min_minor, p.currency, { decimals: 0 })} – ${t.slab_max_minor ? money(t.slab_max_minor, p.currency, { decimals: 0 }) : 'above'}` : 'Any') }, { key: 'effective_from', label: 'From', render: (t) => date(t.effective_from) }, { key: 'effective_to', label: 'To', render: (t) => (t.effective_to ? date(t.effective_to) : 'Current') }]} />
              </Card>
              <Card title="Charge codes and payment methods" flush>
                <DataTable rows={d.chargeCodes} pageSize={20} columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department', render: (c) => titleCase(c.department) }, { key: 'account_code', label: 'GL' }, { key: 'hsn_sac', label: 'SAC', render: (c) => c.hsn_sac || '—' }]} />
                <div style={{ padding: 12 }} className="row wrap">
                  {d.paymentMethods.map((m) => <span key={m.code} className="chip">{m.name} · GL {m.account_code}</span>)}
                </div>
              </Card>
            </div>
            <Card title="Buildings and floors">
              <div className="row wrap">
                {d.buildings.map((b) => (
                  <span key={b.id} className="chip">
                    <b>{b.name}</b> · floors {d.floors.filter((x) => x.building_id === b.id).map((x) => x.level).join(', ')}
                  </span>
                ))}
              </div>
            </Card>
          </div>
        );
      }}
    </Async>
  );
}

function Users() {
  const q = useApi('/users');
  const roles = useApi('/roles');
  const { properties } = useApp();
  const [create, setCreate] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'front_desk', properties: [], allProperties: false });
  const [created, setCreated] = useState(null);
  const [run, busy] = useAction();
  return (
    <div className="stack">
      <Card title="Users" flush action={<Button size="sm" onClick={() => setCreate(true)}>Add user</Button>}>
        <Async q={q}>
          {(rows) => (
            <DataTable
              rows={rows}
              exportName="users.csv"
              columns={[
                { key: 'name', label: 'Name', render: (u) => <><b>{u.name}</b><div className="sub">{u.title}</div></> },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role', render: (u) => roles.data?.roles.find((r) => r.code === u.role)?.label || u.role },
                { key: 'scope', label: 'Properties', sortable: false, render: (u) => (u.all_properties ? 'All' : u.properties.map((pid) => properties.find((p) => p.id === pid)?.code).filter(Boolean).join(', ') || '—') },
                { key: 'mfa_enabled', label: '2-step', render: (u) => (u.mfa_enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>) },
                { key: 'last_login_at', label: 'Last sign-in', render: (u) => dateTime(u.last_login_at) },
                { key: 'active', label: 'Status', render: (u) => (u.active ? <Badge tone="good">Active</Badge> : <Badge tone="danger">Disabled</Badge>) },
              ]}
            />
          )}
        </Async>
      </Card>
      <Card title="Roles and permissions" sub="Fixed matrix; every API route checks the permission it needs" flush>
        <Async q={roles}>
          {(r) => (
            <DataTable rows={r.roles.map((x) => ({ ...x, id: x.code }))} pageSize={20} columns={[{ key: 'label', label: 'Role', render: (x) => <b>{x.label}</b> }, { key: 'group', label: 'Scope', render: (x) => (x.group ? 'Group-level' : 'Property') }, { key: 'privileged', label: 'Privileged', render: (x) => (x.privileged ? <Badge tone="warn">MFA policy</Badge> : '') }, { key: 'permissions', label: 'Permissions', sortable: false, render: (x) => <span className="small muted">{x.permissions.join(', ')}</span> }]} />
          )}
        </Async>
      </Card>
      {create && (
        <Modal title="Add user" onClose={() => setCreate(false)} footer={<><Button onClick={() => setCreate(false)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!f.name || !f.email} onClick={() => run(async () => { const r = await api.post('/users', f); setCreated(r); setCreate(false); q.reload(); })}>Create</Button></>}>
          <div className="form-grid">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Role" className="span2"><Select value={f.role} options={(roles.data?.roles || []).map((r) => ({ value: r.code, label: r.label }))} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field>
            {roles.data?.roles.find((r) => r.code === f.role)?.group && <label className="check span2"><input type="checkbox" checked={f.allProperties} onChange={(e) => setF({ ...f, allProperties: e.target.checked })} /> All properties</label>}
            {!f.allProperties && (
              <div className="span2 row wrap">
                {properties.map((p) => <label key={p.id} className="check"><input type="checkbox" checked={f.properties.includes(p.id)} onChange={(e) => setF({ ...f, properties: e.target.checked ? [...f.properties, p.id] : f.properties.filter((x) => x !== p.id) })} /> {p.name}</label>)}
              </div>
            )}
          </div>
        </Modal>
      )}
      {created && (
        <Modal title="User created" onClose={() => setCreated(null)} footer={<Button variant="primary" onClick={() => setCreated(null)}>Done</Button>}>
          <Notice tone="warn">Give this one-time password to the user securely; they must change it at first sign-in. It is not shown again.</Notice>
          <p className="kbd" style={{ display: 'inline-block', marginTop: 12, fontSize: 14 }}>{created.temporaryPassword}</p>
        </Modal>
      )}
    </div>
  );
}

function Audit() {
  const { scope } = useApp();
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const q = useApi(`/audit${qs({ property: scope, action, limit: 50, offset: page * 50 })}`);
  return (
    <Card title="Audit trail" sub="Append-only: the database rejects edits and deletions" flush action={<Input className="search" placeholder="Action, e.g. folio. or reservation.cancelled" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} style={{ width: 280 }} />}>
      <Async q={q}>
        {(d) => (
          <DataTable
            rows={d.rows}
            total={d.total}
            page={page}
            pageSize={50}
            onPage={setPage}
            empty={<Empty title="No audit entries" />}
            columns={[
              { key: 'at', label: 'When', render: (a) => dateTime(a.at) },
              { key: 'user_name', label: 'User', render: (a) => a.user_name || 'System / channel' },
              { key: 'property_code', label: 'Property', render: (a) => a.property_code || '—' },
              { key: 'action', label: 'Action' },
              { key: 'entity', label: 'Record', render: (a) => (a.entity ? `${a.entity} #${a.entity_id ?? ''}` : '—') },
              { key: 'after', label: 'Details', sortable: false, render: (a) => <span className="small muted">{a.after ? a.after.slice(0, 140) : ''}</span> },
            ]}
          />
        )}
      </Async>
    </Card>
  );
}

function SystemStatus() {
  const mods = useApi('/system/modules');
  const st = useApi('/system/status');
  const TONE = { live: 'good', partial: 'warn', planned: '' };
  return (
    <div className="grid g-2-1">
      <Card title="Modules" sub="Status of record: docs/MODULE_STATUS.md" flush>
        <Async q={mods}>
          {(rows) => <DataTable rows={rows.map((m) => ({ ...m, id: m.key }))} pageSize={20} columns={[{ key: 'label', label: 'Module', render: (m) => <b>{m.label}</b> }, { key: 'status', label: 'Status', render: (m) => <Badge tone={TONE[m.status]}>{m.status === 'live' ? 'Live' : m.status === 'partial' ? 'Partial' : 'Planned'}</Badge> }, { key: 'phase', label: 'Phase', num: true }, { key: 'summary', label: 'Scope today', sortable: false, render: (m) => <span className="small">{m.summary}</span> }]} />}
        </Async>
      </Card>
      <Card title="This server">
        <Async q={st}>
          {(s) => (
            <div className="stack">
              <div className="dl">
                <dt>Mode</dt><dd>{s.mode === 'central' ? 'Central server' : s.mode}</dd>
                <dt>Sync queue</dt><dd>{s.sync.pending} pending · {s.sync.failed} failed</dd>
                <dt>HQ transport</dt><dd>{s.sync.transport}</dd>
              </div>
              <ul className="list-plain">
                {s.properties.map((p) => <li key={p.id}><b style={{ width: 48 }}>{p.code}</b><span style={{ flex: 1 }}>Business date {date(p.business_date)}</span><span className="small muted">last audit {dateTime(p.last_audit)}</span></li>)}
              </ul>
            </div>
          )}
        </Async>
      </Card>
    </div>
  );
}
