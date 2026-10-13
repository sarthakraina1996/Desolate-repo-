import { useMemo, useState } from 'react';
import { UserPlus, Search, ShieldCheck, Pencil, Info } from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { Loading, ErrorNote, Empty, Avatar, Modal, Field, LEVEL_LABEL, alpha, ink } from '../ui.jsx';
import { timeAgo } from '../format.js';

const LEVEL_HELP = {
  '': 'Cannot see this vertical',
  viewer: 'Sees projects, tasks and files. Cannot change anything.',
  member: 'Works on projects: tasks, files, milestones and comments. Can edit projects they own.',
  manager: 'Creates, edits, closes and re-runs projects. Manages templates.',
};

function AccessSelect({ id, value, onChange, disabled, color }) {
  return (
    <select id={id} className={`select sm access-select lvl-${value || 'none'}`} value={value || ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled}
      style={value ? { background: alpha(color, value === 'manager' ? 0.2 : value === 'member' ? 0.12 : 0.06), color: ink(color), borderColor: alpha(color, 0.35) } : undefined}
      title={LEVEL_HELP[value || '']}>
      <option value="">No access</option>
      <option value="viewer">Viewer</option>
      <option value="member">Member</option>
      <option value="manager">Manager</option>
    </select>
  );
}

function PersonForm({ person, verticals, onClose, onSaved }) {
  const { toast, me } = useApp();
  const editing = !!person;
  const [f, setF] = useState(() => ({
    name: person?.name || '', email: person?.email || '', title: person?.title || '', phone: person?.phone || '',
    role: person?.role || 'member', active: person ? !!person.active : true, password: '', access: { ...(person?.access || {}) },
  }));
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const body = { name: f.name, email: f.email, title: f.title, phone: f.phone, role: f.role, access: f.access };
    if (editing) body.active = f.active;
    if (f.password) body.password = f.password;
    else if (!editing && demo) body.password = 'demo1234';
    try {
      const saved = editing ? await api.patch(`/admin/users/${person.id}`, body) : await api.post('/admin/users', body);
      toast(editing ? 'Saved' : `${saved.name} added. Share the temporary password with them.`, 'success');
      onSaved(saved);
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  };
  const demo = api.isDemo();
  return (
    <Modal title={editing ? `Edit ${person.name}` : 'Add a person'} onClose={onClose} size="wide"
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" form="person-form" className="btn primary" disabled={saving}>{editing ? 'Save' : 'Add person'}</button></>}>
      <form id="person-form" className="modal-body" onSubmit={submit}>
        {err && <div className="alert error mb-12">{err}</div>}
        <div className="form-grid">
          <Field label="Full name" htmlFor="pp-name"><input id="pp-name" className="input" value={f.name} onChange={set('name')} required maxLength={120} /></Field>
          <Field label="Work email" htmlFor="pp-email"><input id="pp-email" type="email" className="input" value={f.email} onChange={set('email')} required /></Field>
          <Field label="Job title" htmlFor="pp-title"><input id="pp-title" className="input" value={f.title} onChange={set('title')} maxLength={120} /></Field>
          <Field label="Phone" htmlFor="pp-phone"><input id="pp-phone" className="input" value={f.phone} onChange={set('phone')} maxLength={40} /></Field>
          <Field label="Role" htmlFor="pp-role" hint={f.role === 'admin' ? 'Admins see every vertical and manage people and settings.' : 'Access depends on the verticals below.'}>
            <select id="pp-role" className="select" value={f.role} onChange={set('role')} disabled={editing && person.id === me.id}>
              <option value="member">Team member</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <Field label={editing ? 'Reset password' : 'Temporary password'} htmlFor="pp-pass" hint={demo ? 'Passwords are not used in the demo.' : editing ? 'Leave empty to keep the current password.' : 'They will be asked to change it after signing in.'}>
            <input id="pp-pass" className="input" type="text" value={f.password} onChange={set('password')} minLength={8} required={!editing && !demo} placeholder={demo ? 'demo1234' : 'At least 8 characters'} autoComplete="new-password" />
          </Field>
          <div className="form-section">Vertical access</div>
          <div className="full col" style={{ gap: 10 }}>
            {f.role === 'admin' ? <div className="alert info"><ShieldCheck size={16} />Admins can see and manage every vertical.</div> : verticals.map((v) => (
              <div key={v.id} className="row" style={{ gap: 12 }}>
                <span className="row gap-6" style={{ width: 170 }}><span className="dot" style={{ background: v.color }} /><b>{v.name}</b></span>
                <AccessSelect id={`pp-access-${v.id}`} value={f.access[v.id]} color={v.color} onChange={(lvl) => setF((x) => ({ ...x, access: { ...x.access, [v.id]: lvl || undefined } }))} />
                <span className="xs muted grow hide-sm">{LEVEL_HELP[f.access[v.id] || '']}</span>
              </div>
            ))}
          </div>
          {editing && person.id !== me.id && (
            <label className="check full mt-8"><input id="pp-active" type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />Active. Untick when someone leaves; their work and history stay.</label>
          )}
        </div>
      </form>
    </Modal>
  );
}

export default function Team() {
  const { isAdmin, toast, loadBoot, me } = useApp();
  const { data, loading, error, reload, setData } = useLoad(() => Promise.all([api.get('/admin/users'), api.get('/admin/verticals')]).then(([u, v]) => ({ users: u.items, verticals: v.items.filter((x) => x.active) })), []);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // person | 'new'
  const users = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.users || []).filter((u) => (showInactive || u.active) && (!term || `${u.name} ${u.email} ${u.title}`.toLowerCase().includes(term)));
  }, [data, q, showInactive]);

  if (!isAdmin) return <div className="card"><Empty title="Only admins can manage people and access" /></div>;

  const setAccess = async (u, vid, level) => {
    const access = { ...u.access, [vid]: level || undefined };
    for (const k of Object.keys(access)) if (!access[k]) delete access[k];
    setData((d) => ({ ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, access } : x)) }));
    try {
      await api.patch(`/admin/users/${u.id}`, { access });
      const v = data.verticals.find((x) => x.id === vid);
      toast(`${u.name}: ${level ? `${LEVEL_LABEL[level]} in ${v.short}` : `no access to ${v.short}`}`, 'success');
      if (u.id === me.id) loadBoot();
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };
  const counts = (vid) => (data?.users || []).filter((u) => u.active && (u.role === 'admin' || u.access[vid])).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team & Access</h1>
          <div className="sub">Choose who can see each vertical. People only ever see projects, tasks and files from verticals they have access to.</div>
        </div>
        <button type="button" className="btn primary" onClick={() => setEditing('new')}><UserPlus size={18} />Add person</button>
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="kpis">
            {data.verticals.map((v) => (
              <div key={v.id} className="card tight row" style={{ gap: 14 }}>
                <span className="vbadge" style={{ background: alpha(v.color, 0.15), color: ink(v.color) }}>{v.code}</span>
                <div><div className="b6">{v.name}</div><div className="small muted">{counts(v.id)} people · {v.projects} projects</div></div>
              </div>
            ))}
          </div>
          <div className="filters mb-12">
            <div className="input-icon"><Search size={16} /><input id="team-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" /></div>
            <label className="check"><input id="team-inactive" type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show people who have left</label>
          </div>
          <div className="card flush">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Person</th>
                    {data.verticals.map((v) => <th key={v.id}><span className="row gap-6"><span className="dot" style={{ background: v.color }} />{v.short}</span></th>)}
                    <th className="hide-sm">Open tasks</th>
                    <th className="hide-sm">Last sign-in</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} style={!u.active ? { opacity: 0.55 } : undefined}>
                      <td>
                        <div className="person">
                          <Avatar name={u.name} color={u.color} size={34} />
                          <div style={{ minWidth: 0 }}>
                            <div className="pn">{u.name} {u.role === 'admin' && <span className="badge b-blue" style={{ padding: '1px 7px', fontSize: 11 }}>Admin</span>}{!u.active && <span className="badge b-gray" style={{ padding: '1px 7px', fontSize: 11, marginLeft: 4 }}>Left</span>}</div>
                            <div className="ps ellipsis">{u.title || u.email}</div>
                          </div>
                        </div>
                      </td>
                      {data.verticals.map((v) => (
                        <td key={v.id}>
                          {u.role === 'admin' ? <span className="small muted">All access</span> : (
                            <AccessSelect id={`acc-${u.id}-${v.id}`} value={u.access[v.id]} color={v.color} disabled={!u.active} onChange={(lvl) => setAccess(u, v.id, lvl)} />
                          )}
                        </td>
                      ))}
                      <td className="hide-sm num" style={{ textAlign: 'left' }}>{u.open_tasks}</td>
                      <td className="hide-sm small muted">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</td>
                      <td className="right"><button type="button" className="btn xs" onClick={() => setEditing(u)}><Pencil size={13} />Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="alert info mt-16">
            <Info size={16} />
            <div><b>Viewer</b>: {LEVEL_HELP.viewer} <b>Member</b>: {LEVEL_HELP.member} <b>Manager</b>: {LEVEL_HELP.manager}</div>
          </div>
        </>
      )}
      {editing && <PersonForm person={editing === 'new' ? null : editing} verticals={data?.verticals || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload({ quiet: true }); loadBoot(); }} />}
    </>
  );
}
