// Floating navigation, as in BrainADZ Projects: with the side menu hidden, a draggable Br button
// opens either a floating side menu or the Quick Access card.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronsRight,
  GripHorizontal,
  LayoutGrid,
  Menu as MenuIcon,
  PanelLeft,
  Search,
  X,
} from 'lucide-react';
import { Monogram, moduleFor } from './icons.jsx';
import { useScrollEdges } from '../lib/hooks.js';

const MARGIN = 12; // never closer than this to the edge of the screen
const GAP = 12; // between the button and what it opens
// Length of the panels' closing animation.
const CLOSE_MS = 220;
// localStorage keys: the button's spot, which panel it opens and the menu width.
const KEY = { spot: 'hrms.float.spot', mode: 'hrms.float.mode', wide: 'hrms.float.wide' };

// Extra words the Quick Access search understands.
const KEYWORDS = {
  '/': 'home overview summary kpi',
  '/my': 'home profile payslips requests',
  '/hiring': 'jobs candidates recruitment pipeline interviews offers',
  '/screener': 'resume cv ai screening',
  '/employees': 'people staff directory team profiles',
  '/documents': 'files letters uploads',
  '/leave': 'time off wfh policy policies',
  '/calendar': 'holidays festivals public',
  '/payroll': 'salary payslip pay ctc',
  '/performance': 'reviews goals appraisal ratings',
  '/training': 'courses learning workshop certificate induction posh',
  '/attendance': 'clock check in timesheet hours location office',
  '/posh': 'complaint harassment committee',
  '/resignation': 'exit notice offboarding',
  '/reports': 'analytics export',
  '/settings': 'configuration admin users offices',
};

// Read and write JSON preferences in localStorage.
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
    // Storage can be blocked (private windows); the choice then lasts for this visit.
  }
};
const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
// Limits v to lo..hi; lo wins when the range is empty (a box wider than the screen).
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
// Moves a w x h box at p back inside the screen margins.
const keepOnScreen = (p, w, h) => {
  const vp = viewport();
  return {
    ...p,
    x: clamp(p.x, MARGIN, vp.w - w - MARGIN),
    y: clamp(p.y, MARGIN, vp.h - h - MARGIN),
  };
};
// Whether nav item `n` is the current page or one of its sub-pages.
const isActivePath = (n, path) =>
  n.end ? path === n.to : path === n.to || path.startsWith(`${n.to}/`);
// Whether the key press is going into a text field, so shortcuts stay out of the way.
const typing = (t) => t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

// State that is saved to localStorage and restored on the next visit.
function usePref(key, fallback) {
  const [value, setValue] = useState(() => load(key, fallback));
  const set = useCallback(
    (v) => {
      setValue(v);
      save(key, v);
    },
    [key],
  );
  return [value, set];
}

// Whether a CSS media query matches, kept up to date.
function useMedia(query) {
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const fn = () => setOn(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return on;
}

// Mouse, touch or pen drag that moves the element directly each frame and reports only the end.
// Under 5px of movement is a tap, so a click never moves anything and a drag never clicks.
function useDrag({ elRef, getPos, getSize, onStart, onEnd, ignore }) {
  const s = useRef(null);
  const frame = useRef(0);
  // Applies the latest position; scheduled at most once per animation frame.
  const paint = () => {
    frame.current = 0;
    const d = s.current;
    if (d?.next && elRef.current)
      elRef.current.style.transform = `translate3d(${d.next.x}px, ${d.next.y}px, 0)`;
  };
  // Remember where the pointer and the element started (left mouse button only).
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (ignore?.(e)) return;
    const p = getPos();
    s.current = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      x: p.x,
      y: p.y,
      moved: false,
      next: null,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  // Starts the drag once past 5px, then follows the pointer within the screen.
  const onPointerMove = (e) => {
    const d = s.current;
    if (!d || d.id !== e.pointerId || d.done) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) {
      d.moved = true;
      elRef.current?.classList.add('dragging');
      document.body.classList.add('fnav-dragging');
      onStart?.();
    }
    const { w, h } = getSize();
    d.next = keepOnScreen({ x: d.x + dx, y: d.y + dy }, w, h);
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };
  // Pointer released or lost: a tap just resets; a drag paints its last spot and reports it.
  const finish = (e) => {
    const d = s.current;
    if (!d || d.id !== e.pointerId || d.done) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d.moved) {
      s.current = null;
      return;
    }
    cancelAnimationFrame(frame.current);
    paint();
    elRef.current?.classList.remove('dragging');
    document.body.classList.remove('fnav-dragging');
    if (d.next) onEnd?.(d.next);
    // The click that follows a drag must not open anything.
    s.current = { done: true };
    setTimeout(() => {
      if (s.current?.done) s.current = null;
    }, 400);
  };
  // Clean up if unmounted mid-drag.
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      document.body.classList.remove('fnav-dragging');
    },
    [],
  );
  // True once right after a drag, so the click handler can ignore that click.
  const justDragged = () => {
    const was = Boolean(s.current?.done);
    if (was) s.current = null;
    return was;
  };
  return {
    justDragged,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
  };
}

// Animated open/close: stays mounted while it plays its closing animation.
function usePanel() {
  const [panel, setPanel] = useState(null); // 'menu' | 'quick' | null
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);
  const open = useCallback((which) => {
    clearTimeout(timer.current);
    setClosing(false);
    setPanel(which);
  }, []);
  const close = useCallback(() => {
    if (!panel) return;
    setClosing(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPanel(null);
      setClosing(false);
    }, CLOSE_MS);
  }, [panel]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { panel, closing, open, close };
}

// The draggable Br button plus the floating menu or Quick Access panel it opens.
export default function FloatingNav({ items, onDock, focusOnMount }) {
  const { pathname: path } = useLocation();
  const navigate = useNavigate();
  const small = useMedia('(max-width: 760px)');
  const size = small ? 48 : 52;

  // The button stays exactly where it is dropped, and there again next time. Its centre is
  // saved as a share of the window, so it keeps its place if the window changes size.
  const [saved, setSaved] = usePref(KEY.spot, null); // { cx, cy } as fractions of the window
  const fromSaved = useCallback(
    (spot) => {
      const vp = viewport();
      const c = spot || { cx: 1 - (MARGIN + size / 2) / vp.w, cy: 1 - (110 + size / 2) / vp.h }; // first time: lower right
      return keepOnScreen({ x: c.cx * vp.w - size / 2, y: c.cy * vp.h - size / 2 }, size, size);
    },
    [size],
  );
  const [pos, setPosState] = useState(() => fromSaved(saved));
  // Refs give the drag and resize handlers the latest position without re-binding.
  const posRef = useRef(pos);
  const spotRef = useRef(saved);
  const setPos = useCallback((p) => {
    posRef.current = p;
    setPosState(p);
  }, []);
  // Moves the button and saves its new spot.
  const moveTo = (p) => {
    setPos(p);
    const spot = {
      cx: (p.x + size / 2) / window.innerWidth,
      cy: (p.y + size / 2) / window.innerHeight,
    };
    spotRef.current = spot;
    setSaved(spot);
  };
  const floatRef = useRef(null);
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const btnDrag = useDrag({
    elRef: floatRef,
    getPos: () => posRef.current,
    getSize: () => ({ w: size, h: size }),
    onStart: () => panelRef.current === 'menu' && closeRef.current(), // the menu is pinned to the button
    onEnd: moveTo,
  });
  // Keep its place (and stay on screen) when the window changes size.
  useEffect(() => {
    const onResize = () => setPos(fromSaved(spotRef.current));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fromSaved, setPos]);

  // What the button opens: the floating menu or Quick Access (it remembers which).
  const [mode, setMode] = usePref(KEY.mode, 'menu');
  const [wide, setWide] = usePref(KEY.wide, true);
  const { panel, closing, open, close } = usePanel();
  // Shared through refs with the drag handler above, which is set up before this state exists.
  panelRef.current = closing ? null : panel;
  closeRef.current = close;
  const btnRef = useRef(null);
  const rootRef = useRef(null);
  const toggle = useCallback(
    () => (panel && !closing ? close() : open(mode)),
    [panel, closing, close, open, mode],
  );
  // Switching panels also makes that panel the button's default.
  const show = (which) => {
    setMode(which);
    open(which);
  };
  const go = (to) => {
    close();
    navigate(to);
  };

  // Escape or a click elsewhere closes it; "[" opens and closes it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && panel && !closing) {
        close();
        btnRef.current?.focus();
        return;
      }
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      toggle();
    };
    const onDown = (e) => {
      if (panel && !closing && !rootRef.current?.contains(e.target)) close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [panel, closing, close, toggle]);

  // Take focus once when asked, e.g. right after the side menu was hidden.
  useEffect(() => {
    if (!focusOnMount?.current) return;
    focusOnMount.current = false;
    btnRef.current?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow keys move it too, for people using a keyboard.
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 64 : 16;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!d) return;
    e.preventDefault();
    if (panel === 'menu' && !closing) close();
    moveTo(keepOnScreen({ x: posRef.current.x + d[0], y: posRef.current.y + d[1] }, size, size));
  };

  // Panels open toward the middle of the screen, away from the nearer edge.
  const onRight = pos.x + size / 2 > window.innerWidth / 2;
  const anchor = { ...pos, size, onRight };
  return (
    <div ref={rootRef} className="fnav-root no-print">
      {/* The draggable Br button */}
      <div
        ref={floatRef}
        className="fnav-float"
        style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
      >
        <button
          ref={btnRef}
          type="button"
          className={`fnav-btn ${panel && !closing ? 'open' : ''}`}
          style={{ width: size, height: size }}
          {...btnDrag.handlers}
          onClick={() => !btnDrag.justDragged() && toggle()}
          onKeyDown={onKeyDown}
          aria-haspopup="dialog"
          aria-expanded={Boolean(panel) && !closing}
          aria-label="BrainADZ menu. Drag to move it anywhere."
          title="Open the menu · drag to move"
        >
          <Monogram height={Math.round(size * 0.46)} color="#fff" label={null} />
        </button>
      </div>
      {/* Floating side menu */}
      {panel === 'menu' && (
        <FloatMenu
          anchor={anchor}
          items={items}
          path={path}
          wide={wide}
          setWide={setWide}
          closing={closing}
          onPicked={close}
          onQuick={() => show('quick')}
          onDock={onDock}
        />
      )}
      {/* Quick Access card */}
      {panel === 'quick' && (
        <QuickAccess
          anchor={anchor}
          items={items}
          path={path}
          closing={closing}
          onGo={go}
          onMenu={() => show('menu')}
          onDock={onDock}
          onClose={close}
        />
      )}
    </div>
  );
}

// Floating side menu, opened beside the button on whichever side has room.
function FloatMenu({ anchor, items, path, wide, setWide, closing, onPicked, onQuick, onDock }) {
  const ref = useRef(null);
  const [top, setTop] = useState(anchor.y);
  const [tip, setTip] = useState(null); // { label, x, y, side }
  const vw = window.innerWidth;
  const width = wide ? (vw <= 760 ? 240 : 252) : 72; // as in the stylesheet; keeps the whole menu on screen
  const side = anchor.onRight
    ? { right: clamp(vw - anchor.x + GAP, MARGIN, vw - MARGIN - width) }
    : { left: clamp(anchor.x + anchor.size + GAP, MARGIN, vw - MARGIN - width) };

  // Line the top up with the button, keeping the whole menu on screen.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight || 0;
    setTop(clamp(anchor.y - 8, MARGIN, window.innerHeight - h - MARGIN));
  }, [anchor.y, wide, items.length]);
  // Focus the current page's item (or the first one) when it opens.
  useEffect(() => {
    ref.current?.querySelector('.fnav-item.active, .fnav-item')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => setTip(null), [wide]);
  const scroll = useScrollEdges();

  // Name tooltips only in icon-only mode, on the side away from the button.
  const showTip = (e, label) => {
    if (wide) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip(
      anchor.onRight
        ? { label, x: r.left - 10, y: r.top + r.height / 2, side: 'left' }
        : { label, x: r.right + 10, y: r.top + r.height / 2, side: 'right' },
    );
  };
  // Hover and keyboard-focus handlers that show an item's name; it also becomes the aria-label.
  const tipProps = (label) => ({
    onMouseEnter: (e) => showTip(e, label),
    onMouseLeave: () => setTip(null),
    onFocus: (e) => e.currentTarget.matches(':focus-visible') && showTip(e, label),
    onBlur: () => setTip(null),
    'aria-label': wide ? undefined : label,
  });

  return (
    <>
      <div
        ref={ref}
        role="dialog"
        aria-label="Menu"
        style={{ ...side, top }}
        className={`fnav-panel fnav-menu ${wide ? 'wide' : ''} ${closing ? 'closing' : ''} ${anchor.onRight ? 'from-right' : 'from-left'}`}
      >
        {/* Logo and the icons-only / names switch */}
        <div className="fnav-head">
          <Monogram height={28} />
          <span className="fnav-word">
            <b>BrainADZ</b>
            <b>HRMS</b>
          </span>
          <button
            type="button"
            className="fnav-expand"
            onClick={() => setWide(!wide)}
            aria-label={wide ? 'Show icons only' : 'Show names'}
            title={wide ? 'Show icons only' : 'Show names'}
          >
            <ChevronsRight size={14} strokeWidth={2.4} />
          </button>
        </div>
        {/* Module links; scrolling hides the tooltip */}
        <nav
          className={`fnav-items ${scroll.edges}`}
          aria-label="Main"
          ref={scroll.ref}
          onScroll={() => {
            setTip(null);
            scroll.onScroll();
          }}
        >
          {items.map((n) => {
            const active = isActivePath(n, path);
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={`fnav-item ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={onPicked}
                {...tipProps(n.label)}
              >
                <n.icon size={24} />
                <span className="lbl">{n.label}</span>
              </NavLink>
            );
          })}
        </nav>
        {/* Switch to Quick Access or back to the docked side menu */}
        <div className="fnav-foot">
          <button
            type="button"
            className="fnav-item"
            onClick={onQuick}
            {...tipProps('Quick Access')}
          >
            <span className="fnav-act-ic">
              <LayoutGrid size={17} />
            </span>
            <span className="lbl">Quick Access</span>
          </button>
          <button
            type="button"
            className="fnav-item"
            onClick={onDock}
            {...tipProps('Show the side menu')}
          >
            <span className="fnav-act-ic">
              <PanelLeft size={17} />
            </span>
            <span className="lbl">Show the side menu</span>
          </button>
        </div>
      </div>
      {/* Name tooltip, drawn outside the menu so its scrolling can't clip it */}
      {tip && !closing && (
        <div className={`fnav-tip ${tip.side}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.label}
        </div>
      )}
    </>
  );
}

// Page search: a word of the label or its keywords starts with the query, or the label has it.
const matches = (n, q) => {
  const t = q.trim().toLowerCase();
  return (
    !t ||
    `${n.label} ${KEYWORDS[n.to] || ''}`
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.startsWith(t)) ||
    n.label.toLowerCase().includes(t)
  );
};

// Quick Access: a small card of shortcuts with a search, dragged around by its header.
function QuickAccess({ anchor, items, path, closing, onGo, onMenu, onDock, onClose }) {
  const cardRef = useRef(null);
  const touch = useMedia('(hover: none)');
  const [q, setQ] = useState('');
  const width = Math.min(344, window.innerWidth - MARGIN * 2);
  // Opens beside the button, on the side toward the middle of the screen.
  const start = () => {
    const x = anchor.onRight ? anchor.x - GAP - width : anchor.x + anchor.size + GAP;
    return keepOnScreen({ x, y: anchor.y - 24 }, width, 420);
  };
  const [pos, setPosState] = useState(start);
  const posRef = useRef(pos);
  const setPos = useCallback((p) => {
    posRef.current = p;
    setPosState(p);
  }, []);
  // The card's rendered size, estimated until it has been drawn.
  const size = () => ({
    w: cardRef.current?.offsetWidth || width,
    h: cardRef.current?.offsetHeight || 420,
  });
  const moverRef = useRef(null);
  // Dragged by its header; the buttons and search box in it still work normally.
  const drag = useDrag({
    elRef: moverRef,
    getPos: () => posRef.current,
    getSize: size,
    onEnd: setPos,
    ignore: (e) => Boolean(e.target.closest('button, input')),
  });
  // Once its real height is known, make sure all of it is on screen.
  useLayoutEffect(() => {
    const { w, h } = size();
    setPos(keepOnScreen(posRef.current, w, h));
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stay on screen when the window changes size.
  useEffect(() => {
    const onResize = () => {
      const { w, h } = size();
      setPos(keepOnScreen(posRef.current, w, h));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = items.filter((n) => matches(n, q));
  return (
    <div
      ref={moverRef}
      className="fnav-quick-pos"
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-label="Quick Access"
        style={{ width }}
        className={`fnav-panel fnav-quick ${closing ? 'closing' : ''} ${anchor.onRight ? 'from-right' : 'from-left'}`}
      >
        {/* Header: drag handle, logo and close */}
        <div className="fq-head" {...drag.handlers} title="Drag to move">
          <GripHorizontal size={16} className="fq-grip" aria-hidden="true" />
          <Monogram height={21} />
          <b>Quick Access</b>
          <button type="button" className="fq-x" onClick={onClose} aria-label="Close Quick Access">
            <X size={17} />
          </button>
        </div>
        {/* Page search; Enter opens the first match (no autofocus on touch screens) */}
        <div className="fq-search">
          <Search size={16} aria-hidden="true" />
          <input
            autoFocus={!touch}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, e.g. payroll, leave, payslips"
            aria-label="Search pages"
            onKeyDown={(e) => e.key === 'Enter' && shown[0] && onGo(shown[0].to)}
          />
        </div>
        {/* Shortcut tiles */}
        {shown.length ? (
          <div className="fq-grid">
            {shown.map((n) => (
              <button
                key={n.to}
                type="button"
                className={`fq-tile ${isActivePath(n, path) ? 'active' : ''}`}
                onClick={() => onGo(n.to)}
              >
                <span className="fq-ic" style={{ '--tint': moduleFor(n.to).soft }}>
                  <n.icon size={28} />
                </span>
                <span className="fq-lbl">{n.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="fq-none small muted">
            No page matches “{q}”. To find a person, job or policy, use the search at the top.
          </div>
        )}
        {/* Switch to the full menu or back to the docked side menu */}
        <div className="fq-foot">
          <button type="button" className="fq-link" onClick={onMenu}>
            <MenuIcon size={15} />
            Full menu
          </button>
          <button type="button" className="fq-link" onClick={onDock}>
            <PanelLeft size={15} />
            Show the side menu
          </button>
        </div>
      </div>
    </div>
  );
}
