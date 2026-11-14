// Shared building blocks: status labels, fields, dialogs, toasts, data loading, QR.
import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { AlertTriangle, Check, CircleAlert, Clock, X } from 'lucide-react';
import { STATES } from './format.js';

const TONE_ICON = { ok: Check, pending: Clock, error: CircleAlert };
// A state shown as icon + words on a tinted background.
export function Status({ kind, value, tone, children }) {
  const [t, label] = kind ? STATES[kind]?.[value] || ['', value] : [tone || '', children];
  const Icon = TONE_ICON[t];
  return (
    <span className={`status ${t}`}>
      {Icon && <Icon aria-hidden="true" />}
      {label}
    </span>
  );
}

// Label, optional hint and error wired to the control for screen readers.
export function Field({ label, hint, error, children }) {
  const id = useId();
  const describedBy = [hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="hint" id={`${id}-h`}>
          {hint}
        </span>
      )}
      {cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {error && (
        <span className="err" id={`${id}-e`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', children }) {
  const Icon = tone === 'ok' ? Check : tone === 'info' ? null : AlertTriangle;
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {Icon && <Icon className="icon" aria-hidden="true" />}
      <div className="grow">{children}</div>
    </div>
  );
}
export const Loading = () => (
  <p className="empty" role="status">
    Loading…
  </p>
);
export const Empty = ({ children }) => <p className="empty">{children}</p>;

// Loads data and reloads when deps change. Returns { data, error, loading, reload }.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useRef(0);
  const reload = useCallback(() => {
    const mine = ++run.current;
    return fn()
      .then((data) => mine === run.current && setState({ data, error: null, loading: false }))
      .catch((error) => mine === run.current && setState((s) => ({ ...s, error, loading: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}
// Shows the loading or failed state of useLoad, or renders children with the data.
export function Loaded({ load, children }) {
  if (load.error && !load.data)
    return (
      <Notice tone="error">
        {load.error.message}{' '}
        <button className="btn sm" onClick={load.reload}>
          Try again
        </button>
      </Notice>
    );
  if (!load.data) return <Loading />;
  return children(load.data);
}

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = '') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts no-print" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.tone}`}>
            {i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
// Runs an action, toasting the error if it fails. Returns true on success.
export function useAction() {
  const toast = useToast();
  return useCallback(
    async (fn, done) => {
      try {
        const out = await fn();
        if (done) toast(done);
        return out ?? true;
      } catch (e) {
        toast(e.message, 'error');
        return false;
      }
    },
    [toast],
  );
}

// ---------- dialog ----------
export function Dialog({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="backdrop no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="head">
          <h3>{title}</h3>
          <button className="btn plain" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="body">{children}</div>
        {footer && <div className="foot">{footer}</div>}
      </div>
    </div>
  );
}

// A form built from field specs: { key, label, type, options, required, hint }.
// type: text | number | money | textarea | select | checkbox | date | time | multi
export function FormDialog({ title, fields, initial = {}, submitLabel = 'Save', onSubmit, onClose, intro }) {
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of fields) {
      const raw = initial[f.key];
      v[f.key] =
        f.type === 'money'
          ? raw != null
            ? raw / 100
            : ''
          : f.type === 'checkbox'
            ? Boolean(raw ?? f.default)
            : f.type === 'multi'
              ? raw || []
              : (raw ?? f.default ?? '');
    }
    return v;
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setValues((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const out = {};
    for (const f of fields) out[f.key] = f.type === 'money' ? Math.round(Number(values[f.key] || 0) * 100) : values[f.key];
    try {
      await onSubmit(out);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        {intro}
        {fields.map((f) => {
          const v = values[f.key];
          if (f.type === 'checkbox')
            return (
              <label key={f.key} className="check">
                <input type="checkbox" checked={v} onChange={(e) => set(f.key, e.target.checked)} />
                <span>
                  {f.label}
                  {f.hint && (
                    <span className="muted small">
                      <br />
                      {f.hint}
                    </span>
                  )}
                </span>
              </label>
            );
          if (f.type === 'multi')
            return (
              <fieldset key={f.key} style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="label">{f.label}</legend>
                {f.options.map((o) => (
                  <label key={o.value} className="check">
                    <input
                      type="checkbox"
                      checked={v.includes(o.value)}
                      onChange={(e) => set(f.key, e.target.checked ? [...v, o.value] : v.filter((x) => x !== o.value))}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </fieldset>
            );
          const common = { className: 'input', value: v, required: f.required, onChange: (e) => set(f.key, e.target.value) };
          return (
            <Field key={f.key} label={f.label + (f.required ? '' : ' (optional)')} hint={f.hint}>
              {f.type === 'select' ? (
                <select {...common}>
                  <option value="">Choose…</option>
                  {f.options.map((o) => (
                    <option key={o.value ?? o} value={o.value ?? o}>
                      {o.label ?? o}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea {...common} />
              ) : (
                <input
                  {...common}
                  type={f.type === 'money' || f.type === 'number' ? 'number' : f.type || 'text'}
                  step={f.type === 'money' ? '0.01' : f.step}
                  min={f.type === 'money' || f.type === 'number' ? 0 : undefined}
                  inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : undefined}
                />
              )}
            </Field>
          );
        })}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// Asks for a reason before a consequential action (reject, override, reprint, refund).
export function useFormDialog() {
  const [spec, setSpec] = useState(null);
  const node = spec ? <FormDialog {...spec} onClose={() => setSpec(null)} /> : null;
  return [node, setSpec];
}

// QR image for a pass. High contrast on white; the text is an opaque reference.
export function Qr({ text, size = 232, alt = 'Pass QR code' }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { margin: 2, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(
      (u) => live && setSrc(u),
    );
    return () => {
      live = false;
    };
  }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={alt} /> : <div className="qr" style={{ height: size }} />;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" className="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count ? ` (${t.count})` : ''}
        </button>
      ))}
    </div>
  );
}

// Loads an image from the API through fetch (so it works for signed-in drafts and in the
// in-browser demo) and returns an object URL, or null until it has loaded.
export function useImage(src) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!src) return setUrl(null);
    let live = true;
    let made = null;
    fetch(src)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && live) setUrl((made = URL.createObjectURL(b)));
      })
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [src]);
  return url;
}
