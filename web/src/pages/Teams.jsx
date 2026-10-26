import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MessagesSquare, Megaphone, CircleCheck, LifeBuoy, OctagonAlert, CheckCheck, Activity, MessageSquareText, Search, Send,
  ChevronLeft, ExternalLink, Users, Info, Lock, ArrowDown, X, Paperclip, Download, Upload, Loader2, AlertCircle,
} from 'lucide-react';
import { useApp, useLoad } from '../store.jsx';
import { api } from '../api.js';
import { Link, useRouter } from '../router.jsx';
import { Avatar, AvatarStack, Empty, ErrorNote, Loading, Seg, StatusBadge, PROJECT_STATUS, FileIcon, FileThumb, alpha } from '../ui.jsx';
import { CommentBody, DeleteControls, stampReceived } from '../activity.jsx';
import { FilePreview, guessCategory } from '../files.jsx';
import { bytes, fmtTime, timeAgo } from '../format.js';
import { NoAccess } from './Dashboard.jsx';

export const GROUP_STATUS = {
  on_track: { label: 'On track', color: 'var(--green)', soft: 'var(--green-soft)', icon: CircleCheck },
  need_help: { label: 'Need help', color: '#b7791f', soft: 'var(--amber-soft)', icon: LifeBuoy },
  blocked: { label: 'Blocked', color: 'var(--red)', soft: 'var(--red-soft)', icon: OctagonAlert },
  done: { label: 'Done for today', color: 'var(--blue)', soft: 'var(--blue-soft)', icon: CheckCheck },
};

const POLL_CHAT_MS = 4000;
const POLL_LIST_MS = 15000;
const MAX_FILES = 10; // per message, same as the server

function useMedia(query) {
  const get = () => typeof window !== 'undefined' && window.matchMedia?.(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const fn = () => setOn(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return on;
}

// Runs fn every ms while the page is visible, and again when the person comes back to it.
function usePoll(fn, ms) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && ref.current();
    const t = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ms]);
}

const localDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clock = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function dayLabel(day) {
  const today = localDay(new Date().toISOString());
  const yesterday = localDay(new Date(Date.now() - 86400000).toISOString());
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  const d = new Date(day + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function shortWhen(iso) {
  if (!iso) return '';
  const day = localDay(iso);
  if (day === localDay(new Date().toISOString())) return clock(iso);
  if (day === localDay(new Date(Date.now() - 86400000).toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function preview(last, meId) {
  if (!last) return 'No messages yet';
  if (last.kind === 'system') return last.body;
  const who = last.user_id === meId ? 'You' : (last.user_name || 'Someone').split(' ')[0];
  if (last.file_count && !last.body) return `${who} shared ${last.file_count > 1 ? `${last.file_count} files` : last.file_name}`;
  if (last.kind === 'status') return `${who}: ${GROUP_STATUS[last.status]?.label || 'Status'}${last.body ? ` · ${last.body}` : ''}`;
  if (last.kind === 'update') return `${who} posted an update: ${last.body}`;
  return `${who}: ${last.body}`;
}

// ---------------------------------------------------------------- group list

function GroupRow({ g, active, meId }) {
  const unread = g.unread > 0;
  return (
    <Link to={`/teams/${g.id}`} className={`t-row ${active ? 'on' : ''} ${unread && g.member ? 'unread' : ''}`} aria-current={active ? 'page' : undefined}>
      <span className="t-ic" style={{ background: alpha(g.vertical_color, 0.15), color: g.vertical_color }} aria-hidden="true">{g.vertical[0]}</span>
      <span className="t-row-main">
        <span className="t-row-top">
          <span className="t-name">{g.name}</span>
          <span className="t-when">{shortWhen(g.last?.created_at)}</span>
        </span>
        <span className="t-row-top">
          <span className="t-prev">{preview(g.last, meId)}</span>
          {unread && <span className={`pill-num ${g.member ? 'alert' : ''}`} title={`${g.unread} unread`}>{g.unread}</span>}
        </span>
        <span className="t-meta">
          {g.code}{g.client ? ` · ${g.client}` : ''}
          {g.flags.blocked > 0 && <span className="t-flag red"><OctagonAlert size={11} />{g.flags.blocked} blocked</span>}
          {g.flags.need_help > 0 && <span className="t-flag amber"><LifeBuoy size={11} />{g.flags.need_help} need help</span>}
        </span>
      </span>
    </Link>
  );
}

function GroupList({ items, activeId, meId }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const term = q.trim().toLowerCase();
  const shown = items.filter((g) => (show === 'all' || g.unread > 0)
    && (!term || [g.name, g.code, g.client, g.vertical].some((x) => x?.toLowerCase().includes(term))));
  const mine = shown.filter((g) => g.member);
  const oversee = shown.filter((g) => !g.member);
  return (
    <aside className="t-list card flush" aria-label="Your team groups">
      <div className="t-list-head">
        <div className="t-search">
          <Search size={16} />
          <input id="group-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a group" aria-label="Find a group" />
        </div>
        <Seg value={show} onChange={setShow} label="Show" options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} />
      </div>
      <div className="t-list-body">
        {mine.length > 0 && <div className="t-sec">Your groups <span>{mine.length}</span></div>}
        {mine.map((g) => <GroupRow key={g.id} g={g} active={g.id === activeId} meId={meId} />)}
        {oversee.length > 0 && <div className="t-sec" title="You are a head of these verticals, so you can look in">Groups you oversee <span>{oversee.length}</span></div>}
        {oversee.map((g) => <GroupRow key={g.id} g={g} active={g.id === activeId} meId={meId} />)}
        {shown.length === 0 && (
          <div className="empty small" style={{ padding: '28px 16px' }}>
            {items.length === 0 ? 'No groups yet. You join a project’s group as soon as you are on its team or get a task in it.' : show === 'unread' && !term ? 'You are all caught up.' : 'No groups match.'}
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- chat

function StatusChip({ status, size = 13 }) {
  const st = GROUP_STATUS[status];
  if (!st) return null;
  return <span className="t-st-chip" style={{ color: st.color, background: st.soft }}><st.icon size={size} />{st.label}</span>;
}

// Images as a grid of thumbnails, everything else as a file row with a download button.
function Attachments({ files, onOpen }) {
  const { toast } = useApp();
  const images = files.filter((f) => f.mime?.startsWith('image/'));
  const others = files.filter((f) => !f.mime?.startsWith('image/'));
  return (
    <div className="t-files">
      {images.length > 0 && (
        <div className={`t-imgs ${images.length === 1 ? 'one' : ''}`}>
          {images.map((f) => (
            <button key={f.id} type="button" className="t-img" onClick={() => onOpen(f)} title={f.name} aria-label={`Open ${f.name}`}>
              <FileThumb file={f} />
            </button>
          ))}
        </div>
      )}
      {others.map((f) => (
        <div key={f.id} className="t-file">
          <FileIcon file={f} size={18} />
          <button type="button" className="t-file-main" onClick={() => onOpen(f)} title={`Open ${f.name}`}>
            <span className="small b6 ellipsis">{f.name}</span>
            <span className="xs muted">{[f.category, bytes(f.size)].filter(Boolean).join(' · ')}</span>
          </button>
          <button type="button" className="icon-btn sm-x" aria-label={`Download ${f.name}`} title="Download" onClick={() => api.download(f).catch((e) => toast(e.message, 'error'))}>
            <Download size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Message({ m, compact, onChanged, onOpenFile }) {
  if (m.kind === 'system') {
    return (
      <div className="t-notice">
        <span>{m.body}</span>
        <time dateTime={m.created_at} title={fmtTime(m.created_at)}>{clock(m.created_at)}</time>
      </div>
    );
  }
  return (
    <div className={`t-msg ${compact ? 'compact' : ''} k-${m.kind}`}>
      <div className="t-av">{compact ? <time className="t-hover-time" dateTime={m.created_at}>{clock(m.created_at)}</time> : <Avatar name={m.user_name || 'Someone'} color={m.user_color} size={36} />}</div>
      <div className="t-body">
        {!compact && (
          <div className="t-head">
            <b>{m.user_name || 'Someone'}</b>
            {m.kind === 'update' && <span className="t-tag"><Megaphone size={12} />Update</span>}
            <time dateTime={m.created_at} title={fmtTime(m.created_at)}>{clock(m.created_at)}</time>
          </div>
        )}
        {m.kind === 'status' ? (
          <div className="t-status" style={{ borderLeftColor: GROUP_STATUS[m.status]?.color }}>
            <StatusChip status={m.status} />
            {m.body && <span className="t-text"><CommentBody text={m.body} /></span>}
          </div>
        ) : m.body ? (
          <div className={m.kind === 'update' ? 't-update' : 't-text'}><CommentBody text={m.body} /></div>
        ) : !m.files?.length && <div className="t-text muted"><i>File removed</i></div>}
        {m.files?.length > 0 && <Attachments files={m.files} onOpen={onOpenFile} />}
        <DeleteControls c={m} base={`/group-messages/${m.id}`} noun="message" onChanged={onChanged} floating />
      </div>
    </div>
  );
}

// Files are uploaded to the project as soon as they are attached (so sending is instant),
// then linked to the message when it is sent. Attachments removed or left unsent are deleted.
const Composer = forwardRef(function Composer({ g, onSent }, outer) {
  const { me, toast } = useApp();
  const [mode, setMode] = useState('message');
  const [status, setStatus] = useState('on_track');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState(null); // { q, start, focus }
  const [files, setFiles] = useState([]); // { key, name, size, mime, preview, progress, saved, error }
  const filesRef = useRef(files);
  filesRef.current = files;
  const ref = useRef(null);
  const picker = useRef(null);
  const touch = useMedia('(hover: none)');
  const people = useMemo(() => [...g.members, ...g.heads].filter((p) => p.id !== me.id), [g, me.id]);
  const matches = mention
    ? people.filter((p) => p.name.toLowerCase().split(' ').some((w) => w.startsWith(mention.q.toLowerCase()))).slice(0, 6)
    : [];

  const patchFile = (key, change) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...change } : f)));
  const addFiles = (list) => {
    const incoming = [...(list || [])];
    if (!incoming.length) return;
    const room = MAX_FILES - filesRef.current.length;
    if (incoming.length > room) toast(`You can share up to ${MAX_FILES} files in one message`, 'error');
    for (let file of incoming.slice(0, Math.max(0, room))) {
      // Pasted screenshots arrive as "image.png"; give them a findable name.
      if (/^image\.\w+$/.test(file.name)) {
        const d = new Date();
        const two = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`;
        file = new File([file], `Pasted image ${stamp}.${file.name.split('.').pop()}`, { type: file.type });
      }
      const key = Math.random().toString(36).slice(2);
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setFiles((fs) => [...fs, { key, name: file.name, size: file.size, mime: file.type, preview, progress: 0 }]);
      api.upload(g.project.id, file, { category: guessCategory(file.name, file.type), note: 'Shared in the team group' }, (p) => patchFile(key, { progress: p }))
        .then((saved) => {
          // Removed while it was still uploading: delete it straight away.
          if (!filesRef.current.some((f) => f.key === key)) api.del(`/files/${saved.id}`).catch(() => {});
          else patchFile(key, { saved, progress: 1 });
        })
        .catch((e) => {
          patchFile(key, { error: e.message });
          toast(`${file.name}: ${e.message}`, 'error');
        });
    }
    ref.current?.focus();
  };
  const removeFile = (f) => {
    if (f.preview) URL.revokeObjectURL(f.preview);
    if (f.saved) api.del(`/files/${f.saved.id}`).catch(() => {});
    setFiles((fs) => fs.filter((x) => x.key !== f.key));
  };
  useImperativeHandle(outer, () => ({ addFiles }));
  // Leaving the group with attachments that were never sent removes them again.
  useEffect(() => () => {
    for (const f of filesRef.current) {
      if (f.preview) URL.revokeObjectURL(f.preview);
      if (f.saved) api.del(`/files/${f.saved.id}`).catch(() => {});
    }
  }, []);

  const grow = (el) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  const onChange = (e) => {
    const v = e.target.value;
    setBody(v);
    grow(e.target);
    const before = v.slice(0, e.target.selectionStart);
    const m = /(^|\s)@([\w’'-]*)$/.exec(before);
    setMention(m ? { q: m[2], start: before.length - m[2].length - 1, focus: 0 } : null);
  };
  const pick = (p) => {
    const caret = ref.current.selectionStart;
    const next = `${body.slice(0, mention.start)}@${p.name} ${body.slice(caret)}`;
    const pos = mention.start + p.name.length + 2;
    setBody(next);
    setMention(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };
  const uploading = files.some((f) => !f.saved && !f.error);
  const ready = files.filter((f) => f.saved);
  const canSend = !busy && !uploading && (mode === 'status' || body.trim().length > 0 || ready.length > 0);
  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      const m = await api.post(`/groups/${g.project.id}/messages`, {
        kind: mode, status: mode === 'status' ? status : undefined, body, file_ids: ready.map((f) => f.saved.id),
      });
      for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
      setFiles([]);
      setBody('');
      if (ref.current) ref.current.style.height = '';
      if (mode !== 'message') setMode('message');
      onSent(m);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
    ref.current?.focus();
  };
  const onKeyDown = (e) => {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setMention((x) => ({ ...x, focus: (x.focus + d + matches.length) % matches.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(matches[mention.focus] || matches[0]);
        return;
      }
      if (e.key === 'Escape') {
        setMention(null);
        return;
      }
    }
    // On phones Enter adds a new line, as in other chat apps; the button sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !touch) {
      e.preventDefault();
      send();
    }
  };
  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.files || [])];
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  };
  const placeholder = mode === 'update'
    ? 'Share a progress update: what is done, what is next, anything the team should know'
    : mode === 'status' ? 'Add a line about your status (optional)' : files.length ? 'Add a message (optional)' : touch ? 'Message the group' : `Message the ${g.project.code} group`;

  return (
    <div className={`t-compose mode-${mode}`}>
      <div className="t-modes" role="radiogroup" aria-label="What are you posting?">
        {[['message', 'Message', MessageSquareText], ['update', 'Update', Megaphone], ['status', 'Status', Activity]].map(([k, label, Ic]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => (setMode(k), ref.current?.focus())}>
            <Ic size={14} />{label}
          </button>
        ))}
      </div>
      {mode === 'status' && (
        <div className="t-st-pick" role="radiogroup" aria-label="Your status">
          {Object.entries(GROUP_STATUS).map(([k, st]) => (
            <button key={k} type="button" role="radio" aria-checked={status === k} className={status === k ? 'on' : ''}
              style={status === k ? { color: st.color, background: st.soft, borderColor: st.color } : undefined} onClick={() => setStatus(k)}>
              <st.icon size={14} />{st.label}
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="t-tray" aria-label="Attachments">
          {files.map((f) => (
            <div key={f.key} className={`t-chip-file ${f.error ? 'failed' : ''}`} title={f.error || f.name}>
              {f.preview ? <img src={f.preview} alt="" /> : <FileIcon file={{ name: f.name, mime: f.mime, kind: 'file' }} size={16} />}
              <span className="t-chip-text">
                <span className="small b6 ellipsis">{f.name}</span>
                <span className="xs muted">
                  {f.error ? <span className="red"><AlertCircle size={11} /> Not uploaded</span>
                    : f.saved ? bytes(f.size)
                      : <><Loader2 size={11} className="spin" /> {Math.round(f.progress * 100)}%</>}
                </span>
              </span>
              <button type="button" className="t-chip-x" aria-label={`Remove ${f.name}`} onClick={() => removeFile(f)}><X size={14} /></button>
              {!f.saved && !f.error && <span className="t-chip-bar" style={{ width: `${Math.round(f.progress * 100)}%` }} />}
            </div>
          ))}
        </div>
      )}
      <div className="t-input">
        <input ref={picker} id="group-attach" type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" className="btn t-attach" onClick={() => picker.current?.click()} aria-label="Attach files" title="Attach files: designs, drawings, photos, PDFs">
          <Paperclip size={18} />
        </button>
        <textarea ref={ref} id="group-message" rows={1} value={body} onChange={onChange} onKeyDown={onKeyDown} onPaste={onPaste} placeholder={placeholder} aria-label="Message"
          onBlur={() => setTimeout(() => setMention(null), 150)} />
        <button type="button" className="btn primary" onClick={send} disabled={!canSend} aria-label="Send">
          <Send size={16} /><span className="hide-sm">{uploading ? 'Uploading…' : mode === 'update' ? 'Post update' : mode === 'status' ? 'Set status' : 'Send'}</span>
        </button>
        {mention && matches.length > 0 && (
          <div className="dropdown t-mention" role="listbox" aria-label="Mention someone">
            {matches.map((p, i) => (
              <div key={p.id} role="option" aria-selected={i === mention.focus} className={`item ${i === mention.focus ? 'focus' : ''}`}
                onMouseDown={(e) => (e.preventDefault(), pick(p))} onMouseEnter={() => setMention((x) => ({ ...x, focus: i }))}>
                <Avatar name={p.name} color={p.color} size={24} />
                <span className="small b6">{p.name}</span>
                <span className="xs muted ellipsis">{p.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {!touch && <div className="t-hint xs faint" title="Shared files are also saved to the project’s Files & assets">Enter to send · Shift + Enter for a new line · @ to mention · Drop or paste files to share</div>}
    </div>
  );
});

function PeoplePanel({ g, onClose, overlay }) {
  return (
    <aside className={`t-side card ${overlay ? 'floating' : ''}`} aria-label="People in this group">
      <div className="card-head">
        <h3><Users size={17} color="var(--blue)" />People <span className="sub">{g.members.length}</span></h3>
        {overlay && <button type="button" className="icon-btn sm-x" aria-label="Close" onClick={onClose}><X size={16} /></button>}
      </div>
      <div className="t-people">
        {g.members.map((m) => (
          <div key={m.id} className="t-person">
            <Avatar name={m.name} color={m.color} size={34} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small b6 ellipsis">{m.name}{m.owner && <span className="badge b-blue t-owner">Owner</span>}</div>
              <div className="xs muted ellipsis">{m.title}{m.open_tasks > 0 ? ` · ${m.open_tasks} open task${m.open_tasks > 1 ? 's' : ''}` : ''}</div>
              {m.status ? (
                <div className="t-pstatus">
                  <StatusChip status={m.status.status} size={12} />
                  <span className="xs faint">{timeAgo(m.status.created_at)}</span>
                  {m.status.body && <div className="xs t-pnote">{m.status.body}</div>}
                </div>
              ) : <div className="xs faint mt-4">No status yet</div>}
            </div>
          </div>
        ))}
      </div>
      {g.heads.length > 0 && (
        <>
          <div className="t-sec">Heads who can look in</div>
          <div className="t-heads">
            {g.heads.map((h) => <span key={h.id} className="t-head-chip" title={h.title}><Avatar name={h.name} color={h.color} size={22} />{h.name}</span>)}
          </div>
        </>
      )}
      <p className="xs muted t-how">
        <Info size={14} />
        <span>People join automatically when they are on the project team or get a task in it. The group closes when the project is delivered or cancelled, and its messages stay with the project.</span>
      </p>
    </aside>
  );
}

function Chat({ id, narrow, wide, onRead, onListChanged }) {
  const { markSeen } = useApp();
  const { navigate } = useRouter();
  const { data: g, error, reload: reloadGroup } = useLoad(() => api.get(`/groups/${id}`), [id]);
  const [view, setView] = useState('all');
  const [limit, setLimit] = useState(80);
  const [msgs, setMsgs] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [below, setBelow] = useState(0); // new messages that arrived while scrolled up
  const [preview, setPreview] = useState(null); // a shared file opened full size
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const composerRef = useRef(null);
  const listRef = useRef(null);
  const baseline = useRef(null); // when I last looked before opening, for the "New" divider
  const lastMarked = useRef('');
  const scrollPlan = useRef('first'); // first | bottom | keep | older
  const olderFrom = useRef(0);
  const lastId = useRef(0);

  const load = useCallback(async () => {
    const r = await api.get(`/groups/${id}/messages`, { limit, kind: view === 'all' ? undefined : view });
    setMsgs(stampReceived(r.items));
    setHasMore(r.has_more);
  }, [id, limit, view]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  usePoll(() => {
    load().catch(() => {});
    reloadGroup({ quiet: true });
  }, POLL_CHAT_MS);

  if (g && baseline.current === null) baseline.current = g.seen_at || '';

  // Opening the group (and reading new messages as they arrive) marks it seen.
  useEffect(() => {
    if (!g || !msgs || document.visibilityState !== 'visible') return;
    const latest = msgs.filter((m) => !m.mine && m.kind !== 'system').map((m) => m.created_at).sort().pop() || '';
    if (!lastMarked.current || latest > lastMarked.current) {
      lastMarked.current = latest || new Date().toISOString();
      markSeen(`group:${id}`);
      onRead?.(Number(id));
    }
  }, [g, msgs, id, markSeen, onRead]);

  // Scroll: start at the first unread message (or the bottom), follow new messages
  // when already at the bottom, and keep the place when loading older ones.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !msgs) return;
    const newest = msgs[msgs.length - 1]?.id || 0;
    const plan = scrollPlan.current;
    if (plan === 'first') {
      const divider = el.querySelector('.t-new-divider');
      el.scrollTop = divider ? Math.max(0, divider.offsetTop - 60) : el.scrollHeight;
      scrollPlan.current = 'keep';
    } else if (plan === 'older') {
      el.scrollTop = el.scrollHeight - olderFrom.current;
      scrollPlan.current = 'keep';
    } else if (plan === 'bottom') {
      el.scrollTop = el.scrollHeight;
      scrollPlan.current = 'keep';
      setBelow(0);
    } else if (newest > lastId.current) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      const arrived = msgs.filter((m) => m.id > lastId.current && !m.mine).length;
      if (nearBottom) el.scrollTop = el.scrollHeight;
      else if (arrived) setBelow((n) => n + arrived);
    }
    lastId.current = Math.max(lastId.current, newest);
  }, [msgs, g !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stay at the newest message when the chat area changes size (a status strip appears,
  // the composer grows, the window is resized).
  const atBottom = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [g !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom.current) setBelow(0);
  };
  const loadOlder = () => {
    olderFrom.current = listRef.current?.scrollHeight || 0;
    scrollPlan.current = 'older';
    setLimit((n) => n + 80);
  };
  const changeView = (v) => {
    scrollPlan.current = 'first';
    lastId.current = 0;
    setView(v);
  };
  const sent = (m) => {
    scrollPlan.current = 'bottom';
    setMsgs((list) => [...(list || []), ...stampReceived([m])]);
    onListChanged?.();
    load().catch(() => {});
    if (m.kind === 'status' || m.files?.length) reloadGroup({ quiet: true });
  };
  const changed = () => {
    load().catch(() => {});
    reloadGroup({ quiet: true });
    onListChanged?.();
  };

  // Also while it is open: the project may be delivered or cancelled meanwhile.
  const deleted = error?.code === 'group_deleted';
  if (error && (!g || deleted)) {
    return (
      <section className="t-chat card">
        <Empty icon={Lock} title={deleted ? 'This group was deleted' : error.status === 404 ? 'Group not found' : 'Could not open this group'}
          action={<span className="row" style={{ gap: 8 }}><Link to="/teams" className="btn">Back to groups</Link>{deleted && <Link to={`/projects/${id}/files`} className="btn">Project files</Link>}</span>}>
          {deleted ? error.message : error.status === 404 ? 'You see a project’s group when you are on its team, have a task in it, or are a head of its vertical.' : error.message}
        </Empty>
      </section>
    );
  }
  if (!g) return <section className="t-chat card"><Loading /></section>;

  // Drop files anywhere on the chat to share them.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const dropProps = g.can_post ? {
    onDragEnter: (e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth.current++; setDragging(true); } },
    onDragOver: (e) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      composerRef.current?.addFiles(e.dataTransfer.files);
    },
  } : {};

  const p = g.project;
  const flagged = g.members.filter((m) => m.status && (m.status.status === 'blocked' || m.status.status === 'need_help'));
  const showPanel = wide || peopleOpen;

  // Day separators, a "New" divider, and consecutive messages from one person grouped.
  const rows = [];
  let prev = null;
  let dividerDone = false;
  for (const m of msgs || []) {
    const day = localDay(m.created_at);
    if (!prev || localDay(prev.created_at) !== day) rows.push({ key: `d-${day}`, day });
    if (!dividerDone && baseline.current && !m.mine && m.kind !== 'system' && m.created_at > baseline.current) {
      rows.push({ key: 'new', divider: true });
      dividerDone = true;
    }
    const compact = !!prev && prev.kind === 'message' && m.kind === 'message' && prev.user_id === m.user_id
      && localDay(prev.created_at) === day && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60000
      && rows[rows.length - 1]?.m;
    rows.push({ key: m.id, m, compact });
    prev = m;
  }

  return (
    <>
      <section className="t-chat card flush" aria-label={`${p.name} group`} {...dropProps}>
        {dragging && (
          <div className="t-drop" aria-hidden="true">
            <Upload size={30} />
            <b>Drop to share with the {p.code} group</b>
            <span className="small">Designs, drawings, photos, PDFs. They are saved to the project’s files too.</span>
          </div>
        )}
        <header className="t-chat-head">
          {narrow && <button type="button" className="icon-btn" aria-label="All groups" onClick={() => navigate('/teams')}><ChevronLeft size={20} /></button>}
          <span className="t-ic big" style={{ background: alpha(p.vertical_color, 0.15), color: p.vertical_color }} aria-hidden="true">{p.vertical[0]}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="t-title-row">
              <h2 className="t-title">{p.name}</h2>
              {!narrow && <StatusBadge status={p.status} readyLabel={p.ready_label} />}
            </div>
            <div className="xs muted ellipsis">
              {narrow
                ? `${p.code} · ${p.status === 'ready' && p.ready_label ? p.ready_label : PROJECT_STATUS[p.status]?.label}`
                : `${p.code}${p.client ? ` · ${p.client}` : ''} · ${g.members.length} ${g.members.length === 1 ? 'person' : 'people'}${g.role === 'head' ? ' · You oversee this group' : ''}`}
            </div>
          </div>
          <div className="t-head-actions">
            {!wide && (
              <button type="button" className="btn sm" onClick={() => setPeopleOpen((o) => !o)} aria-expanded={peopleOpen} title="People and their status">
                {narrow ? <><Users size={15} />{g.members.length}</> : <AvatarStack people={g.members} max={3} size={22} />}
              </button>
            )}
            <Link to={`/projects/${p.id}`} className="btn sm" title="Open the project"><ExternalLink size={15} /><span className="hide-sm">Project</span></Link>
          </div>
        </header>
        <div className="t-views" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => changeView('all')}>
            <MessagesSquare size={14} />{narrow ? 'All' : 'All messages'}
          </button>
          <button type="button" role="tab" aria-selected={view === 'updates'} className={view === 'updates' ? 'on' : ''} onClick={() => changeView('updates')}>
            <Megaphone size={14} />{narrow ? 'Updates' : 'Updates & status'}
          </button>
          <button type="button" role="tab" aria-selected={view === 'files'} className={view === 'files' ? 'on' : ''} onClick={() => changeView('files')}>
            <Paperclip size={14} />Files{g.file_count ? <span className="pill-num">{g.file_count}</span> : null}
          </button>
        </div>
        {flagged.length > 0 && (
          <div className="t-flags">
            {flagged.map((m) => (
              <span key={m.id} className="t-flag-item">
                <StatusChip status={m.status.status} size={12} />
                <b>{m.name.split(' ')[0]}</b>{m.status.body ? `: ${m.status.body}` : ''}
              </span>
            ))}
          </div>
        )}
        <div className="t-msgs-wrap">
        <div className="t-msgs" ref={listRef} onScroll={onScroll} aria-live="polite">
          {hasMore && <div className="t-older"><button type="button" className="btn sm" onClick={loadOlder}>Show earlier messages</button></div>}
          {!msgs ? <Loading /> : msgs.length === 0 ? (
            <Empty icon={view === 'updates' ? Megaphone : view === 'files' ? Paperclip : MessagesSquare} title={view === 'updates' ? 'No updates yet' : view === 'files' ? 'No files shared yet' : 'Say hello to the team'}>
              {view === 'updates' ? 'Progress updates and status posts show here, so anyone can catch up quickly.'
                : view === 'files' ? 'Designs, drawings, photos and documents shared in this group show here. Use the paperclip, or drop files on the chat.'
                  : 'Everyone working on this project is in this group. Post updates, share your status or just chat.'}
            </Empty>
          ) : rows.map((r) => (
            r.day ? <div key={r.key} className="t-day"><span>{dayLabel(r.day)}</span></div>
              : r.divider ? <div key="new" className="t-new-divider"><span>New</span></div>
                : <Message key={r.key} m={r.m} compact={r.compact} onChanged={changed} onOpenFile={setPreview} />
          ))}
        </div>
        {below > 0 && (
          <button type="button" className="t-below" onClick={() => { scrollPlan.current = 'bottom'; setMsgs((x) => [...x]); }}>
            <ArrowDown size={14} />{below} new message{below > 1 ? 's' : ''}
          </button>
        )}
        </div>
        {g.can_post ? <Composer ref={composerRef} g={g} onSent={sent} /> : (
          <div className="t-readonly xs muted">
            <Lock size={13} />
            You have view-only access to this vertical, so you can read this group but not post.
          </div>
        )}
      </section>
      {showPanel && <PeoplePanel g={g} overlay={!wide} onClose={() => setPeopleOpen(false)} />}
      {preview && (
        <FilePreview file={preview} canEdit={g.can_post} canDelete={false} onClose={() => setPreview(null)}
          onChanged={(f) => { setPreview((x) => ({ ...x, ...f })); changed(); }} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- page

export default function Teams({ id }) {
  const { verticals, vertical, me } = useApp();
  const { navigate } = useRouter();
  const narrow = useMedia('(max-width: 760px)');
  const wide = useMedia('(min-width: 1281px)');
  const { data, error, loading, reload, setData } = useLoad(() => api.get('/groups', { vertical }), [vertical]);
  usePoll(() => reload({ quiet: true }), POLL_LIST_MS);
  const activeId = id ? Number(id) : null;
  const gridRef = useRef(null);
  const [top, setTop] = useState(190);
  useLayoutEffect(() => {
    const measure = () => gridRef.current && setTop(Math.round(gridRef.current.getBoundingClientRect().top + window.scrollY));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [narrow, activeId, error]);

  // On a wide screen, open the first group straight away (unread first).
  useEffect(() => {
    if (activeId || narrow || !data?.items.length) return;
    const first = data.items.find((g) => g.member && g.unread > 0) || data.items.find((g) => g.member) || data.items[0];
    navigate(`/teams/${first.id}`, { replace: true });
  }, [activeId, narrow, data, navigate]);

  const onRead = useCallback((gid) => setData((d) => (d ? { ...d, items: d.items.map((g) => (g.id === gid ? { ...g, unread: 0 } : g)) } : d)), [setData]);
  const listChanged = useCallback(() => reload({ quiet: true }), [reload]);

  if (!verticals.length) return <NoAccess />;
  const items = data?.items || [];
  const unread = items.filter((g) => g.member).reduce((n, g) => n + g.unread, 0);

  return (
    <>
      <div className={`page-head t-page-head ${narrow && activeId ? 'hide-sm' : ''}`}>
        <div>
          <h1>Team Groups</h1>
          <div className="sub">
            Every project has a group for the people working on it. {unread > 0 ? `${unread} unread message${unread > 1 ? 's' : ''}.` : 'You are all caught up.'}
          </div>
        </div>
      </div>
      <ErrorNote error={error} retry={reload} />
      <div ref={gridRef} className={`teams ${activeId ? 'has-chat' : ''} ${wide ? 'wide' : ''}`} style={{ '--t-top': `${top}px` }}>
        {loading && !data ? <section className="t-list card"><Loading /></section> : <GroupList items={items} activeId={activeId} meId={me.id} />}
        {activeId ? (
          <Chat key={activeId} id={activeId} narrow={narrow} wide={wide} onRead={onRead} onListChanged={listChanged} />
        ) : !narrow && (
          <section className="t-chat card">
            <Empty icon={MessagesSquare} title={items.length ? 'Pick a group' : 'No groups yet'}>
              {items.length ? 'Choose a project on the left to see its chat, updates and everyone’s status.' : 'You join a project’s group as soon as you are on its team or get a task in it.'}
            </Empty>
          </section>
        )}
      </div>
    </>
  );
}
