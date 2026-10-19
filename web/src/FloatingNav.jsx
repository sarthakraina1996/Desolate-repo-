// Floating navigation: a draggable Br button that opens either a floating side menu or the
// Quick Access card. Used when someone hides the side menu to get more room for their work.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronsRight, LayoutGrid, PanelLeft, X, Search, GripHorizontal, Menu as MenuIcon } from 'lucide-react';
import { Link, useRouter } from './router.jsx';
import { usePref } from './store.jsx';
import { Monogram } from './monogram.jsx';
import { useNavItems, isActivePath, navCount, CountBadge, freshTotal } from './nav.jsx';

const MARGIN = 12; // never closer than this to the edge of the screen
const GAP = 12; // between the button and what it opens
const CLOSE_MS = 220;

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const keepOnScreen = (p, w, h) => {
  const vp = viewport();
  return { ...p, x: clamp(p.x, MARGIN, vp.w - w - MARGIN), y: clamp(p.y, MARGIN, vp.h - h - MARGIN) };
};

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

// Drag with mouse, touch or pen. While dragging, the element follows the pointer once per
// frame by moving it directly (no re-rendering), so it stays smooth; React only hears about
// the final position. Under 5px of movement counts as a tap, so a click never moves
// anything and a drag never clicks.
function useDrag({ elRef, getPos, getSize, onStart, onEnd, ignore }) {
  const s = useRef(null);
  const frame = useRef(0);
  const paint = () => {
    frame.current = 0;
    const d = s.current;
    if (d?.next && elRef.current) elRef.current.style.transform = `translate3d(${d.next.x}px, ${d.next.y}px, 0)`;
  };
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (ignore?.(e)) return;
    const p = getPos();
    s.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: p.x, y: p.y, moved: false, next: null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
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
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    document.body.classList.remove('fnav-dragging');
  }, []);
  const justDragged = () => {
    const was = !!s.current?.done;
    if (was) s.current = null;
    return was;
  };
  return { justDragged, handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish } };
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

export function FloatingNav({ counts, onDock, focusOnMount }) {
  const items = useNavItems();
  const { path, navigate } = useRouter();
  const small = useMedia('(max-width: 760px)');
  const size = small ? 48 : 52;

  // The button stays exactly where it is dropped, and there again next time. Its centre is
  // saved as a share of the window, so it keeps its place if the window changes size.
  const [saved, setSaved] = usePref('bpm.floatSpot', null); // { cx, cy } as fractions of the window
  const fromSaved = useCallback((spot) => {
    const vp = viewport();
    const c = spot || { cx: 1 - (MARGIN + size / 2) / vp.w, cy: 1 - (110 + size / 2) / vp.h }; // first time: lower right
    return keepOnScreen({ x: c.cx * vp.w - size / 2, y: c.cy * vp.h - size / 2 }, size, size);
  }, [size]);
  const [pos, setPosState] = useState(() => fromSaved(saved));
  const posRef = useRef(pos);
  const spotRef = useRef(saved);
  const setPos = useCallback((p) => {
    posRef.current = p;
    setPosState(p);
  }, []);
  const floatRef = useRef(null);
  const btnDrag = useDrag({
    elRef: floatRef,
    getPos: () => posRef.current,
    getSize: () => ({ w: size, h: size }),
    onStart: () => panelRef.current === 'menu' && closeRef.current(), // the menu is pinned to the button
    onEnd: (p) => {
      setPos(p);
      const spot = { cx: (p.x + size / 2) / window.innerWidth, cy: (p.y + size / 2) / window.innerHeight };
      spotRef.current = spot;
      setSaved(spot);
    },
  });
  // Keep its place (and stay on screen) when the window changes size.
  useEffect(() => {
    const onResize = () => setPos(fromSaved(spotRef.current));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fromSaved, setPos]);

  // What the button opens: the floating menu or Quick Access (it remembers which).
  const [mode, setMode] = usePref('bpm.floatMode', 'menu');
  const [wideMenu, setWideMenu] = usePref('bpm.floatMenuWide', true);
  const { panel, closing, open, close } = usePanel();
  const panelRef = useRef(panel);
  panelRef.current = closing ? null : panel;
  const closeRef = useRef(close);
  closeRef.current = close;
  const btnRef = useRef(null);
  const rootRef = useRef(null);
  const toggle = useCallback(() => (panel && !closing ? close() : open(mode)), [panel, closing, close, open, mode]);
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
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
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

  useEffect(() => {
    if (!focusOnMount?.current) return;
    focusOnMount.current = false;
    btnRef.current?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const badge = freshTotal(counts);
  const onRight = pos.x + size / 2 > window.innerWidth / 2;
  const anchor = { ...pos, size, onRight };

  return (
    <div ref={rootRef} className="fnav-root">
      <div ref={floatRef} className="fnav-float" style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}>
        <button ref={btnRef} type="button" className={`fnav-btn ${panel && !closing ? 'open' : ''}`} style={{ width: size, height: size }}
          {...btnDrag.handlers}
          onClick={() => !btnDrag.justDragged() && toggle()}
          aria-haspopup="dialog" aria-expanded={!!panel && !closing}
          aria-label={`BrainADZ menu${badge ? `, ${badge} new` : ''}. Drag to move it anywhere.`}
          title="Open the menu · drag to move">
          <Monogram size={Math.round(size * 0.5)} color="#fff" title="" />
          {badge > 0 && <span className="fnav-badge">{badge > 99 ? '99+' : badge}</span>}
        </button>
      </div>
      {panel === 'menu' && (
        <FloatMenu anchor={anchor} items={items} counts={counts} path={path} wide={wideMenu} setWide={setWideMenu} closing={closing}
          onPicked={close} onQuick={() => show('quick')} onDock={onDock} />
      )}
      {panel === 'quick' && (
        <QuickAccess anchor={anchor} items={items} counts={counts} path={path} closing={closing}
          onGo={go} onMenu={() => show('menu')} onDock={onDock} onClose={close} />
      )}
    </div>
  );
}

// Floating side menu, opened beside the button on whichever side has room.
function FloatMenu({ anchor, items, counts, path, wide, setWide, closing, onPicked, onQuick, onDock }) {
  const ref = useRef(null);
  const [top, setTop] = useState(anchor.y);
  const [tip, setTip] = useState(null); // { label, x, y, side }
  const vw = window.innerWidth;
  const side = anchor.onRight ? { right: Math.max(MARGIN, vw - anchor.x + GAP) } : { left: Math.min(anchor.x + anchor.size + GAP, vw - MARGIN - 72) };

  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight || 0;
    setTop(clamp(anchor.y - 8, MARGIN, window.innerHeight - h - MARGIN));
  }, [anchor.y, wide, items.length]);
  useEffect(() => {
    ref.current?.querySelector('.fnav-item.active, .fnav-item')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => setTip(null), [wide]);

  const showTip = (e, label) => {
    if (wide) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip(anchor.onRight ? { label, x: r.left - 10, y: r.top + r.height / 2, side: 'left' } : { label, x: r.right + 10, y: r.top + r.height / 2, side: 'right' });
  };
  const tipProps = (label) => ({
    onMouseEnter: (e) => showTip(e, label),
    onMouseLeave: () => setTip(null),
    onFocus: (e) => e.currentTarget.matches(':focus-visible') && showTip(e, label),
    onBlur: () => setTip(null),
    'aria-label': wide ? undefined : label,
  });

  return (
    <>
      <div ref={ref} role="dialog" aria-label="Menu" className={`fnav-panel fnav-menu ${wide ? 'wide' : ''} ${closing ? 'closing' : ''} ${anchor.onRight ? 'from-right' : 'from-left'}`}
        style={{ ...side, top }}>
        <div className="fnav-head">
          <Monogram size={30} title="BrainADZ" />
          <span className="fnav-word"><b>BrainADZ</b><b>Projects</b></span>
          <button type="button" className="fnav-expand" onClick={() => setWide(!wide)} aria-label={wide ? 'Show icons only' : 'Show names'} title={wide ? 'Show icons only' : 'Show names'}>
            <ChevronsRight size={14} strokeWidth={2.4} />
          </button>
        </div>
        <nav className="fnav-items" aria-label="Main">
          {items.map((n) => {
            const active = isActivePath(n, path);
            return (
              <Link key={n.to} to={n.to} className={`fnav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}
                onClick={onPicked} {...tipProps(n.label)}>
                <n.icon size={26} />
                <span className="lbl">{n.label}</span>
                <CountBadge c={navCount(n, counts)} />
              </Link>
            );
          })}
        </nav>
        <div className="fnav-foot">
          <button type="button" className="fnav-item" onClick={onQuick} {...tipProps('Quick Access')}>
            <span className="fnav-act-ic"><LayoutGrid size={17} /></span><span className="lbl">Quick Access</span>
          </button>
          <button type="button" className="fnav-item" onClick={onDock} {...tipProps('Show the side menu')}>
            <span className="fnav-act-ic"><PanelLeft size={17} /></span><span className="lbl">Show the side menu</span>
          </button>
        </div>
      </div>
      {tip && !closing && (
        <div className={`fnav-tip ${tip.side}`} style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.label}</div>
      )}
    </>
  );
}

const matches = (n, q) => {
  const t = q.trim().toLowerCase();
  return !t || `${n.label} ${n.keys || ''}`.toLowerCase().split(/\s+/).some((w) => w.startsWith(t)) || n.label.toLowerCase().includes(t);
};

// Quick Access: a small card of shortcuts with a search, dragged around by its header.
function QuickAccess({ anchor, items, counts, path, closing, onGo, onMenu, onDock, onClose }) {
  const cardRef = useRef(null);
  const touch = useMedia('(hover: none)');
  const [q, setQ] = useState('');
  const width = Math.min(344, window.innerWidth - MARGIN * 2);
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
  const size = () => ({ w: cardRef.current?.offsetWidth || width, h: cardRef.current?.offsetHeight || 420 });
  const moverRef = useRef(null);
  const drag = useDrag({
    elRef: moverRef,
    getPos: () => posRef.current,
    getSize: size,
    onEnd: setPos,
    ignore: (e) => !!e.target.closest('button, input'),
  });
  // Once its real height is known, make sure all of it is on screen.
  useLayoutEffect(() => {
    const { w, h } = size();
    setPos(keepOnScreen(posRef.current, w, h));
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <div ref={moverRef} className="fnav-quick-pos" style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}>
      <div ref={cardRef} role="dialog" aria-label="Quick Access" style={{ width }}
        className={`fnav-panel fnav-quick ${closing ? 'closing' : ''} ${anchor.onRight ? 'from-right' : 'from-left'}`}>
        <div className="fq-head" {...drag.handlers} title="Drag to move">
          <GripHorizontal size={16} className="fq-grip" aria-hidden="true" />
          <Monogram size={22} title="BrainADZ" />
          <b>Quick Access</b>
          <button type="button" className="fq-x" onClick={onClose} aria-label="Close Quick Access"><X size={17} /></button>
        </div>
        <div className="fq-search">
          <Search size={16} aria-hidden="true" />
          <input id="quick-search" autoFocus={!touch} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, e.g. tasks, files, chat"
            aria-label="Search pages" onKeyDown={(e) => e.key === 'Enter' && shown[0] && onGo(shown[0].to)} />
        </div>
        {shown.length ? (
          <div className="fq-grid">
            {shown.map((n) => {
              const c = navCount(n, counts);
              return (
                <button key={n.to} type="button" className={`fq-tile ${isActivePath(n, path) ? 'active' : ''}`} onClick={() => onGo(n.to)}>
                  <span className="fq-ic" style={{ background: n.tint }}><n.icon size={30} /></span>
                  <span className="fq-lbl">{n.label}</span>
                  {c && <span className={`fq-count ${c.fresh ? '' : 'seen'}`} title={c.title}>{c.value}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="fq-none small muted">No page matches “{q}”. To find a project, task or file, use the search at the top.</div>
        )}
        <div className="fq-foot">
          <button type="button" className="fq-link" onClick={onMenu}><MenuIcon size={15} />Full menu</button>
          <button type="button" className="fq-link" onClick={onDock}><PanelLeft size={15} />Show the side menu</button>
        </div>
      </div>
    </div>
  );
}
