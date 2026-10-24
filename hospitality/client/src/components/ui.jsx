// UI kit: cards, KPI tiles, buttons, badges, tabs, form fields, modal, menus and the
// loading / empty / error states every screen uses.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Inbox, Info, Minus, MoreHorizontal, X } from 'lucide-react';
import { useApp } from '../context.jsx';
import { useClickOutside } from '../lib/hooks.js';
import { number, statusLabel } from '../lib/format.js';

export function Card({ title, sub, action, children, className = '', flush, id }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${className}`} id={id}>
      {(title || action) && (
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          <div className="spacer" />
          {action}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

// Change vs the comparison period. `good` = whether up is good for this metric.
// Change vs the comparison period. "partial": the comparison period holds records for fewer
// days, so totals are not comparable (ratios still are).
export function Delta({ change, isPercent = false, good = true, suffix }) {
  if (change?.partial)
    return (
      <span className="delta flat" title="The comparison period has fewer days of records, so totals are not comparable">
        partial
      </span>
    );
  if (!change || change.abs == null) return <span className="delta flat">—</span>;
  const v = isPercent ? change.abs : change.pct;
  if (v == null) return <span className="delta flat">new</span>;
  const dir = Math.abs(v) < 0.05 ? 'flat' : v > 0 ? 'up' : 'down';
  const tone = dir === 'flat' ? 'flat' : (dir === 'up') === good ? 'up' : 'down';
  const Icon = dir === 'flat' ? Minus : dir === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`delta ${tone}`}>
      <Icon size={13} aria-hidden />
      {number(Math.abs(v), 1)}
      {isPercent ? ' pts' : '%'}
      {suffix && <span className="muted" style={{ fontWeight: 400, marginLeft: 4 }}>{suffix}</span>}
    </span>
  );
}

export function Kpi({ label, value, foot, onClick, unavailable, title, icon: Icon }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`kpi ${unavailable ? 'unavailable' : ''}`} onClick={onClick} title={title} type={onClick ? 'button' : undefined}>
      <span className="label">
        {Icon && <Icon size={14} aria-hidden />}
        {label}
      </span>
      <span className="value">{value}</span>
      {foot && <span className="foot">{foot}</span>}
    </Tag>
  );
}

export function Button({ variant = '', size = '', icon: Icon, children, busy, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${variant} ${size} ${className}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : Icon && <Icon size={15} aria-hidden />}
      {children}
    </button>
  );
}

export const Badge = ({ tone = '', children, dot, title }) => (
  <span className={`badge ${tone}`} title={title}>
    {dot && <span className="bdot" />}
    {children}
  </span>
);

const RES_TONE = { quote: 'outline', confirmed: 'info', in_house: 'good', checked_out: 'teal', closed: '', cancelled: 'danger', no_show: 'warn' };
export const StatusBadge = ({ status }) => <Badge tone={RES_TONE[status]}>{statusLabel(status)}</Badge>;

// Room status display codes (PRD HK-1), with words, never colour alone.
export const ROOM_CODES = {
  VC: { label: 'Vacant clean', tone: 'good' },
  INSP: { label: 'Inspected', tone: 'teal' },
  VD: { label: 'Vacant dirty', tone: 'warn' },
  OC: { label: 'Occupied clean', tone: 'info' },
  OD: { label: 'Occupied dirty', tone: 'danger' },
  CIP: { label: 'Cleaning', tone: 'violet' },
  OOO: { label: 'Out of order', tone: 'danger' },
  OOS: { label: 'Out of service', tone: '' },
};
export const RoomCode = ({ code, short }) => (
  <Badge tone={ROOM_CODES[code]?.tone} title={ROOM_CODES[code]?.label}>
    {short ? code : ROOM_CODES[code]?.label || code}
  </Badge>
);

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={15} aria-hidden />}
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="lbl">{label}</span>}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="err">{error}</span>}
    </label>
  );
}
export const Input = ({ className = '', ...p }) => <input className={`input ${className}`} {...p} />;
export const Textarea = ({ className = '', ...p }) => <textarea className={`textarea ${className}`} {...p} />;
export function Select({ options = [], placeholder, className = '', ...p }) {
  return (
    <select className={`select ${className}`} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
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
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Menu({ items, label = 'More actions', icon: Icon = MoreHorizontal, align = 'right', button }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close);
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {button ? (
        button({ open, toggle: () => setOpen((o) => !o) })
      ) : (
        <button className="btn ghost sm" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon size={16} />
        </button>
      )}
      {open && (
        <div className="menu" style={{ [align]: 0, top: 'calc(100% + 4px)' }} role="menu">
          {visible.map((it, i) =>
            it === '-' ? (
              <div className="sep" key={i} />
            ) : it.heading ? (
              <div className="menu-label" key={i}>
                {it.heading}
              </div>
            ) : (
              <button
                key={i}
                role="menuitem"
                className={it.danger ? 'danger' : ''}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                {it.icon && <it.icon size={15} aria-hidden />}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export const Loading = ({ text = 'Loading…' }) => (
  <div className="state" role="status">
    <div className="spinner" />
    <span>{text}</span>
  </div>
);

export function Empty({ icon: Icon = Inbox, title = 'Nothing here yet', children }) {
  return (
    <div className="state">
      <div className="ico">
        <Icon size={22} />
      </div>
      <div className="strong" style={{ color: 'var(--text)' }}>
        {title}
      </div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state error" role="alert">
      <div className="ico">
        <AlertTriangle size={22} />
      </div>
      <div className="strong" style={{ color: 'var(--text)' }}>
        {error?.status === 403 ? 'You do not have access to this' : 'This could not be loaded'}
      </div>
      <div className="small">{error?.message}</div>
      {onRetry && error?.status !== 403 && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// Renders loading / error / content for a useApi() result, keeping old data while refetching.
export function Async({ q, children, isEmpty, emptyView }) {
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading />;
  if (isEmpty && isEmpty(q.data)) return emptyView || <Empty />;
  return <div className={q.loading ? 'refetching' : ''}>{children(q.data)}</div>;
}

export const Notice = ({ tone = '', icon: Icon = Info, children }) => (
  <div className={`notice ${tone}`}>
    <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
    <div>{children}</div>
  </div>
);

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// Runs an async action with busy state and toasts; returns [run, busy].
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => (mounted.current = false), []);
  const run = useCallback(
    async (fn, { success, onError } = {}) => {
      setBusy(true);
      try {
        const out = await fn();
        if (success) toast(typeof success === 'function' ? success(out) : success, 'good');
        return out;
      } catch (e) {
        if (onError) onError(e);
        else toast(e.message, 'error');
        return undefined;
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [toast],
  );
  return [run, busy];
}

export function Confirm({ title, message, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onClose, children, busy }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} busy={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p style={{ marginBottom: children ? 12 : 0 }}>{message}</p>}
      {children}
    </Modal>
  );
}

export function PageHead({ title, sub, crumbs, children }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  );
}
