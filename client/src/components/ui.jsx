import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Inbox, LoaderCircle, Ellipsis, X } from 'lucide-react';
import { colorFor, initials } from '../lib/format.js';
import { photoUrl } from '../lib/api.js';
import { useClickOutside } from '../lib/hooks.js';
import { useApp } from '../context.jsx';

export function Card({ title, sub, action, children, className = '', flush, tight, style, id }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${tight ? 'tight' : ''} ${className}`} style={style} id={id}>
      {(title || action) && (
        <div className="card-head" style={flush ? { padding: '16px 18px 0' } : undefined}>
          <h3>{title}{sub != null && <span className="sub">{sub}</span>}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Delta({ value, label = 'vs. last month', invert = false }) {
  if (value == null) return null;
  if (value === 0) return <span className="delta"><span className="d" style={{ color: 'var(--muted)' }}>0%</span>{label && <small>{label}</small>}</span>;
  const up = value > 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'} ${invert ? 'bad' : ''}`}>
      <span className="d">{up ? <ArrowUp size={14} strokeWidth={3} /> : <ArrowDown size={14} strokeWidth={3} />}{up ? '+' : ''}{value}%</span>
      {label && <small>{label}</small>}
    </span>
  );
}

export function Kpi({ icon: Icon, tone = 'blue', label, value, unit, delta, deltaLabel, invert, extra, onClick }) {
  return (
    <div className="card kpi" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className={`ic tone-${tone}`}>{Icon && <Icon size={30} strokeWidth={2} />}</div>
      <div className="grow">
        <div className="lbl">{label}</div>
        <div className="val">
          <span>{value}</span>{unit && <small>{unit}</small>}
          {delta != null && <Delta value={delta} label={deltaLabel} invert={invert} />}
          {extra}
        </div>
      </div>
    </div>
  );
}

const STATUS_TONES = {
  green: ['Approved', 'Active', 'Completed', 'Paid', 'Accepted', 'Compliant', 'Hired', 'Resolved', 'Done', 'Present', 'Issued', 'Eligible', 'Processed', 'Closed Won', 'Yes', 'Strong Hire', 'Strong Fit', 'Shortlist'],
  amber: ['Pending', 'Scheduled', 'Self Review', 'Manager Review', 'Under Inquiry', 'Received', 'Sent', 'Notice', 'Hold', 'On Hold', 'Open', 'Planned', 'Partial Fit', 'Unclear', 'Not Run', 'Queued'],
  blue: ['In Progress', 'In Review', 'Finance Reviewed', 'Transfer Scheduled', 'Processing', 'Interview 1', 'Interview 2', 'Shortlisted', 'AI Screened', 'Hire', 'Good Fit', 'WFH', 'Offer'],
  red: ['Rejected', 'Declined', 'Exited', 'No Hire', 'Weak Fit', 'No', 'Absent', 'Failed', 'Error'],
  gray: ['Cancelled', 'Withdrawn', 'Not Started', 'Returned', 'Closed', 'Applied', 'Draft', 'On Leave'],
};
export function toneOf(status) {
  for (const [tone, list] of Object.entries(STATUS_TONES)) if (list.includes(status)) return tone;
  return 'gray';
}
export function Badge({ tone, children, lg, title }) {
  return <span className={`badge b-${tone || toneOf(children)} ${lg ? 'lg' : ''}`} title={title}>{children}</span>;
}
export function StatusDot({ status }) {
  const color = { Active: 'var(--green)', 'On Leave': 'var(--amber)', Notice: 'var(--pink)', Exited: 'var(--faint)' }[status] || 'var(--blue)';
  return <span className="status-dot"><span className="dot" style={{ background: color }} />{status}</span>;
}

export function Avatar({ name = '', id, hasPhoto, size = 36, online, square }) {
  const [broken, setBroken] = useState(false);
  const src = hasPhoto && id ? photoUrl(id) : null;
  const style = { width: size, height: size, fontSize: Math.max(11, size * 0.38), background: colorFor(name), borderRadius: square ? 12 : '50%' };
  return (
    <span className="avatar" style={style}>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : initials(name)}
      {online && <span className="online" />}
    </span>
  );
}

export function Person({ name, sub, id, hasPhoto, size = 36, link = true, extra }) {
  return (
    <div className="person">
      <Avatar name={name} id={id} hasPhoto={hasPhoto} size={size} />
      <div style={{ minWidth: 0 }}>
        {link && id ? <Link className="pn ellipsis" style={{ display: 'block' }} to={`/employees/${id}`} onClick={(e) => e.stopPropagation()}>{name}</Link> : <div className="pn ellipsis">{name}</div>}
        {sub && <div className="ps ellipsis">{sub}</div>}
        {extra}
      </div>
    </div>
  );
}

const hexToSoft = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.12)`;
};
export function VChip({ vertical, color = '#1A6DF0', department }) {
  if (!vertical) return <span className="muted">—</span>;
  const label = department && department !== vertical ? `${vertical} • ${department}` : vertical;
  return <span className="vchip" style={{ background: hexToSoft(color), color }}>{label}</span>;
}

export function Button({ variant = '', size = '', icon: Icon, loading, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${variant} ${size} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <LoaderCircle size={16} className="spin" /> : Icon && <Icon size={size === 'xs' ? 13 : 16} />}
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, size = '' }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <div className={`field ${className}`}>
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}
export const Input = ({ className = '', ...p }) => <input className={`input ${className}`} {...p} />;
export const Textarea = ({ className = '', ...p }) => <textarea className={`textarea ${className}`} {...p} />;
export function Select({ options = [], placeholder, className = '', ...p }) {
  return (
    <select className={`select ${className}`} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'object' ? <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  );
}
export function EmployeeSelect({ value, onChange, placeholder = 'Select employee', exclude = [], className = '' }) {
  const { meta } = useApp();
  const opts = (meta?.employees || []).filter((e) => !exclude.includes(e.id)).map((e) => ({ value: e.id, label: `${e.name} · ${e.code}` }));
  return <Select className={className} value={value ?? ''} onChange={onChange} placeholder={placeholder} options={opts} />;
}

export function Tabs({ tabs, value, onChange, variant = '' }) {
  return (
    <div className={`tabs ${variant}`} role="tablist">
      {tabs.map((t) => {
        const key = typeof t === 'string' ? t : t.value;
        const label = typeof t === 'string' ? t : t.label;
        return <button key={key} type="button" role="tab" aria-selected={value === key} className={value === key ? 'on' : ''} onClick={() => onChange(key)}>{label}</button>;
      })}
    </div>
  );
}
export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => {
        const key = typeof o === 'string' ? o : o.value;
        return <button key={key} type="button" className={value === key ? 'on' : ''} onClick={() => onChange(key)}>{typeof o === 'string' ? o : o.label}</button>;
      })}
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, text = 'Nothing here yet', children }) {
  return (
    <div className="empty">
      <Icon size={30} />
      <div>{text}</div>
      {children && <div className="mt-12">{children}</div>}
    </div>
  );
}
export const Loading = ({ text = 'Loading…' }) => <div className="loading"><LoaderCircle className="spin" size={20} />{text}</div>;
export function ErrorBox({ error, onRetry }) {
  return <div className="alert error">{error}{onRetry && <button type="button" className="link" onClick={onRetry}>Retry</button>}</div>;
}

export function Progress({ value = 0, color = 'var(--blue)', height = 8 }) {
  return <div className="progress" style={{ height }}><i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div>;
}
export function Toggle({ on, onChange, disabled, label }) {
  return <button type="button" className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="row between wrap mt-12">
      <div className="row gap-4">
        <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
        {nums.map((n, i) => (n === '…' ? <span key={`e${i}`} className="muted">…</span>
          : <button key={n} type="button" className={`btn sm ${n === page ? 'primary' : 'ghost'}`} style={{ minWidth: 32, padding: 0 }} onClick={() => onPage(n)}>{n}</button>))}
        <button type="button" className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
      </div>
      {onPageSize && (
        <div className="row small muted">
          Show
          <select className="select sm" style={{ width: 120 }} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 20, 50].map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

// Promise-based confirm dialog: const [confirm, el] = useConfirm(); if (await confirm({...})) ...
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (v) => {
    state?.resolve(v);
    setState(null);
  };
  const el = state ? (
    <Modal title={state.title || 'Are you sure?'} size="narrow" onClose={() => close(false)}
      footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={state.danger ? 'solid-red' : 'primary'} onClick={() => close(true)}>{state.confirmLabel || 'Confirm'}</Button></>}>
      <p className="muted" style={{ lineHeight: 1.55 }}>{state.text}</p>
    </Modal>
  ) : null;
  return [confirm, el];
}

export function Menu({ items, label = 'More actions', icon: Icon = Ellipsis, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="btn ghost sm" aria-label={label} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} style={{ padding: '0 8px' }}><Icon size={18} /></button>
      {open && (
        <div className="dropdown" style={{ minWidth: 200, [align]: 0 }}>
          {visible.map((it) => (
            <div key={it.label} className="item" style={it.danger ? { color: 'var(--red)' } : undefined} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick(); }}>
              {it.icon && <it.icon size={16} />}{it.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DateBox({ date }) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  return <div className="date-box"><b>{d.getDate()}</b><span>{d.toLocaleString('en-US', { month: 'short' })}</span></div>;
}

export function FileDrop({ onFiles, accept, multiple = true, children }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); }}
      onClick={() => input.current?.click()}
      style={{ border: `2px dashed ${over ? 'var(--blue)' : 'var(--border-strong)'}`, borderRadius: 14, padding: 18, textAlign: 'center', cursor: 'pointer', background: over ? 'var(--blue-soft)' : 'var(--surface-2)' }}
    >
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { if (e.target.files.length) onFiles([...e.target.files]); e.target.value = ''; }} />
      {children}
    </div>
  );
}

export function SimpleMarkdown({ text = '' }) {
  // Renders the small subset used by policies: ## headings, - bullets, paragraphs.
  const blocks = [];
  let list = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('- ')) {
      if (!list) blocks.push((list = { type: 'ul', items: [] }));
      list.items.push(line.slice(2));
      continue;
    }
    list = null;
    if (line.startsWith('## ')) blocks.push({ type: 'h2', text: line.slice(3) });
    else if (line.trim()) blocks.push({ type: 'p', text: line });
  }
  return (
    <div className="prose">
      {blocks.map((b, i) => (b.type === 'ul' ? <ul key={i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul> : b.type === 'h2' ? <h2 key={i}>{b.text}</h2> : <p key={i}>{b.text}</p>))}
    </div>
  );
}
