import { useEffect, useMemo, useState } from 'react';
import { Send, Trash2, Clock, ShieldCheck, ShieldX, Hourglass } from 'lucide-react';
import { Link } from './router.jsx';
import { Avatar, PROJECT_STATUS, HEALTH } from './ui.jsx';
import { timeAgo, fmtTime } from './format.js';
import { useApp } from './store.jsx';
import { api } from './api.js';

// Turns an activity row into a readable sentence.
export function describe(a) {
  const d = a.detail || '';
  const arrow = d.split(' → ');
  switch (a.action) {
    case 'created': return d ? <>created the project <span className="muted">({d})</span></> : 'created the project';
    case 'status': return <>changed the status to <b>{PROJECT_STATUS[d]?.label || d}</b></>;
    case 'comment_deleted': return <>deleted a comment{d && <span className="muted"> (approved by {d})</span>}</>;
    case 'comment_removed': return <>removed a comment by <b>{d || 'someone'}</b></>;
    case 'stage': return <>moved the project to <b>{d}</b></>;
    case 'health': return <>marked the project <b>{HEALTH[d]?.label || d}</b></>;
    case 'owner': return <>made <b>{d}</b> the project owner</>;
    case 'moved': return <>moved the project to <b>{d}</b></>;
    case 'updated': return <>updated the {d}</>;
    case 'team': return 'updated the project team';
    case 'task_added': return <>added the task <b>{d}</b></>;
    case 'task_done': return <>completed <b>{arrow[0]}</b></>;
    case 'task_status': return <>moved <b>{arrow[0]}</b> to {arrow[1]}</>;
    case 'task_assigned': return <>assigned <b>{arrow[0]}</b> to {arrow[1]}</>;
    case 'task_due': return <>changed the due date of <b>{arrow[0]}</b> to {arrow[1]}</>;
    case 'task_renamed': return <>renamed a task to <b>{arrow[1]}</b></>;
    case 'task_deleted': return <>deleted the task <b>{d}</b></>;
    case 'milestone_added': return <>added the milestone <b>{d}</b></>;
    case 'milestone_done': return <>reached the milestone <b>{d}</b></>;
    case 'milestone_deleted': return <>removed the milestone <b>{d}</b></>;
    case 'file_added': return <>uploaded <b>{d}</b></>;
    case 'link_added': return <>added the link <b>{d}</b></>;
    case 'file_final': return <>marked <b>{d}</b> as a final asset</>;
    case 'file_deleted': return <>deleted the file <b>{d}</b></>;
    default: return `${a.action} ${d}`;
  }
}

export function ActivityList({ items, showProject = false }) {
  if (!items?.length) return <div className="empty small">No activity yet.</div>;
  return (
    <div className="feed">
      {items.map((a) => (
        <div key={`${a.kind || 'a'}-${a.id}`} className="feed-item">
          <Avatar name={a.user_name || 'Someone'} color={a.user_color} size={30} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="feed-text">
              <b>{a.user_name || 'Someone'}</b> {describe(a)}
              {showProject && a.project_id && (
                <> in <Link to={`/projects/${a.project_id}`} className="b6" style={{ color: 'var(--text)' }}><span className="dot" style={{ background: a.vertical_color, marginRight: 5 }} />{a.code}</Link></>
              )}
            </div>
            <div className="xs muted mt-4">{timeAgo(a.created_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Composer({ onSend, placeholder = 'Write an update. Use @name to notify someone.' }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const ok = await onSend(body);
    setBusy(false);
    if (ok !== false) setBody('');
  };
  return (
    <form className="composer" onSubmit={submit}>
      <textarea id="composer-body" className="textarea" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} aria-label="Comment"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} />
      <button type="submit" className="btn primary" disabled={busy || !body.trim()}><Send size={16} />Post</button>
    </form>
  );
}

export function CommentBody({ text }) {
  const parts = text.split(/(@[A-Z][a-z]+(?: [A-Z][a-z]+)?)/g);
  return <>{parts.map((s, i) => (s.startsWith('@') ? <b key={i} className="mention">{s}</b> : s))}</>;
}

// Remember when comments arrived, so the 15-second countdown survives re-renders.
export function stampReceived(comments) {
  const now = Date.now();
  return (comments || []).map((c) => ({ ...c, received_at: now }));
}

// One comment with its delete rules: the author can delete for 15 seconds (with a
// countdown); after that they ask a head, and can delete only once a head approves.
export function CommentItem({ c, onChanged, taskLink, size = 34 }) {
  const { toast, confirm } = useApp();
  const deadline = useMemo(() => (c.received_at || Date.now()) + (c.delete_ms_left || 0), [c.id, c.delete_ms_left, c.received_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const left = Math.max(0, deadline - now);
  useEffect(() => {
    setNow(Date.now());
    if (deadline <= Date.now()) return undefined;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= deadline) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [deadline]);

  const inWindow = c.mine && c.delete_ms_left > 0 && left > 0;
  const approved = c.mine && c.delete_status === 'approved';
  const canRequest = c.mine && !inWindow && c.delete_status !== 'requested' && !approved;

  const run = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      if (msg) toast(msg, 'success');
      onChanged?.();
    } catch (e) {
      toast(e.message, 'error');
      onChanged?.();
    }
    setBusy(false);
  };
  const del = async () => {
    if (approved && !(await confirm({ title: 'Delete this comment?', message: 'A head approved the deletion. The comment will be removed for everyone.', confirmLabel: 'Delete comment', danger: true }))) return;
    run(() => api.del(`/comments/${c.id}`), 'Comment deleted');
  };
  const headDelete = async () => {
    const first = c.user_name?.split(' ')[0] || 'this person';
    if (!(await confirm({ title: `Delete ${first}'s comment?`, message: `As a head of this vertical you can remove it. ${first} will be told, and the project history will show that you removed it.`, confirmLabel: 'Delete comment', danger: true }))) return;
    run(() => api.del(`/comments/${c.id}`), 'Comment deleted');
  };

  return (
    <div className={`feed-item comment ${c.is_new ? 'is-new' : ''}`}>
      <Avatar name={c.user_name} color={c.user_color} size={size} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row between">
          <span className="small">{c.is_new && <span className="new-tag">New</span>}<b>{c.user_name}</b>{taskLink}</span>
          <span className="xs muted nowrap" title={fmtTime(c.created_at)}>{timeAgo(c.created_at)}</span>
        </div>
        <div className="bubble"><CommentBody text={c.body} /></div>
        <div className="c-actions">
          {inWindow && (
            <button type="button" className="link xs" onClick={del} disabled={busy}>
              <Trash2 size={12} />Delete <span className="c-count">{Math.ceil(left / 1000)}s</span>
            </button>
          )}
          {canRequest && (
            <button type="button" className="link xs muted" onClick={() => run(() => api.post(`/comments/${c.id}/delete-request`), 'Sent to your head for approval')} disabled={busy}>
              <Clock size={12} />{c.delete_status === 'declined' ? 'Ask again to delete' : 'Request deletion'}
            </button>
          )}
          {c.delete_status === 'requested' && !c.can_decide && (
            <span className="c-chip amber"><Hourglass size={12} />{c.mine ? 'Deletion requested. Waiting for a head to approve.' : 'Deletion requested'}</span>
          )}
          {approved && (
            <>
              <span className="c-chip green"><ShieldCheck size={12} />Deletion approved{c.decided_by_name ? ` by ${c.decided_by_name}` : ''}</span>
              <button type="button" className="link xs red" onClick={del} disabled={busy}><Trash2 size={12} />Delete</button>
            </>
          )}
          {c.delete_status === 'declined' && (
            <span className="c-chip gray"><ShieldX size={12} />Kept{c.decided_by_name ? ` by ${c.decided_by_name}` : ''}</span>
          )}
          {c.can_head_delete && !c.can_decide && (
            <button type="button" className="link xs muted" onClick={headDelete} disabled={busy} title="You are a head of this vertical"><Trash2 size={12} />Delete</button>
          )}
        </div>
        {c.can_decide && (
          <div className="c-request">
            <span className="small"><b>{c.user_name.split(' ')[0]}</b> asked to delete this comment.</span>
            <span className="row gap-6">
              <button type="button" className="btn xs success" disabled={busy} onClick={() => run(() => api.post(`/comments/${c.id}/delete-decision`, { approve: true }), 'Deletion approved')}>Approve deletion</button>
              <button type="button" className="btn xs" disabled={busy} onClick={() => run(() => api.post(`/comments/${c.id}/delete-decision`, { approve: false }), 'Comment kept')}>Keep comment</button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
