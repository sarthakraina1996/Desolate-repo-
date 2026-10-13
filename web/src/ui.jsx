import { useEffect, useRef, useState } from 'react';
import {
  X, Flag, Loader2, MoreHorizontal, FileText, FileImage, FileVideo, FileSpreadsheet, FileArchive, File as FileIco,
  Link2, Presentation, Inbox,
} from 'lucide-react';
import { initials, fmtDate, MONTHS } from './format.js';
import { api } from './api.js';

export const PROJECT_STATUS = {
  planning: { label: 'Planning', cls: 'b-purple' },
  active: { label: 'Active', cls: 'b-blue' },
  on_hold: { label: 'On hold', cls: 'b-amber' },
  ready: { label: 'Ready', cls: 'b-green' },
  completed: { label: 'Delivered', cls: 'b-green' },
  cancelled: { label: 'Cancelled', cls: 'b-gray' },
};
export const HEALTH = {
  on_track: { label: 'On track', color: 'var(--green)', cls: 'b-green' },
  at_risk: { label: 'At risk', color: 'var(--amber)', cls: 'b-amber' },
  off_track: { label: 'Off track', color: 'var(--red)', cls: 'b-red' },
};
export const TASK_STATUS = {
  todo: { label: 'To do', cls: 'b-gray', color: '#9aa6b8' },
  in_progress: { label: 'In progress', cls: 'b-blue', color: 'var(--blue)' },
  review: { label: 'In review', cls: 'b-purple', color: 'var(--purple)' },
  blocked: { label: 'Blocked', cls: 'b-red', color: 'var(--red)' },
  done: { label: 'Done', cls: 'b-green', color: 'var(--green)' },
};
export const PRIORITY = {
  low: { label: 'Low', color: '#9aa6b8' },
  medium: { label: 'Medium', color: '#1a6df0' },
  high: { label: 'High', color: '#f2a600' },
  urgent: { label: 'Urgent', color: '#e31b3b' },
};
export const LEVEL_LABEL = { manager: 'Manager', member: 'Member', viewer: 'Viewer' };

// ---------------------------------------------------------------- colour helpers

function hexToRgb(hex) {
  const h = (hex || '#1a6df0').replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export const alpha = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
// Darker shade for text on a tint, so light brand colours (Exhibits green) stay readable.
export function ink(hex) {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const k = lum > 0.55 ? 0.55 : lum > 0.4 ? 0.75 : 0.9;
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
}

// ---------------------------------------------------------------- small pieces

export function Avatar({ name, color = '#1f2b7b', size = 32, title }) {
  return (
    <span className="avatar" title={title ?? name} style={{ width: size, height: size, background: color, fontSize: Math.max(10, Math.round(size * 0.38)) }}>
      {initials(name || '?')}
    </span>
  );
}

export function AvatarStack({ people = [], max = 4, size = 28 }) {
  const shown = people.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((p) => <Avatar key={p.id} name={p.name} color={p.color} size={size} />)}
      {people.length > max && <span className="avatar more" style={{ width: size, height: size }}>+{people.length - max}</span>}
    </span>
  );
}

export function Person({ name, color, sub, size = 34 }) {
  return (
    <div className="person">
      <Avatar name={name} color={color} size={size} />
      <div style={{ minWidth: 0 }}>
        <div className="pn ellipsis">{name}</div>
        {sub && <div className="ps ellipsis">{sub}</div>}
      </div>
    </div>
  );
}

export function VChip({ name, color, small }) {
  if (!name) return null;
  return (
    <span className={`vchip ${small ? 'sm' : ''}`} style={{ background: alpha(color, 0.14), color: ink(color) }}>
      {name}
    </span>
  );
}

// readyLabel: the vertical's name for its "ready" column, e.g. Ready for Event / Exhibition.
export function StatusBadge({ status, readyLabel }) {
  const s = PROJECT_STATUS[status] || PROJECT_STATUS.planning;
  return <span className={`badge ${s.cls}`}>{status === 'ready' && readyLabel ? readyLabel : s.label}</span>;
}

export function HealthBadge({ health, compact }) {
  const h = HEALTH[health] || HEALTH.on_track;
  return (
    <span className="status-dot" title={`Health: ${h.label}`}>
      <span className="dot" style={{ background: h.color }} />
      {!compact && h.label}
    </span>
  );
}

export function TaskStatusBadge({ status }) {
  const s = TASK_STATUS[status] || TASK_STATUS.todo;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function PriorityFlag({ priority, label = false }) {
  const p = PRIORITY[priority] || PRIORITY.medium;
  if (!label && (priority === 'medium' || priority === 'low')) return null;
  return (
    <span className="prio" style={{ color: p.color }} title={`${p.label} priority`}>
      <Flag size={13} fill={p.color} strokeWidth={2} />
      {label && p.label}
    </span>
  );
}

// A count that turns red while something new is waiting, and grey once seen.
export function CountPill({ n, fresh = 0, style }) {
  if (n === undefined || n === null) return null;
  return (
    <span className={`pill-num ${fresh > 0 ? 'alert' : ''}`} style={style} title={fresh > 0 ? `${fresh} new since you last looked` : undefined}>
      {n}
    </span>
  );
}

export function NewTag() {
  return <span className="new-tag">New</span>;
}

export function Progress({ value = 0, color, height = 8 }) {
  return (
    <div className="progress" style={{ height }} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color || 'var(--blue)' }} />
    </div>
  );
}

export function Ring({ value = 0, size = 64, stroke = 7, color = 'var(--blue)' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value}% complete`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#edf1f7" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.24} fontWeight="700" fill="var(--text)">{value}%</text>
    </svg>
  );
}

export function DateBox({ date, color }) {
  if (!date) return <div className="date-box"><span>—</span></div>;
  const [, m, d] = date.split('-').map(Number);
  return (
    <div className="date-box" style={color ? { borderColor: alpha(color, 0.5), background: alpha(color, 0.06) } : undefined}>
      <b>{d}</b>
      <span>{MONTHS[m - 1]}</span>
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading"><Loader2 size={18} className="spin" />{label}</div>
  );
}

export function Empty({ icon: Icon = Inbox, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={34} />
      {title && <div className="b6" style={{ color: 'var(--text-2)', marginBottom: 4 }}>{title}</div>}
      {children && <div className="small" style={{ maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}>{children}</div>}
      {action && <div className="mt-12">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error, retry }) {
  if (!error) return null;
  return (
    <div className="alert error mb-12">
      <span style={{ flex: 1 }}>{error.message || String(error)}</span>
      {retry && <button type="button" className="btn xs" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Field({ label, hint, children, className = '', htmlFor }) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Modal({ title, sub, onClose, children, footer, size = '', labelId = 'modal-title' }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const first = ref.current?.querySelector('input:not([type=hidden]),select,textarea,button:not(.icon-btn)');
    first?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h3 id={labelId}>{title}</h3>
            {sub && <div className="small muted mt-4">{sub}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Seg({ value, onChange, options, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.title || o.label}>
          {o.icon && <o.icon size={15} style={{ verticalAlign: '-3px', marginRight: o.label ? 6 : 0 }} />}
          {o.label && <span className={o.icon ? 'hide-sm' : ''}>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function useClickOutside(onOutside) {
  const ref = useRef(null);
  useEffect(() => {
    const on = (e) => ref.current && !ref.current.contains(e.target) && onOutside();
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, [onOutside]);
  return ref;
}

export function Menu({ items, label = 'More actions', icon: Icon = MoreHorizontal, buttonClass = 'btn sm ghost', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={buttonClass} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon size={18} />
      </button>
      {open && (
        <div className="dropdown menu" role="menu" style={align === 'left' ? { left: 0, right: 'auto' } : undefined}>
          {shown.map((it, i) => (
            <button key={i} type="button" role="menuitem" className={`item ${it.danger ? 'danger' : ''}`} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon && <it.icon size={16} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UserSelect({ id, value, onChange, people, placeholder = 'Unassigned', className = 'select', disabled }) {
  return (
    <select id={id} className={className} value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={disabled}>
      <option value="">{placeholder}</option>
      {people.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------- files

const EXT_ICON = [
  [/\.(xlsx?|csv|numbers)$/i, FileSpreadsheet, '#1fa855'],
  [/\.(pptx?|key)$/i, Presentation, '#e8590c'],
  [/\.(zip|rar|7z)$/i, FileArchive, '#7c5cfc'],
  [/\.(docx?|pdf|txt|rtf)$/i, FileText, '#1a6df0'],
  [/\.(dwg|dxf|ai|psd|eps|indd|skp|max)$/i, FileImage, '#ef4778'],
];

export function fileVisual(file) {
  if (file.kind === 'link') return { Icon: Link2, color: '#1a6df0' };
  if (file.mime?.startsWith('image/')) return { Icon: FileImage, color: '#1fa855' };
  if (file.mime?.startsWith('video/')) return { Icon: FileVideo, color: '#e31b3b' };
  if (file.mime === 'application/pdf') return { Icon: FileText, color: '#e31b3b' };
  for (const [re, Icon, color] of EXT_ICON) if (re.test(file.name)) return { Icon, color };
  return { Icon: FileIco, color: '#6b7a90' };
}

export function FileIcon({ file, size = 20 }) {
  const { Icon, color } = fileVisual(file);
  return (
    <span className="file-ic" style={{ background: alpha(color, 0.12), color }}>
      <Icon size={size} />
    </span>
  );
}

// A drawn placeholder for sample images in the demo data, tinted with the vertical colour.
function SampleArt({ file }) {
  const c = file.vertical_color || '#1a6df0';
  const seed = (file.id * 9301 + 49297) % 233280;
  const night = /night/i.test(file.name);
  const sky = night ? '#1b2848' : '#eef3fb';
  const w = 40 + (seed % 25);
  return (
    <svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" aria-hidden="true">
      <rect width="160" height="100" fill={sky} />
      <polygon points="0,72 160,62 160,100 0,100" fill={night ? '#2d3a5f' : '#dfe6f1'} />
      <polygon points={`${80 - w},70 ${80 + w},64 ${80 + w},30 ${80 - w},34`} fill={c} opacity="0.92" />
      <rect x={80 - w / 2} y="44" width={w * 0.9} height="9" rx="2" fill="#fff" opacity="0.85" />
      <polygon points={`${70 - w / 3},84 ${92 + w / 3},80 ${92 + w / 3},70 ${70 - w / 3},73`} fill="#fff" opacity="0.9" />
      <polygon points={`${70 - w / 3},84 ${92 + w / 3},80 ${92 + w / 3},83 ${70 - w / 3},87`} fill={c} opacity="0.6" />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={40 + i * 40 + (seed % 9)} cy={night ? 16 : 14} r={night ? 2.2 : 0} fill="#fff7c2" />
      ))}
    </svg>
  );
}

export function FileThumb({ file }) {
  const [url, setUrl] = useState(null);
  const isImage = file.mime?.startsWith('image/');
  const sample = file.storage_key?.startsWith('sample:');
  useEffect(() => {
    let live = true;
    if (isImage && !sample) api.previewUrl(file).then((u) => live && setUrl(u)).catch(() => {});
    return () => {
      live = false;
    };
  }, [file, isImage, sample]);
  if (isImage && sample) return <div className="thumb"><SampleArt file={file} /></div>;
  if (isImage && url) return <div className="thumb"><img src={url} alt="" loading="lazy" /></div>;
  const { Icon, color } = fileVisual(file);
  const ext = file.kind === 'link' ? 'LINK' : (file.name.split('.').pop() || '').slice(0, 4).toUpperCase();
  return (
    <div className="thumb icon" style={{ background: alpha(color, 0.08), color }}>
      <Icon size={30} strokeWidth={1.6} />
      <span>{ext}</span>
    </div>
  );
}

export function dateRange(a, b, today) {
  if (!a && !b) return '—';
  if (a && b) return `${fmtDate(a, { today })} – ${fmtDate(b, { today })}`;
  return fmtDate(a || b, { today });
}
