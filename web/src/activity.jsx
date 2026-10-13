import { useState } from 'react';
import { Send } from 'lucide-react';
import { Link } from './router.jsx';
import { Avatar, PROJECT_STATUS, HEALTH } from './ui.jsx';
import { timeAgo } from './format.js';

// Turns an activity row into a readable sentence.
export function describe(a) {
  const d = a.detail || '';
  const arrow = d.split(' → ');
  switch (a.action) {
    case 'created': return d ? <>created the project <span className="muted">({d})</span></> : 'created the project';
    case 'status': return <>changed the status to <b>{PROJECT_STATUS[d]?.label || d}</b></>;
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
