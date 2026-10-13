import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Modal, Field, UserSelect, Avatar, PROJECT_STATUS, HEALTH, PRIORITY } from '../ui.jsx';
import { fmtDate } from '../format.js';

const blank = {
  vertical_id: '', name: '', client: '', description: '', status: 'planning', health: 'on_track', priority: 'medium',
  owner_id: null, start_date: '', due_date: '', key_date: '', venue: '', city: '', budget: '', tags: '', member_ids: [],
};

// Create a project (from a template, a past project, or blank) or edit one.
export function ProjectForm({ project, copyFrom, onClose, onSaved }) {
  const { me, manageableVerticals, verticals, templates, assignable, today, toast, verticalById, vertical: vFilter, users } = useApp();
  const editing = !!project;
  const initialV = project?.vertical_id || copyFrom?.vertical_id || (manageableVerticals.some((v) => v.id === vFilter) ? vFilter : manageableVerticals[0]?.id) || '';
  const [f, setF] = useState(() => {
    if (project) {
      return {
        ...blank, ...project, budget: project.budget ?? '', tags: (project.tags || []).join(', '),
        start_date: project.start_date || '', due_date: project.due_date || '', key_date: project.key_date || '',
        member_ids: (project.members || []).map((m) => m.id),
      };
    }
    if (copyFrom) {
      return {
        ...blank, vertical_id: copyFrom.vertical_id, name: copyFrom.name, client: copyFrom.client, description: copyFrom.description,
        venue: copyFrom.venue, city: copyFrom.city, budget: copyFrom.budget ?? '', tags: (copyFrom.tags || []).join(', '),
        owner_id: copyFrom.owner_id, start_date: today, priority: copyFrom.priority,
      };
    }
    return { ...blank, vertical_id: initialV, owner_id: me.id, start_date: today };
  });
  const [source, setSource] = useState(copyFrom ? `copy:${copyFrom.id}` : '');
  const [pastProjects, setPastProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const vId = Number(f.vertical_id);
  const v = verticalById(vId);
  const vTemplates = templates.filter((t) => t.vertical_id === vId);
  const people = assignable(vId);
  const teamPool = users.filter((u) => u.role === 'admin' || u.access?.[vId]);

  useEffect(() => {
    if (editing || !vId) return;
    if (!copyFrom) setSource(vTemplates[0] ? `tpl:${vTemplates[0].id}` : '');
    api.get('/projects', { vertical: vId, scope: 'all' }).then((r) => setPastProjects(r.items)).catch(() => {});
    if (f.owner_id && !people.some((p) => p.id === f.owner_id)) setF((x) => ({ ...x, owner_id: people.some((p) => p.id === me.id) ? me.id : null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vId]);

  useEffect(() => {
    api.get('/projects/facets', { vertical: vId || undefined }).then((r) => setClients(r.clients.map((c) => c.name))).catch(() => {});
  }, [vId]);

  const sourceInfo = useMemo(() => {
    if (source.startsWith('tpl:')) {
      const t = templates.find((x) => x.id === Number(source.slice(4)));
      return t ? `${t.stages.length} stages: ${t.stages.join(' → ')}` : '';
    }
    if (source.startsWith('copy:')) {
      const p = pastProjects.find((x) => x.id === Number(source.slice(5))) || copyFrom;
      return p ? `Copies ${p.task_total ?? ''} tasks, milestones and team from ${p.code}. Dates move to match the new ${v?.key_date_label?.toLowerCase() || 'key date'}.` : '';
    }
    return 'Starts with four simple stages: Plan, Execute, Deliver, Close.';
  }, [source, templates, pastProjects, copyFrom, v]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr('Give the project a name');
    if (!vId) return setErr('Choose a vertical');
    setSaving(true);
    const body = {
      name: f.name, client: f.client, description: f.description, priority: f.priority, owner_id: f.owner_id,
      start_date: f.start_date || null, due_date: f.due_date || null, key_date: f.key_date || null,
      venue: f.venue, city: f.city, budget: f.budget === '' ? null : Number(String(f.budget).replace(/[,₹\s]/g, '')), tags: f.tags,
    };
    try {
      let saved;
      if (editing) {
        saved = await api.patch(`/projects/${project.id}`, { ...body, status: f.status, health: f.health, vertical_id: vId });
        const before = (project.members || []).map((m) => m.id).sort().join();
        const team = [...new Set([...f.member_ids, f.owner_id].filter(Boolean))];
        if (before !== [...team].sort().join()) await api.put(`/projects/${project.id}/members`, { user_ids: team });
        toast('Project updated', 'success');
      } else {
        saved = await api.post('/projects', {
          ...body, vertical_id: vId, status: f.status, member_ids: f.member_ids,
          template_id: source.startsWith('tpl:') ? Number(source.slice(4)) : undefined,
          copy_from: source.startsWith('copy:') ? Number(source.slice(5)) : undefined,
        });
        toast(`${saved.code} created${saved.tasks_created ? ` with ${saved.tasks_created} tasks` : ''}`, 'success');
      }
      onSaved(saved);
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  };

  const toggleMember = (id) => setF((x) => ({ ...x, member_ids: x.member_ids.includes(id) ? x.member_ids.filter((m) => m !== id) : [...x.member_ids, id] }));
  const moveTargets = editing ? verticals.filter((x) => manageableVerticals.some((m) => m.id === x.id)) : manageableVerticals;

  return (
    <Modal title={editing ? `Edit ${project.code}` : copyFrom ? `Run ${copyFrom.code} again` : 'New project'} sub={editing ? project.name : 'Set up the basics now. You can change everything later.'} onClose={onClose} size="wide"
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="project-form" className="btn primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create project'}</button>
      </>}>
      <form id="project-form" className="modal-body" onSubmit={submit}>
        {err && <div className="alert error mb-12">{err}</div>}
        <div className="form-grid">
          <Field label="Vertical" htmlFor="pf-vertical">
            <select id="pf-vertical" className="select" value={f.vertical_id} onChange={set('vertical_id')} disabled={editing && moveTargets.length < 2}>
              {!f.vertical_id && <option value="">Choose…</option>}
              {(editing ? (moveTargets.some((x) => x.id === vId) ? moveTargets : [v, ...moveTargets].filter(Boolean)) : manageableVerticals).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          {!editing ? (
            <Field label="Start from" htmlFor="pf-source" hint={sourceInfo}>
              <select id="pf-source" className="select" value={source} onChange={(e) => setSource(e.target.value)}>
                {vTemplates.length > 0 && (
                  <optgroup label="Templates">
                    {vTemplates.map((t) => <option key={t.id} value={`tpl:${t.id}`}>{t.name}</option>)}
                  </optgroup>
                )}
                {pastProjects.length > 0 && (
                  <optgroup label="Copy an earlier project">
                    {pastProjects.map((p) => <option key={p.id} value={`copy:${p.id}`}>{p.code} · {p.client ? `${p.client} – ` : ''}{p.name}</option>)}
                  </optgroup>
                )}
                {copyFrom && !pastProjects.some((p) => p.id === copyFrom.id) && <option value={`copy:${copyFrom.id}`}>{copyFrom.code} · {copyFrom.name}</option>}
                <option value="">Blank project</option>
              </select>
            </Field>
          ) : (
            <Field label="Status" htmlFor="pf-status">
              <select id="pf-status" className="select" value={f.status} onChange={set('status')}>
                {Object.entries(PROJECT_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
              </select>
            </Field>
          )}

          <Field label="Project name" className="full" htmlFor="pf-name">
            <input id="pf-name" className="input" value={f.name} onChange={set('name')} placeholder={v?.short === 'Exhibits' ? 'e.g. Pharma Expo stall, 72 sqm' : v?.short === 'Live' ? 'e.g. Annual dealer meet' : 'e.g. Festive campaign'} maxLength={160} required />
          </Field>
          <Field label="Client" htmlFor="pf-client">
            <input id="pf-client" className="input" list="pf-clients" value={f.client} onChange={set('client')} placeholder="Client or brand" maxLength={160} />
            <datalist id="pf-clients">{clients.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Project owner" htmlFor="pf-owner">
            <UserSelect id="pf-owner" value={f.owner_id} onChange={set('owner_id')} people={people} placeholder="Choose owner" />
          </Field>

          <div className="form-section">Dates</div>
          <Field label="Start" htmlFor="pf-start"><input id="pf-start" type="date" className="input" value={f.start_date} onChange={set('start_date')} /></Field>
          <Field label={v?.key_date_label || 'Key date'} htmlFor="pf-key" hint={source.startsWith('tpl:') || source.startsWith('copy:') ? 'Task dates are planned back from this date.' : 'The day that matters most: event, show or launch.'}>
            <input id="pf-key" type="date" className="input" value={f.key_date} onChange={set('key_date')} />
          </Field>
          <Field label="Wrap-up / due" htmlFor="pf-due" hint="When the project closes, including reports and invoicing.">
            <input id="pf-due" type="date" className="input" value={f.due_date} onChange={set('due_date')} min={f.start_date || undefined} />
          </Field>
          <Field label="Priority" htmlFor="pf-priority">
            <select id="pf-priority" className="select" value={f.priority} onChange={set('priority')}>
              {Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </Field>

          <div className="form-section">Where and how much</div>
          <Field label={v?.short === 'Marketing' ? 'Channels / market' : 'Venue'} htmlFor="pf-venue"><input id="pf-venue" className="input" value={f.venue} onChange={set('venue')} maxLength={200} placeholder={v?.short === 'Exhibits' ? 'Exhibition centre, hall' : v?.short === 'Marketing' ? 'TV, digital, OOH' : 'Venue'} /></Field>
          <Field label="City" htmlFor="pf-city"><input id="pf-city" className="input" value={f.city} onChange={set('city')} maxLength={80} /></Field>
          <Field label="Budget (₹)" htmlFor="pf-budget" hint={f.budget ? `₹${Number(String(f.budget).replace(/[,₹\s]/g, '') || 0).toLocaleString('en-IN')}` : 'Client budget or approved cost'}>
            <input id="pf-budget" className="input" inputMode="numeric" value={f.budget} onChange={set('budget')} placeholder="e.g. 1850000" />
          </Field>
          <Field label="Tags" htmlFor="pf-tags" hint="Comma separated. Helps you find old projects later.">
            <input id="pf-tags" className="input" value={f.tags} onChange={set('tags')} placeholder="pharma, island stall" />
          </Field>
          {editing && (
            <Field label="Health" htmlFor="pf-health">
              <select id="pf-health" className="select" value={f.health} onChange={set('health')}>
                {Object.entries(HEALTH).map(([k, h]) => <option key={k} value={k}>{h.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Brief / description" className="full" htmlFor="pf-desc">
            <textarea id="pf-desc" className="textarea" rows={4} value={f.description} onChange={set('description')} placeholder="Scope, deliverables, what the client cares about" />
          </Field>

          <div className="form-section">Team</div>
          <div className="full">
            <div className="pick-chips">
              {teamPool.map((u) => (
                <button key={u.id} type="button" className={`pick-chip person-chip ${f.member_ids.includes(u.id) || u.id === f.owner_id ? 'on' : ''}`} onClick={() => toggleMember(u.id)} disabled={u.id === f.owner_id} title={u.id === f.owner_id ? 'Project owner' : u.title}>
                  <Avatar name={u.name} color={u.color} size={20} />{u.name}
                </button>
              ))}
            </div>
            <div className="hint small muted mt-8">Only people with access to {v?.name || 'this vertical'} are listed.{f.start_date && f.key_date ? ` Planned span: ${fmtDate(f.start_date, { today })} to ${fmtDate(f.key_date, { today })}.` : ''}</div>
          </div>
        </div>
      </form>
    </Modal>
  );
}
