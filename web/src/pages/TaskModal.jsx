import { useEffect, useState } from 'react';
import { X, Trash2, Check, Plus, Paperclip, Lock } from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { Link } from '../router.jsx';
import { Loading, Avatar, UserSelect, VChip, Field, TASK_STATUS, PRIORITY, Empty } from '../ui.jsx';
import { UploadZone, FileRow, FilePreview, LinkForm } from '../files.jsx';
import { fmtTime, timeAgo, dueText } from '../format.js';
import { describe, Composer, CommentItem, stampReceived } from '../activity.jsx';

export function TaskModal({ id, onClose, onChanged }) {
  const { assignable, toast, confirm, today, me } = useApp();
  const { data: t, loading, error, reload, setData } = useLoad(() => api.get(`/tasks/${id}`).then((d) => ({ ...d, comments: stampReceived(d.comments) })), [id]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [newItem, setNewItem] = useState('');
  const [preview, setPreview] = useState(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (t) {
      setTitle(t.title);
      setDesc(t.description || '');
    }
  }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !preview && !linking && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, preview, linking]);

  const can = t?.permissions?.edit;
  const save = async (body, msg) => {
    setData((d) => ({ ...d, ...body }));
    try {
      const saved = await api.patch(`/tasks/${id}`, body);
      setData((d) => ({ ...d, ...saved }));
      if (msg) toast(msg, 'success');
      onChanged?.();
      reload({ quiet: true });
    } catch (e) {
      toast(e.message, 'error');
      reload({ quiet: true });
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this task?', message: `“${t.title}” and its comments will be removed. Files attached to it stay in the project.`, confirmLabel: 'Delete task', danger: true }))) return;
    try {
      await api.del(`/tasks/${id}`);
      toast('Task deleted', 'success');
      onChanged?.();
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const comment = async (body) => {
    try {
      await api.post(`/projects/${t.project.id}/comments`, { body, task_id: t.id });
      reload({ quiet: true });
      onChanged?.();
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  const setChecklist = (list) => save({ checklist: list });

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal xwide task-modal" role="dialog" aria-modal="true" aria-label={t?.title || 'Task'}>
        {loading && !t ? <div className="modal-body"><Loading /></div> : error && !t ? (
          <div className="modal-body"><Empty title="Task not found">{error.message}</Empty><div className="center"><button type="button" className="btn" onClick={onClose}>Close</button></div></div>
        ) : t && (
          <>
            <div className="modal-head">
              <div className="row gap-6" style={{ minWidth: 0 }}>
                <VChip name={t.project.vertical} color={t.project.vertical_color} small />
                <Link to={`/projects/${t.project.id}`} onClick={onClose} className="small b6 ellipsis">{t.project.code} · {t.project.name}</Link>
              </div>
              <div className="row gap-6">
                {t.permissions.delete && <button type="button" className="btn sm ghost" onClick={remove} aria-label="Delete task"><Trash2 size={16} /></button>}
                <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
              </div>
            </div>
            <div className="task-layout">
              <div className="task-main">
                <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <button type="button" className={`check-btn lg ${t.status === 'done' ? 'on' : ''}`} disabled={!can} onClick={() => save({ status: t.status === 'done' ? 'todo' : 'done' }, t.status === 'done' ? 'Task reopened' : 'Task completed')} aria-label={t.status === 'done' ? 'Reopen task' : 'Mark task done'}>
                    {t.status === 'done' && <Check size={16} strokeWidth={3} />}
                  </button>
                  {can ? (
                    <textarea id="task-title" className="title-input" rows={1} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== t.title && save({ title: title.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.target.blur())} aria-label="Task title" maxLength={240} />
                  ) : <h2 className="title-input" style={{ border: 0 }}>{t.title}</h2>}
                </div>
                {!can && <div className="alert info mt-8"><Lock size={15} />You have view-only access to this vertical.</div>}

                <Field label="Notes" className="mt-16" htmlFor="task-desc">
                  <textarea id="task-desc" className="textarea" rows={3} value={desc} disabled={!can} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== (t.description || '') && save({ description: desc })} placeholder={can ? 'Add details, specs or links' : 'No notes'} />
                </Field>

                <div className="mt-16">
                  <div className="row between mb-8">
                    <label className="b6 small" style={{ color: 'var(--text-2)' }}>Checklist {t.checklist.length > 0 && <span className="muted">{t.checklist.filter((c) => c.done).length}/{t.checklist.length}</span>}</label>
                  </div>
                  <div className="checklist">
                    {t.checklist.map((c, i) => (
                      <div key={i} className={`ci ${c.done ? 'done' : ''}`}>
                        <button type="button" className={`check-btn sm ${c.done ? 'on' : ''}`} disabled={!can} onClick={() => setChecklist(t.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} aria-label={c.done ? `Untick ${c.text}` : `Tick ${c.text}`}>{c.done && <Check size={11} strokeWidth={3} />}</button>
                        <span className="grow small">{c.text}</span>
                        {can && <button type="button" className="icon-btn sm-x" aria-label={`Remove ${c.text}`} onClick={() => setChecklist(t.checklist.filter((_, j) => j !== i))}><X size={14} /></button>}
                      </div>
                    ))}
                    {can && (
                      <form className="row gap-6 mt-4" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) { setChecklist([...t.checklist, { text: newItem.trim(), done: false }]); setNewItem(''); } }}>
                        <Plus size={16} className="muted" />
                        <input id="task-checklist-new" className="input sm" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item" maxLength={300} />
                      </form>
                    )}
                  </div>
                </div>

                <div className="mt-16">
                  <div className="row between mb-8">
                    <label className="b6 small" style={{ color: 'var(--text-2)' }}><Paperclip size={14} style={{ verticalAlign: '-2px' }} /> Files {t.files.length > 0 && <span className="muted">{t.files.length}</span>}</label>
                    {can && <button type="button" className="link" onClick={() => setLinking(true)}>Add link</button>}
                  </div>
                  {t.files.map((f) => <FileRow key={f.id} file={{ ...f, vertical_color: t.project.vertical_color }} onOpen={setPreview} />)}
                  {can && <UploadZone projectId={t.project.id} taskId={t.id} compact onUploaded={() => { reload({ quiet: true }); onChanged?.(); }} />}
                </div>

                <div className="mt-16">
                  <label className="b6 small" style={{ color: 'var(--text-2)' }}>Comments</label>
                  <div className="feed mt-8">
                    {t.comments.map((c) => <CommentItem key={c.id} c={c} size={30} onChanged={() => { reload({ quiet: true }); onChanged?.(); }} />)}
                  </div>
                  {can && <Composer onSend={comment} placeholder="Ask a question or post an update. @name notifies a teammate." />}
                </div>
              </div>

              <aside className="task-side">
                <Field label="Status" htmlFor="task-status">
                  <select id="task-status" className="select" value={t.status} disabled={!can} onChange={(e) => save({ status: e.target.value })}>
                    {Object.entries(TASK_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Assigned to" htmlFor="task-assignee">
                  <UserSelect id="task-assignee" value={t.assignee_id} disabled={!can} onChange={(v) => save({ assignee_id: v }, v ? 'Task reassigned' : 'Task unassigned')} people={assignable(t.project.vertical_id)} />
                </Field>
                <Field label="Due date" htmlFor="task-due" hint={t.due_date ? dueText(today, t.due_date, t.status === 'done') : null}>
                  <input id="task-due" type="date" className="input" value={t.due_date || ''} disabled={!can} onChange={(e) => save({ due_date: e.target.value || null })} />
                </Field>
                <Field label="Start date" htmlFor="task-start">
                  <input id="task-start" type="date" className="input" value={t.start_date || ''} disabled={!can} onChange={(e) => save({ start_date: e.target.value || null })} />
                </Field>
                <Field label="Priority" htmlFor="task-priority">
                  <select id="task-priority" className="select" value={t.priority} disabled={!can} onChange={(e) => save({ priority: e.target.value })}>
                    {Object.entries(PRIORITY).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  </select>
                </Field>
                <Field label="Stage" htmlFor="task-stage">
                  <select id="task-stage" className="select" value={t.stage} disabled={!can} onChange={(e) => save({ stage: e.target.value })}>
                    {[...new Set([...t.project.stages, t.stage].filter(Boolean))].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                {t.assignee_id !== me.id && can && t.status !== 'done' && (
                  <button type="button" className="btn sm soft" onClick={() => save({ assignee_id: me.id }, 'Assigned to you')}>Assign to me</button>
                )}
                <div className="divider" />
                <div className="xs muted" style={{ lineHeight: 1.6 }}>
                  Added {t.created_by_user ? `by ${t.created_by_user.name} ` : ''}{timeAgo(t.created_at)}
                  {t.completed_at && <><br />Completed {fmtTime(t.completed_at)}</>}
                </div>
                {t.history.length > 0 && (
                  <div className="mt-12">
                    <div className="xs b6 muted mb-8" style={{ textTransform: 'uppercase', letterSpacing: '.5px' }}>History</div>
                    {t.history.slice(0, 8).map((h) => (
                      <div key={h.id} className="xs mb-8" style={{ lineHeight: 1.45 }}><b>{h.user_name}</b> {describe(h)} <span className="muted">· {timeAgo(h.created_at)}</span></div>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
      {preview && (
        <FilePreview file={preview} onClose={() => setPreview(null)} canEdit={can} canDelete={t.permissions.delete || preview.uploaded_by === me.id}
          onChanged={(f) => { setPreview(f); reload({ quiet: true }); }} onDeleted={() => { setPreview(null); reload({ quiet: true }); onChanged?.(); }} />
      )}
      {linking && <LinkForm projectId={t.project.id} taskId={t.id} onClose={() => setLinking(false)} onSaved={() => { setLinking(false); reload({ quiet: true }); onChanged?.(); }} />}
    </div>
  );
}
