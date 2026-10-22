// Phone navigation: a bottom tab bar with the pages each role uses most, and "More", a sheet
// that slides up with every module, a search and the app install link.
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Search, Smartphone, X } from 'lucide-react';
import { useApp } from '../context.jsx';
import { Monogram, moduleFor } from './icons.jsx';

// Bottom-bar tabs per role; every other module is under More.
const TABS = {
  admin: ['/', '/employees', '/attendance', '/leave'],
  hr: ['/', '/employees', '/attendance', '/leave'],
  manager: ['/', '/my', '/attendance', '/leave'],
  employee: ['/my', '/attendance', '/leave', '/documents'],
};
// Shorter tab labels for module names that don't fit under an icon.
const SHORT = { '/leave': 'Leave', '/calendar': 'Holidays', '/screener': 'Screener' };
// Whether nav item `n` is the current page or one of its sub-pages.
const isActive = (n, path) =>
  n.end ? path === n.to : path === n.to || path.startsWith(`${n.to}/`);
// CSS variables that tint a tab in its module's colours.
const theme = (to) => {
  const m = moduleFor(to);
  return { '--accent-soft': m.soft, '--accent-ink': m.ink };
};

// Four-square grid icon for the More tab.
function MoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {[
        [3.5, 3.5],
        [13.5, 3.5],
        [3.5, 13.5],
        [13.5, 13.5],
      ].map(([x, y]) => (
        <rect
          key={`${x}${y}`}
          x={x}
          y={y}
          width="7"
          height="7"
          rx="2.2"
          stroke="#22314A"
          strokeWidth="1.9"
        />
      ))}
    </svg>
  );
}

// Phone tab bar: the role's main pages plus More.
export function BottomBar({ items, moreOpen, onMore }) {
  const { user } = useApp();
  const { pathname } = useLocation();
  // Keep only the tabs this user can actually open.
  const tabs = (TABS[user.role] || TABS.employee)
    .map((to) => items.find((n) => n.to === to))
    .filter(Boolean);
  // On a page with no tab of its own, More is shown as the active tab.
  const elsewhere = !tabs.some((n) => isActive(n, pathname));
  return (
    <nav className="bnav no-print" aria-label="Main">
      {tabs.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive: on }) => `bnav-tab ${on && !moreOpen ? 'on' : ''}`}
          style={theme(n.to)}
        >
          <span className="bnav-ic">
            <n.icon size={22} />
          </span>
          <span className="bnav-lbl">{SHORT[n.to] || n.label}</span>
        </NavLink>
      ))}
      {/* More: opens the sheet with every module */}
      <button
        type="button"
        className={`bnav-tab ${moreOpen || elsewhere ? 'on' : ''}`}
        style={{ '--accent-soft': '#DCE3F2', '--accent-ink': 'var(--navy)' }}
        onClick={onMore}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
      >
        <span className="bnav-ic">
          <MoreIcon />
        </span>
        <span className="bnav-lbl">More</span>
      </button>
    </nav>
  );
}

// Case-insensitive module search on the label; an empty query matches everything.
const matches = (n, q) => {
  const t = q.trim().toLowerCase();
  return (
    !t ||
    n.label.toLowerCase().includes(t) ||
    n.label
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.startsWith(t))
  );
};

// Slide-up sheet with every module, a module search and the install link.
export function MoreSheet({ items, onClose, onGetApp }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [closing, setClosing] = useState(false);
  const [pull, setPull] = useState(0); // how far it has been pulled down
  const drag = useRef(null);
  // Closing plays the slide-down first; onClose unmounts the sheet once it has finished.
  const close = () => setClosing(true);
  useEffect(() => {
    if (!closing) return undefined;
    const t = setTimeout(onClose, 220);
    return () => clearTimeout(t);
  }, [closing, onClose]);
  // Escape closes it, and the page behind stops scrolling while it is open.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setClosing(true);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  const go = (to) => {
    navigate(to);
    close();
  };
  // Pull the handle down to close it, as on a native sheet.
  const grip = {
    onPointerDown: (e) => {
      drag.current = { id: e.pointerId, y: e.clientY };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      if (drag.current?.id === e.pointerId) setPull(Math.max(0, e.clientY - drag.current.y));
    },
    onPointerUp: (e) => {
      if (drag.current?.id !== e.pointerId) return;
      drag.current = null;
      if (pull > 90) close();
      setPull(0);
    },
    onPointerCancel: () => {
      drag.current = null;
      setPull(0);
    },
  };
  const shown = items.filter((n) => matches(n, q));
  return (
    <>
      <div className={`sheet-scrim ${closing ? 'out' : ''}`} onClick={close} />
      <div
        className={`sheet ${closing ? 'out' : ''} ${pull ? 'pulling' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="All modules"
        style={pull ? { transform: `translateY(${pull}px)` } : undefined}
      >
        {/* Drag handle and title */}
        <div className="sheet-top" {...grip}>
          <span className="sheet-grip" aria-hidden="true" />
          <div className="sheet-head">
            <Monogram height={22} label={null} />
            <b>All modules</b>
            <button
              type="button"
              className="sheet-x"
              onClick={close}
              aria-label="Close"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <X size={18} />
            </button>
          </div>
        </div>
        {/* Module search; Enter opens the first match */}
        <div className="sheet-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search modules"
            aria-label="Search modules"
            onKeyDown={(e) => e.key === 'Enter' && shown[0] && go(shown[0].to)}
          />
        </div>
        <div className="sheet-body">
          {/* Module grid */}
          {shown.length ? (
            <div className="sheet-grid">
              {shown.map((n) => (
                <button
                  key={n.to}
                  type="button"
                  className={`fq-tile ${isActive(n, pathname) ? 'active' : ''}`}
                  onClick={() => go(n.to)}
                >
                  <span className="fq-ic" style={{ '--tint': moduleFor(n.to).soft }}>
                    <n.icon size={28} />
                  </span>
                  <span className="fq-lbl">{n.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="fq-none small muted">No module matches “{q}”.</div>
          )}
          {/* Install the app */}
          {onGetApp && (
            <button
              type="button"
              className="sheet-row"
              onClick={() => {
                close();
                onGetApp();
              }}
            >
              <span className="sheet-row-ic">
                <Smartphone size={18} />
              </span>
              <span>
                <b>Install the app</b>
                <small>Open BrainADZ HRMS from your home screen</small>
              </span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
