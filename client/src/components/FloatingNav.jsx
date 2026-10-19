// Floating navigation: a draggable Br button that opens either a floating sidebar with every
// module the user may open, or the Quick Access card (module search and shortcut tiles).
// Positions are stored as fractions of the free screen space, so they survive window resizes.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronsLeft, CornerDownLeft, GripHorizontal, LayoutGrid, PanelLeft, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { Monogram, moduleFor } from './icons.jsx';

const M = 12; // gap kept from the screen edges
const SNAP = 36; // released this close to an edge, the button settles onto it
const PANEL_W = { labels: 252, icons: 76 };
const BUTTON = { desktop: 52, phone: 48 };
const KEY = { pos: 'hrms.fab.pos', mode: 'hrms.fab.mode', hinted: 'hrms.fab.hinted', expanded: 'hrms.fnav.expanded', quick: 'hrms.quick.pos' };

// Quick Access tiles: the first six of these the user may open.
const TILE_ORDER = ['/', '/my', '/employees', '/attendance', '/payroll', '/reports', '/settings', '/leave', '/documents', '/calendar', '/hiring', '/performance', '/posh', '/resignation', '/screener'];
// Extra words the module search understands.
const KEYWORDS = {
  '/': 'home overview kpi', '/my': 'home profile payslips requests', '/hiring': 'jobs candidates recruitment pipeline interviews offers',
  '/screener': 'resume cv ai screening', '/employees': 'people staff directory team profiles', '/documents': 'files letters uploads',
  '/leave': 'time off wfh policy policies', '/calendar': 'holidays festivals public', '/payroll': 'salary payslip pay ctc',
  '/performance': 'reviews goals appraisal ratings', '/attendance': 'clock check in timesheet hours location office',
  '/posh': 'complaint harassment committee', '/resignation': 'exit notice offboarding', '/reports': 'analytics export',
  '/settings': 'configuration admin users offices',
};

const load = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked (private windows); positions then last for this visit only.
  }
};
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const screen = () => ({ w: window.innerWidth, h: window.innerHeight });
const clampPos = (x, y, w, h) => { const s = screen(); return { x: clamp(x, M, s.w - w - M), y: clamp(y, M, s.h - h - M) }; };
const toPx = (f, w, h) => { const s = screen(); return { x: M + f.fx * Math.max(0, s.w - w - 2 * M), y: M + f.fy * Math.max(0, s.h - h - 2 * M) }; };
const toFrac = (p, w, h) => { const s = screen(); return { fx: clamp((p.x - M) / Math.max(1, s.w - w - 2 * M), 0, 1), fy: clamp((p.y - M) / Math.max(1, s.h - h - 2 * M), 0, 1) }; };
// Beside the button if it fits, otherwise below or above it (phones); always fully on screen.
function besideButton(anchor, w, h) {
  const s = screen();
  const cx = anchor.x + anchor.size / 2;
  const cy = anchor.y + anchor.size / 2;
  const sides = [{ x: anchor.x + anchor.size + 12, y: cy - h / 2 }, { x: anchor.x - 12 - w, y: cy - h / 2 }];
  const ends = [{ x: cx - w / 2, y: anchor.y + anchor.size + 12 }, { x: cx - w / 2, y: anchor.y - 12 - h }];
  if (cx > s.w / 2) sides.reverse();
  if (cy > s.h / 2) ends.reverse();
  const pick = sides.find((t) => t.x >= M && t.x + w <= s.w - M) || ends.find((t) => t.y >= M && t.y + h <= s.h - M) || ends[0];
  return clampPos(pick.x, pick.y, w, h);
}
const isActive = (to, path) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

function useScreen() {
  const [s, setS] = useState(screen);
  useEffect(() => {
    const on = () => setS(screen());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

// Drag with mouse, touch or pen. Moves go straight to the element (no re-render per move); a press
// that travels less than a few pixels stays a click, and `dragged` lets the click handler ignore
// the click a browser fires at the end of a drag.
function usePointerDrag({ from, move, drop }) {
  const s = useRef(null);
  const dragged = useRef(false);
  const end = (e) => {
    const st = s.current;
    if (!st || st.id !== e.pointerId) return;
    s.current = null;
    if (st.moved) {
      dragged.current = true;
      drop();
    }
  };
  const handlers = {
    onPointerDown: (e) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('[data-nodrag]')) return;
      dragged.current = false;
      s.current = { id: e.pointerId, x: e.clientX, y: e.clientY, start: from(), moved: false };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const st = s.current;
      if (!st || st.id !== e.pointerId) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      if (!st.moved) {
        if (Math.hypot(dx, dy) < (e.pointerType === 'mouse' ? 4 : 8)) return;
        st.moved = true;
      }
      move(st.start.x + dx, st.start.y + dy);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
  return { handlers, dragged };
}

// Fires `done` once the closing animation ends, or shortly after if no animation runs.
function useLeave(leaving, done, ms) {
  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(done, ms);
    return () => clearTimeout(t);
  }, [leaving, done, ms]);
}

export default function FloatingNav({ items, docked, onDock, onUndock, brand }) {
  const view = useScreen();
  const size = view.w <= 760 ? BUTTON.phone : BUTTON.desktop;
  const frac = useRef(load(KEY.pos, { fx: 1, fy: 0.62 }));
  const [pos, setPos] = useState(() => toPx(frac.current, size, size));
  const live = useRef(pos);
  const wrap = useRef(null);
  const btn = useRef(null);
  const dragging = useRef(false);
  const [moving, setMoving] = useState(false);
  const [settling, setSettling] = useState(false);
  const [panel, setPanel] = useState(null); // 'sidebar' | 'quick'
  const [leaving, setLeaving] = useState(false);
  const [expanded, setExpanded] = useState(() => load(KEY.expanded, false));
  const [hint, setHint] = useState(() => !load(KEY.hinted, false));
  const [pulse, setPulse] = useState(false);

  // Same relative place after a resize, always fully on screen.
  useEffect(() => {
    const p = toPx(frac.current, size, size);
    live.current = p;
    setPos(p);
  }, [view.w, view.h, size]);

  const dismissHint = useCallback(() => {
    setHint(false);
    save(KEY.hinted, true);
  }, []);
  useEffect(() => {
    if (!hint) return undefined;
    const t = setTimeout(dismissHint, 9000);
    return () => clearTimeout(t);
  }, [hint, dismissHint]);

  // Hiding the docked sidebar: the button pulses so people see where navigation went.
  const wasDocked = useRef(docked);
  useEffect(() => {
    const hid = wasDocked.current && !docked;
    wasDocked.current = docked;
    if (!hid) return undefined;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 2600);
    return () => clearTimeout(t);
  }, [docked]);

  useEffect(() => {
    if (!settling) return undefined;
    const t = setTimeout(() => setSettling(false), 280);
    return () => clearTimeout(t);
  }, [settling]);

  const settle = (p) => {
    live.current = p;
    frac.current = toFrac(p, size, size);
    save(KEY.pos, frac.current);
    setSettling(true);
    setPos(p);
  };
  const snap = ({ x, y }) => {
    const s = screen();
    const right = s.w - size - M;
    const bottom = s.h - size - M;
    return {
      x: x - M < SNAP ? M : right - x < SNAP ? right : x,
      y: y - M < SNAP ? M : bottom - y < SNAP ? bottom : y,
    };
  };

  const drag = usePointerDrag({
    from: () => live.current,
    move: (x, y) => {
      const p = clampPos(x, y, size, size);
      live.current = p;
      wrap.current.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      if (!dragging.current) {
        dragging.current = true;
        setMoving(true);
        if (hint) dismissHint();
      }
    },
    drop: () => {
      dragging.current = false;
      setMoving(false);
      settle(snap(live.current));
    },
  });

  const open = (mode) => {
    setLeaving(false);
    setPanel(mode);
    save(KEY.mode, mode);
  };
  const close = useCallback(() => setLeaving(true), []);
  const closed = useCallback(() => {
    setPanel(null);
    setLeaving(false);
  }, []);
  const closeAndFocus = useCallback(() => {
    close();
    btn.current?.focus({ preventScroll: true });
  }, [close]);

  const onClick = () => {
    if (drag.dragged.current) {
      drag.dragged.current = false;
      return;
    }
    if (hint) dismissHint();
    if (panel && !leaving) close();
    else open(load(KEY.mode, docked ? 'quick' : 'sidebar'));
  };
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    settle(clampPos(live.current.x + d[0], live.current.y + d[1], size, size));
  };

  const anchor = { x: pos.x, y: pos.y, size };
  const toggleExpanded = () => setExpanded((v) => {
    save(KEY.expanded, !v);
    return !v;
  });
  return (
    <>
      {panel === 'sidebar' && (
        <FloatingSidebar
          items={items} anchor={anchor} expanded={expanded} onExpand={toggleExpanded} leaving={leaving}
          onClose={closeAndFocus} onNavigate={close} onClosed={closed} onQuick={() => open('quick')}
          docked={docked} onDock={() => { onDock(); close(); }} onUndock={onUndock} brand={brand}
        />
      )}
      {panel === 'quick' && (
        <QuickAccess items={items} anchor={anchor} leaving={leaving} onClose={closeAndFocus} onClosed={closed} onSidebar={() => open('sidebar')} />
      )}
      <div
        ref={wrap} className={`fab no-print ${moving ? 'dragging' : ''} ${settling ? 'settling' : ''} ${pulse ? 'pulse' : ''}`}
        style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`, '--fab': `${size}px` }}
      >
        <button
          ref={btn} type="button" className="fab-btn" aria-label="BrainADZ navigation" aria-haspopup="dialog" aria-expanded={Boolean(panel) && !leaving}
          aria-describedby="fab-help" onClick={onClick} onKeyDown={onKeyDown} {...drag.handlers}
        >
          <Monogram height={Math.round(size * 0.42)} color="#fff" label={null} />
        </button>
        {hint && !panel && <div className={`fab-hint ${pos.x + size / 2 > view.w / 2 ? 'left' : 'right'}`} aria-hidden="true">Drag me anywhere · tap to open</div>}
        <span id="fab-help" className="sr-only">Opens the menu or Quick Access. Drag it, or use the arrow keys, to move it.</span>
      </div>
    </>
  );
}

function FloatingSidebar({ items, anchor, expanded, onExpand, leaving, onClose, onNavigate, onClosed, onQuick, docked, onDock, onUndock, brand }) {
  const view = useScreen();
  const ref = useRef(null);
  const [top, setTop] = useState(M);
  const [tip, setTip] = useState(null);
  // Opens towards the side of the screen with more room; that edge stays put when it widens.
  const side = anchor.x + anchor.size / 2 < view.w / 2 ? 'right' : 'left';
  const width = expanded ? PANEL_W.labels : PANEL_W.icons;
  const place = side === 'right'
    ? { left: clamp(anchor.x + anchor.size + 12, M, view.w - width - M) }
    : { right: clamp(view.w - anchor.x + 12, M, view.w - width - M) };
  useLayoutEffect(() => {
    const h = ref.current.offsetHeight;
    setTop(clamp(anchor.y + anchor.size / 2 - h / 2, M, view.h - h - M));
  }, [anchor.y, anchor.size, view.h]);
  useEffect(() => { ref.current.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  useLeave(leaving, onClosed, 300);
  useEffect(() => setTip(null), [expanded]);

  const showTip = (label) => (e) => {
    if (expanded) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, y: r.top + r.height / 2, x: side === 'right' ? r.right + 12 : r.left - 12 });
  };
  const hideTip = () => setTip(null);
  const tipProps = (label) => ({ onMouseEnter: showTip(label), onMouseLeave: hideTip, onFocus: showTip(label), onBlur: hideTip });
  const origin = `${side === 'right' ? '0' : '100%'} ${Math.round(anchor.y + anchor.size / 2 - top)}px`;
  return (
    <>
      <div className={`fnav-scrim no-print ${leaving ? 'out' : ''}`} onClick={onClose} />
      <aside
        ref={ref} tabIndex={-1} role="dialog" aria-label="Navigation"
        className={`fnav no-print side-${side} ${expanded ? 'expanded' : ''} ${leaving ? 'leaving' : ''}`}
        style={{ ...place, top, width, transformOrigin: origin }}
        onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onClosed(); }}
      >
        <div className="fnav-head">
          <span className="fnav-brand">{brand}<Monogram className="mono" height={30} label={null} /></span>
        </div>
        <button type="button" className="fnav-toggle" onClick={onExpand} aria-expanded={expanded} aria-label={expanded ? 'Show icons only' : 'Show labels'} title={expanded ? 'Show icons only' : 'Show labels'}>
          <ChevronsLeft size={15} />
        </button>
        <nav className="fnav-list" aria-label="Main" onScroll={hideTip}>
          {items.map((n) => {
            const m = moduleFor(n.to);
            return (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={onNavigate} style={{ '--accent': m.color, '--accent-soft': m.soft, '--accent-ink': m.ink }} {...tipProps(n.label)}>
                <n.icon size={22} /><span className="lbl">{n.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="fnav-foot">
          <button type="button" onClick={onQuick} {...tipProps('Quick Access')}><LayoutGrid size={18} /><span className="lbl">Quick Access</span></button>
          <button type="button" className="dock" onClick={docked ? onUndock : onDock} {...tipProps(docked ? 'Hide docked sidebar' : 'Dock sidebar')}>
            {docked ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}<span className="lbl">{docked ? 'Hide docked sidebar' : 'Dock sidebar'}</span>
          </button>
        </div>
      </aside>
      {tip && <div className={`fnav-tip no-print ${side === 'left' ? 'flip' : ''}`} style={{ left: tip.x, top: tip.y }} aria-hidden="true">{tip.label}</div>}
    </>
  );
}

function QuickAccess({ items, anchor, leaving, onClose, onClosed, onSidebar }) {
  const view = useScreen();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const wrap = useRef(null);
  const input = useRef(null);
  const frac = useRef(load(KEY.quick, null));
  const live = useRef(null);
  const dragging = useRef(false);
  const [moving, setMoving] = useState(false);
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const tiles = useMemo(() => {
    const allowed = new Map(items.map((n) => [n.to, n]));
    return TILE_ORDER.filter((p) => allowed.has(p)).slice(0, 6).map((p) => allowed.get(p));
  }, [items]);
  const results = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return items.filter((n) => { const text = `${n.label} ${KEYWORDS[n.to] || ''}`.toLowerCase(); return words.every((w) => text.includes(w)); });
  }, [q, items]);
  useEffect(() => setSel(0), [q]);

  // Where it was last left, or else beside the button; re-checked when the window changes size.
  useLayoutEffect(() => {
    const el = wrap.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const p = frac.current ? toPx(frac.current, w, h) : besideButton(anchor, w, h);
    live.current = p;
    setPos(p);
  }, [view.w, view.h]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ready to type on computers once the card is placed (a hidden element cannot take focus);
  // phones skip this so the keyboard does not pop up.
  const placed = pos !== null;
  useEffect(() => {
    if (placed && window.matchMedia?.('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, [placed]);
  useLeave(leaving, onClosed, 280);

  const drag = usePointerDrag({
    from: () => live.current,
    move: (x, y) => {
      const el = wrap.current;
      const p = clampPos(x, y, el.offsetWidth, el.offsetHeight);
      live.current = p;
      el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      if (!dragging.current) {
        dragging.current = true;
        setMoving(true);
      }
    },
    drop: () => {
      dragging.current = false;
      setMoving(false);
      frac.current = toFrac(live.current, wrap.current.offsetWidth, wrap.current.offsetHeight);
      save(KEY.quick, frac.current);
      setPos(live.current);
    },
  });

  // Opening a module keeps the card open on larger screens so it can be used again.
  const opened = () => {
    setQ('');
    if (view.w <= 760) onClose();
  };
  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[sel]) { navigate(results[sel].to); opened(); }
  };
  const theme = (to) => { const m = moduleFor(to); return { '--accent': m.color, '--accent-soft': m.soft, '--accent-ink': m.ink }; };
  return (
    <div
      ref={wrap} className={`qa no-print ${moving ? 'dragging' : ''}`}
      style={{ transform: pos ? `translate3d(${pos.x}px, ${pos.y}px, 0)` : undefined, visibility: pos ? undefined : 'hidden' }}
    >
      <section
        className={`qa-card ${leaving ? 'leaving' : ''}`} role="dialog" aria-label="Quick Access"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onClosed(); }}
      >
        <header className="qa-head" title="Drag to move" {...drag.handlers}>
          <GripHorizontal size={16} className="qa-grip" aria-hidden="true" />
          <Monogram height={17} label={null} />
          <h3>Quick Access</h3>
          <button type="button" data-nodrag className="qa-icon" onClick={onClose} aria-label="Close Quick Access"><X size={17} /></button>
        </header>
        <label className="qa-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder="Search modules…" aria-label="Search modules"
            role="combobox" aria-expanded={results.length > 0} aria-controls="qa-results" aria-activedescendant={results[sel] ? `qa-r-${sel}` : undefined}
          />
          {q && <button type="button" className="qa-clear" onClick={() => { setQ(''); input.current?.focus(); }} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <div className="qa-body">
          {q.trim() ? (
            results.length ? (
              <ul className="qa-results" id="qa-results" role="listbox" aria-label="Matching modules">
                {results.map((n, i) => (
                  <li key={n.to} id={`qa-r-${i}`} role="option" aria-selected={i === sel}>
                    <Link to={n.to} className={i === sel ? 'sel' : ''} style={theme(n.to)} onClick={opened} onMouseEnter={() => setSel(i)} tabIndex={-1}>
                      <span className="ico"><n.icon size={20} /></span>{n.label}
                      {i === sel && <CornerDownLeft size={14} className="enter" aria-hidden="true" />}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <div className="qa-empty">No module matches “{q.trim()}”</div>
          ) : (
            <div className="qa-grid">
              {tiles.map((n, i) => {
                const on = isActive(n.to, pathname);
                return (
                  <Link key={n.to} to={n.to} className={`qa-tile ${on ? 'on' : ''}`} style={{ ...theme(n.to), '--i': i }} onClick={opened} aria-current={on ? 'page' : undefined}>
                    <span className="qa-ico"><n.icon size={26} /></span>
                    <span className="qa-name">{n.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <button type="button" className="qa-foot" onClick={onSidebar}><PanelLeft size={16} />Open full navigation</button>
      </section>
    </div>
  );
}
