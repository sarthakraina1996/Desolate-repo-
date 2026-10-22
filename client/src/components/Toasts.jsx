// Pop-up messages, themed by the section they came from (its sidebar icon and colour) and marked
// with their purpose: a tick for success, a cross for errors, "i" for information, "!" for warnings.
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const PURPOSE = {
  success: { label: 'Done', mark: 'M5 10.4 8.4 13.6 15 6.8' },
  error: { label: 'Could not complete', mark: 'M6.5 6.5l7 7M13.5 6.5l-7 7' },
  warning: { label: 'Heads up', mark: 'M10 5.6v5.4M10 14.4v.1' },
  info: { label: 'Note', mark: 'M10 9.2v5M10 5.8v.1' },
};

export const TOAST_MS = { success: 4200, info: 4200, warning: 6000, error: 6500 };

function Toast({ t, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const p = PURPOSE[t.kind] || PURPOSE.info;
  const { Icon } = t.module;
  // Safety net in case the exit animation never reports back (for example a hidden tab).
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => onDone(t.id), 450);
    return () => clearTimeout(timer);
  }, [leaving, onDone, t.id]);
  return (
    <div
      className={`toast ${t.kind} ${leaving ? 'leaving' : ''}`}
      style={{ '--accent': t.module.color, '--accent-soft': t.module.soft, '--accent-ink': t.module.ink, '--toast-ms': `${TOAST_MS[t.kind] || TOAST_MS.info}ms` }}
      role={t.kind === 'error' ? 'alert' : 'status'}
      onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onDone(t.id); }}
    >
      <div className="toast-tile">
        <Icon size={24} />
        <svg className="toast-mark" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="10" />
          <path d={p.mark} />
        </svg>
      </div>
      <div className="toast-body">
        <div className="toast-mod">{t.module.label}<span className="sr-only"> · {p.label}</span></div>
        <div className="toast-msg">{t.text}</div>
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setLeaving(true)}><X size={15} /></button>
      {/* The countdown; hovering pauses it. When it runs out the message slides away. */}
      <div className="toast-bar" onAnimationEnd={(e) => { e.stopPropagation(); setLeaving(true); }} />
    </div>
  );
}

export default function Toasts({ toasts, onDone }) {
  return (
    <div className="toasts">
      {toasts.map((t) => <Toast key={t.id} t={t} onDone={onDone} />)}
    </div>
  );
}
