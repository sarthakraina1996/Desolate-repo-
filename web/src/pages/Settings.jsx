import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil, LayoutTemplate, Layers, Building2 } from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { useRouter } from '../router.jsx';
import { Loading, ErrorNote, Empty, Modal, Field, VChip, PRIORITY, alpha, ink } from '../ui.jsx';

function move(list, i, d) {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const c = [...list];
  [c[i], c[j]] = [c[j], c[i]];
  return c;
}

function TemplateForm({ template, verticals, onClose, onSaved }) {
  const { toast, confirm } = useApp();
  const editing = !!template?.id;
  const [f, setF] = useState(() => ({
    vertical_id: template?.vertical_id || verticals[0]?.id,
    name: template?.name || '',
    description: template?.description || '',
    stages: template?.stages?.length ? template.stages : ['Plan', 'Execute', 'Deliver', 'Close'],
    milestones: template?.milestones || [],
    tasks: template?.tasks || [],
  }));
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const v = verticals.find((x) => x.id === Number(f.vertical_id));
  const keyLabel = v?.key_date_label?.toLowerCase() || 'key date';

  const setStage = (i, val) => setF((x) => {
    const old = x.stages[i];
    const stages = x.stages.map((s, j) => (j === i ? val : s));
    return { ...x, stages, tasks: x.tasks.map((t) => (t.stage === old ? { ...t, stage: val } : t)) };
  });
  const setRow = (key, i, patch) => setF((x) => ({ ...x, [key]: x[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const removeRow = (key, i) => setF((x) => ({ ...x, [key]: x[key].filter((_, j) => j !== i) }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const body = { ...f, stages: f.stages.map((s) => s.trim()).filter(Boolean) };
      const saved = editing ? await api.patch(`/templates/${template.id}`, body) : await api.post('/templates', body);
      toast('Template saved', 'success');
      onSaved(saved);
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  };
  const del = async () => {
    if (!(await confirm({ title: `Delete “${template.name}”?`, message: 'Projects already created from it are not affected.', confirmLabel: 'Delete template', danger: true }))) return;
    try {
      await api.del(`/templates/${template.id}`);
      toast('Template deleted', 'success');
      onSaved(null);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const sortedTasks = f.tasks.map((t, i) => ({ ...t, i }));

  return (
    <Modal title={editing ? `Edit template` : 'New template'} sub="A ready-made plan: stages, milestones and tasks timed against the key date." onClose={onClose} size="xwide"
      footer={<>
        {editing && <button type="button" className="btn danger" style={{ marginRight: 'auto' }} onClick={del}><Trash2 size={15} />Delete</button>}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="tpl-form" className="btn primary" disabled={saving}>Save template</button>
      </>}>
      <form id="tpl-form" className="modal-body" onSubmit={submit}>
        {err && <div className="alert error mb-12">{err}</div>}
        <div className="form-grid three">
          <Field label="Vertical" htmlFor="tf-v">
            <select id="tf-v" className="select" value={f.vertical_id} onChange={(e) => setF({ ...f, vertical_id: Number(e.target.value) })} disabled={editing}>
              {verticals.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Template name" htmlFor="tf-name"><input id="tf-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} placeholder="e.g. Exhibition stall" /></Field>
          <Field label="Used for" htmlFor="tf-desc"><input id="tf-desc" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} placeholder="When to use this template" /></Field>
        </div>

        <div className="form-section mt-16" style={{ marginBottom: 8 }}>Stages, in order</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {f.stages.map((s, i) => (
            <div key={i} className="stage-edit">
              <span className="xs muted b6">{i + 1}</span>
              <input id={`tf-stage-${i}`} className="input sm" value={s} onChange={(e) => setStage(i, e.target.value)} aria-label={`Stage ${i + 1}`} maxLength={80} />
              <button type="button" className="icon-btn sm-x" onClick={() => setF((x) => ({ ...x, stages: move(x.stages, i, -1) }))} aria-label="Move earlier" disabled={i === 0}><ArrowUp size={13} /></button>
              <button type="button" className="icon-btn sm-x" onClick={() => setF((x) => ({ ...x, stages: x.stages.filter((_, j) => j !== i) }))} aria-label={`Remove ${s}`} disabled={f.stages.length < 2}><Trash2 size={13} /></button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => setF((x) => ({ ...x, stages: [...x.stages, `Stage ${x.stages.length + 1}`] }))}><Plus size={14} />Stage</button>
        </div>

        <div className="form-section mt-16" style={{ marginBottom: 8 }}>Milestones</div>
        <div className="col" style={{ gap: 6 }}>
          {f.milestones.map((m, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              <input id={`tf-ms-${i}`} className="input sm grow" value={m.title} onChange={(e) => setRow('milestones', i, { title: e.target.value })} aria-label="Milestone" />
              <OffsetInput id={`tf-ms-off-${i}`} value={m.offset} onChange={(o) => setRow('milestones', i, { offset: o })} keyLabel={keyLabel} />
              <button type="button" className="icon-btn sm-x" onClick={() => removeRow('milestones', i)} aria-label="Remove milestone"><Trash2 size={14} /></button>
            </div>
          ))}
          <div><button type="button" className="btn sm" onClick={() => setF((x) => ({ ...x, milestones: [...x.milestones, { title: '', offset: 0 }] }))}><Plus size={14} />Milestone</button></div>
        </div>

        <div className="form-section mt-16" style={{ marginBottom: 8 }}>Tasks ({f.tasks.length})</div>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Task</th><th>Stage</th><th>When</th><th>Priority</th><th /></tr></thead>
            <tbody>
              {sortedTasks.map((t) => (
                <tr key={t.i}>
                  <td style={{ minWidth: 220 }}><input id={`tf-task-${t.i}`} className="input sm" value={t.title} onChange={(e) => setRow('tasks', t.i, { title: e.target.value })} aria-label="Task title" /></td>
                  <td><select id={`tf-task-stage-${t.i}`} className="select sm" value={t.stage} onChange={(e) => setRow('tasks', t.i, { stage: e.target.value })} aria-label="Stage">{f.stages.map((s) => <option key={s}>{s}</option>)}</select></td>
                  <td><OffsetInput id={`tf-task-off-${t.i}`} value={t.offset} onChange={(o) => setRow('tasks', t.i, { offset: o })} keyLabel={keyLabel} /></td>
                  <td><select id={`tf-task-pr-${t.i}`} className="select sm" value={t.priority || 'medium'} onChange={(e) => setRow('tasks', t.i, { priority: e.target.value })} aria-label="Priority">{Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}</select></td>
                  <td className="nowrap">
                    <button type="button" className="icon-btn sm-x" onClick={() => setF((x) => ({ ...x, tasks: move(x.tasks, t.i, -1) }))} aria-label="Move up"><ArrowUp size={13} /></button>
                    <button type="button" className="icon-btn sm-x" onClick={() => setF((x) => ({ ...x, tasks: move(x.tasks, t.i, 1) }))} aria-label="Move down"><ArrowDown size={13} /></button>
                    <button type="button" className="icon-btn sm-x" onClick={() => removeRow('tasks', t.i)} aria-label="Remove task"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn sm mt-8" onClick={() => setF((x) => ({ ...x, tasks: [...x.tasks, { title: '', stage: x.stages[0], offset: 0, priority: 'medium' }] }))}><Plus size={14} />Task</button>
      </form>
    </Modal>
  );
}

function OffsetInput({ id, value, onChange, keyLabel }) {
  const n = Number(value) || 0;
  return (
    <span className="offset">
      <input id={id} type="number" className="input sm" value={Math.abs(n)} min={0} max={365} onChange={(e) => onChange((n < 0 ? -1 : 1) * Math.abs(Number(e.target.value) || 0))} aria-label="Days" />
      <select id={`${id}-dir`} className="select sm" value={n < 0 ? 'before' : n > 0 ? 'after' : 'on'} onChange={(e) => onChange(e.target.value === 'before' ? -Math.abs(n || 1) : e.target.value === 'after' ? Math.abs(n || 1) : 0)} aria-label="Before or after">
        <option value="before">days before</option>
        <option value="on">on the {keyLabel}</option>
        <option value="after">days after</option>
      </select>
    </span>
  );
}

function Templates() {
  const { manageableVerticals, loadBoot } = useApp();
  const { data, loading, error, reload } = useLoad(() => api.get('/templates'), []);
  const [editing, setEditing] = useState(null);
  const items = data?.items || [];
  return (
    <>
      <div className="row between mb-12">
        <p className="muted small" style={{ maxWidth: 680, lineHeight: 1.5 }}>Templates turn a new project into a full plan in one step. Task dates are counted back from the event, show or launch date, so the plan lines up with the day that matters. Tip: on any finished project, use <b>Save as template</b> to capture what worked.</p>
        {manageableVerticals.length > 0 && <button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={17} />New template</button>}
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : items.length === 0 ? <div className="card"><Empty icon={LayoutTemplate} title="No templates yet" /></div> : (
        <div className="tpl-grid">
          {items.map((t) => (
            <article key={t.id} className="card tpl" style={{ borderTop: `3px solid ${t.vertical_color}` }}>
              <div className="row between"><VChip name={t.vertical} color={t.vertical_color} small />{t.can_edit && <button type="button" className="btn xs" onClick={() => setEditing(t)}><Pencil size={13} />Edit</button>}</div>
              <h3 className="mt-8" style={{ fontSize: 16 }}>{t.name}</h3>
              {t.description && <p className="small muted mt-4">{t.description}</p>}
              <div className="tpl-stages mt-12">{t.stages.map((s, i) => <span key={i}>{s}</span>)}</div>
              <div className="xs muted mt-12">{t.tasks.length} tasks · {t.milestones.length} milestones</div>
            </article>
          ))}
        </div>
      )}
      {editing && <TemplateForm template={editing.id ? editing : null} verticals={manageableVerticals} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload({ quiet: true }); loadBoot(); }} />}
    </>
  );
}

function VerticalForm({ vertical, onClose, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState(() => ({ name: '', short: '', code: '', tagline: '', color: '#7c5cfc', key_date_label: 'Key date', ...vertical, active: vertical ? !!vertical.active : true }));
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      const body = { name: f.name, short: f.short, code: f.code, tagline: f.tagline, color: f.color, key_date_label: f.key_date_label, active: f.active };
      const saved = vertical ? await api.patch(`/admin/verticals/${vertical.id}`, body) : await api.post('/admin/verticals', body);
      toast('Vertical saved', 'success');
      onSaved(saved);
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <Modal title={vertical ? `Edit ${vertical.name}` : 'Add a vertical'} sub="Use verticals for business units or industries. Each one has its own people, projects and templates." onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" form="v-form" className="btn primary">Save</button></>}>
      <form id="v-form" className="modal-body form-grid" onSubmit={submit}>
        {err && <div className="alert error full">{err}</div>}
        <Field label="Full name" htmlFor="vf-name"><input id="vf-name" className="input" value={f.name} onChange={set('name')} required placeholder="BrainADZ Retail" /></Field>
        <Field label="Short name" htmlFor="vf-short"><input id="vf-short" className="input" value={f.short} onChange={set('short')} required placeholder="Retail" maxLength={30} /></Field>
        <Field label="Project code prefix" htmlFor="vf-code" hint="2 to 6 letters, used in codes like RTL-26-001"><input id="vf-code" className="input" value={f.code} onChange={set('code')} required maxLength={6} placeholder="RTL" /></Field>
        <Field label="Name of the key date" htmlFor="vf-key" hint="e.g. Event date, Show opens, Launch date, Go-live"><input id="vf-key" className="input" value={f.key_date_label} onChange={set('key_date_label')} maxLength={40} /></Field>
        <Field label="Tagline" htmlFor="vf-tag" className="full"><input id="vf-tag" className="input" value={f.tagline} onChange={set('tagline')} maxLength={120} /></Field>
        <Field label="Colour" htmlFor="vf-color"><input id="vf-color" type="color" className="input" value={f.color} onChange={set('color')} style={{ padding: 4 }} /></Field>
        {vertical && <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input id="vf-active" type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />Active</label>}
      </form>
    </Modal>
  );
}

function Verticals() {
  const { loadBoot } = useApp();
  const { data, loading, error, reload } = useLoad(() => api.get('/admin/verticals'), []);
  const [editing, setEditing] = useState(null);
  return (
    <>
      <div className="row between mb-12">
        <p className="muted small" style={{ maxWidth: 680, lineHeight: 1.5 }}>Each vertical keeps its projects private to the people who have access to it. Add a vertical when you start a new line of business, then set who can see it under Team & Access.</p>
        <button type="button" className="btn primary" onClick={() => setEditing({})}><Plus size={17} />Add vertical</button>
      </div>
      <ErrorNote error={error} retry={reload} />
      {loading && !data ? <Loading /> : (
        <div className="card flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Vertical</th><th>Code</th><th>Key date</th><th className="num">People</th><th className="num">Projects</th><th /></tr></thead>
              <tbody>
                {data.items.map((v) => (
                  <tr key={v.id} style={!v.active ? { opacity: 0.55 } : undefined}>
                    <td><div className="row" style={{ gap: 12 }}><span className="vbadge" style={{ background: alpha(v.color, 0.15), color: ink(v.color) }}>{v.code}</span><div><div className="b6">{v.name}</div><div className="xs muted">{v.tagline}</div></div></div></td>
                    <td>{v.code}</td>
                    <td className="small">{v.key_date_label}</td>
                    <td className="num">{v.people}</td>
                    <td className="num">{v.projects}</td>
                    <td className="right"><button type="button" className="btn xs" onClick={() => setEditing(v)}><Pencil size={13} />Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {editing && <VerticalForm vertical={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload({ quiet: true }); loadBoot(); }} />}
    </>
  );
}

function Company() {
  const { company, toast, loadBoot } = useApp();
  const [name, setName] = useState(company);
  return (
    <form className="card" style={{ maxWidth: 520 }} onSubmit={async (e) => { e.preventDefault(); try { await api.patch('/admin/settings', { company_name: name }); toast('Saved', 'success'); loadBoot(); } catch (e2) { toast(e2.message, 'error'); } }}>
      <Field label="Company name" htmlFor="co-name"><input id="co-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
      <button type="submit" className="btn primary mt-16">Save</button>
    </form>
  );
}

export default function Settings({ tab = 'templates' }) {
  const { isAdmin } = useApp();
  const { navigate } = useRouter();
  const tabs = [['templates', 'Project templates', LayoutTemplate], isAdmin && ['verticals', 'Verticals', Layers], isAdmin && ['company', 'Company', Building2]].filter(Boolean);
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Templates, verticals and company details.</div></div></div>
      <div className="tabs">
        {tabs.map(([k, l, Ic]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => navigate(k === 'templates' ? '/settings' : `/settings/${k}`, { replace: true })}><Ic size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{l}</button>)}
      </div>
      {tab === 'templates' && <Templates />}
      {tab === 'verticals' && isAdmin && <Verticals />}
      {tab === 'company' && isAdmin && <Company />}
    </>
  );
}
