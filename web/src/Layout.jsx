import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Bell, Menu as MenuIcon, LogOut, KeyRound, UserRound, ChevronDown, ChevronLeft, FileText, FolderOpen, CheckCircle2,
  Smartphone, Share, SquarePlus, UsersRound,
} from 'lucide-react';
import { useNavItems, isActivePath, navCount, CountBadge } from './nav.jsx';
import { FloatingNav } from './FloatingNav.jsx';
import { useApp, useLoad, usePref } from './store.jsx';
import { Monogram } from './monogram.jsx';
import { useRouter, Link } from './router.jsx';
import { api } from './api.js';
import { Avatar, useClickOutside, alpha, Modal } from './ui.jsx';
import { useInstallApp } from './installApp.js';
import { timeAgo } from './format.js';
import { useHrmsUrl } from './sso.js';


export function Logo({ size = '' }) {
  return (
    <div className={`logo ${size}`}>
      <div className="b">BrainADZ</div>
      <div className="h">Projects</div>
      {size !== 'sm' && <div className="tg">Plan  |  Track  |  Deliver</div>}
    </div>
  );
}

function Leaf() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
      <path d="M95 118c-6-30-4-58 14-92" stroke="#3f8f3a" strokeWidth="2.5" fill="none" />
      <path d="M100 70c-24-6-38-24-36-46 22 2 38 20 36 46z" fill="#5cb85c" />
      <path d="M100 70c-10-14-20-26-36-46" stroke="#3f8f3a" strokeWidth="1.5" fill="none" />
      <path d="M104 95c18-10 26-30 18-52-20 8-28 30-18 52z" fill="#7ccf5e" />
      <path d="M97 105c-22 2-40-10-46-30 22-4 40 8 46 30z" fill="#4aa84a" />
      <path d="M108 40c6-16 4-30-6-40-8 12-8 28 6 40z" fill="#8fdc6a" />
    </svg>
  );
}

// Same treatment as the HRMS vertical switcher.
const LOGO_COLOR = { Live: '#E5243B', Marketing: '#E5243B', Exhibits: '#3C9A3A' };

function VerticalLogo({ v, active, onClick }) {
  return (
    <button type="button" className={`vlogo ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}
      title={active ? `Showing ${v.name} only. Click to show all your verticals.` : `Show ${v.name} only`}>
      <span className="b">BrainADZ</span>
      <span className="n" style={{ color: LOGO_COLOR[v.short] || v.color }}>{v.short}</span>
      <span className="t">{v.tagline}</span>
    </button>
  );
}

function usePhone() {
  const query = '(max-width: 760px)';
  const [on, setOn] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const fn = () => setOn(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return on;
}

// Wide enough for the menu to sit beside the page (narrower screens use the slide-out menu).
function useWide() {
  const query = '(min-width: 1101px)';
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

// On wide screens the menu can collapse to a slim rail of icons with the Br monogram
// (remembered per browser). Phones and tablets keep the slide-out menu.
function Sidebar({ open, onClose, counts, mini, onToggleMini, onFloat }) {
  const items = useNavItems();
  const { path } = useRouter();
  const asideRef = useRef(null);
  const [tip, setTip] = useState(null); // { label, top } while hovering an icon in the rail
  const isActive = (n) => isActivePath(n, path);
  const showTip = (e, label) => {
    if (!mini || !asideRef.current) return;
    const a = e.currentTarget.getBoundingClientRect();
    const s = asideRef.current.getBoundingClientRect();
    setTip({ label, top: a.top - s.top + a.height / 2 });
  };
  useEffect(() => setTip(null), [mini, path]);

  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <aside ref={asideRef} className={`sidebar ${open ? 'open' : ''} ${mini ? 'mini' : ''}`}>
        <div className="brand">
          <div className="brand-full"><Logo /></div>
          <button type="button" className="brand-mono" onClick={onToggleMini} tabIndex={mini ? 0 : -1} aria-hidden={!mini} title="Expand the menu">
            <Monogram size={42} />
          </button>
        </div>
        <button type="button" className="side-toggle" onClick={onToggleMini} aria-expanded={!mini}
          aria-label={mini ? 'Expand the menu' : 'Collapse the menu'} title={`${mini ? 'Expand' : 'Collapse'} the menu  [`}>
          <ChevronLeft size={15} strokeWidth={2.4} />
        </button>
        <nav className="nav" aria-label="Main">
          {items.map((n) => (
            <Link key={n.to} to={n.to} className={isActive(n) ? 'active' : ''} onClick={onClose} aria-current={isActive(n) ? 'page' : undefined}
              aria-label={mini ? n.label : undefined}
              onMouseEnter={(e) => showTip(e, n.label)} onMouseLeave={() => setTip(null)} onFocus={(e) => showTip(e, n.label)} onBlur={() => setTip(null)}>
              <n.icon size={26} />
              <span className="lbl">{n.label}</span>
              <CountBadge c={navCount(n, counts)} />
            </Link>
          ))}
          {/* Hide this menu and use the draggable Br button instead. */}
          <button type="button" className="nav-act" onClick={() => { onClose(); onFloat(); }} aria-label={mini ? 'Floating menu' : undefined}
            title="Hide the menu and use a floating Br button you can drag anywhere"
            onMouseEnter={(e) => showTip(e, 'Floating menu')} onMouseLeave={() => setTip(null)} onFocus={(e) => showTip(e, 'Floating menu')} onBlur={() => setTip(null)}>
            <span className="nav-act-ic"><Monogram size={15} color="#fff" title="" /></span>
            <span className="lbl">Floating menu</span>
          </button>
        </nav>
        {mini && tip && <div className="side-tip" style={{ top: tip.top }} role="tooltip">{tip.label}</div>}
        <div className="leaf-card">
          <b>Great Projects Start With a Clear Plan</b>
          <i />
          <Leaf />
        </div>
      </aside>
    </>
  );
}

function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [focus, setFocus] = useState(0);
  const { navigate } = useRouter();
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setResults([]);
    let live = true;
    const t = setTimeout(() => {
      api.get('/search', { q: term }).then((r) => live && (setResults(r.results), setFocus(0))).catch(() => {});
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const go = (r) => {
    setOpen(false);
    setQ('');
    navigate(r.link);
  };
  const icon = { project: FolderOpen, task: CheckCircle2, file: FileText };
  return (
    <div className="search" ref={ref}>
      <Search size={18} />
      <input
        id="global-search"
        value={q}
        placeholder="Search projects, clients, tasks, files"
        aria-label="Search"
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setFocus((f) => Math.min(f + 1, results.length - 1)));
          if (e.key === 'ArrowUp') (e.preventDefault(), setFocus((f) => Math.max(f - 1, 0)));
          if (e.key === 'Enter' && results[focus]) go(results[focus]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="dropdown" style={{ left: 0, right: 'auto', width: 'max(100%, 340px)' }}>
          {results.length === 0 && <div className="item muted">No matches in your verticals</div>}
          {results.map((r, i) => {
            const Ic = icon[r.type];
            return (
              <div key={`${r.type}-${r.id}`} className={`item ${i === focus ? 'focus' : ''}`} onMouseDown={() => go(r)} onMouseEnter={() => setFocus(i)}>
                <span className="file-ic sm" style={{ background: alpha(r.color, 0.14), color: r.color }}><Ic size={15} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="b6 ellipsis">{r.title}</div>
                  <div className="xs muted ellipsis">{r.type === 'project' ? 'Project' : r.type === 'task' ? 'Task' : 'File'} · {r.sub}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { boot, loadBoot } = useApp();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close);
  const { navigate } = useRouter();
  const { data, reload } = useLoad(() => (open ? api.get('/notifications') : Promise.resolve(null)), [open]);
  const unread = data?.unread ?? boot?.unread ?? 0;

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) await api.post('/notifications/read', { id: n.id }).catch(() => {});
    loadBoot();
    if (n.link) navigate(n.link);
    else if (n.project_id) navigate(n.task_id ? `/projects/${n.project_id}/tasks/${n.task_id}` : `/projects/${n.project_id}`);
  };
  const readAll = async () => {
    await api.post('/notifications/read', {});
    reload({ quiet: true });
    loadBoot();
  };
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen((o) => !o)}>
        <Bell size={21} />
        {unread > 0 && <span className="badge-dot">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown notif">
          <div className="head">
            Notifications
            {unread > 0 && <button type="button" className="link" onClick={readAll}>Mark all read</button>}
          </div>
          <div className="notif-list">
            {!data && <div className="item muted">Loading…</div>}
            {data?.items.length === 0 && <div className="item muted">You are all caught up.</div>}
            {data?.items.map((n) => (
              <div key={n.id} className={`item ${n.read ? '' : 'unread'}`} onClick={() => openItem(n)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openItem(n)}>
                <span className="dot" style={{ background: n.vertical_color || 'var(--blue)', marginTop: 6, alignSelf: 'flex-start' }} />
                <div style={{ minWidth: 0 }}>
                  <div className="small" style={{ lineHeight: 1.4 }}>{n.text}</div>
                  <div className="xs muted mt-4">{timeAgo(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// How to add the app to an iPhone's home screen (Safari has no install button).
function IPhoneInstall({ onClose }) {
  return (
    <Modal title="Add BrainADZ to your home screen" sub="It opens full screen, like any other app" onClose={onClose}
      footer={<button type="button" className="btn primary" onClick={onClose}>Got it</button>}>
      <ol className="modal-body install-steps">
        <li><span className="step-ic"><Share size={18} /></span><span>In Safari, tap the <b>Share</b> button at the bottom of the screen.</span></li>
        <li><span className="step-ic"><SquarePlus size={18} /></span><span>Scroll down and tap <b>Add to Home Screen</b>.</span></li>
        <li><span className="step-ic"><Monogram size={18} color="#fff" title="" /></span><span>Tap <b>Add</b>. BrainADZ appears on your home screen with the Br icon.</span></li>
      </ol>
    </Modal>
  );
}

function UserMenu({ onSignOut }) {
  const { me, verticals } = useApp();
  const [open, setOpen] = useState(false);
  const [iphoneHelp, setIphoneHelp] = useState(false);
  const installApp = useInstallApp();
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close);
  const { navigate } = useRouter();
  const hrmsUrl = useHrmsUrl(api.isDemo());
  const role = me.role === 'admin' ? 'Admin · all verticals' : verticals.map((v) => v.short).join(' · ') || 'No verticals yet';
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="user-chip" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={me.name} color={me.color} size={40} />
        <span className="who">
          <div className="nm">{me.name}</div>
          <div className="rl">{role}</div>
        </span>
        <ChevronDown size={16} className="hide-sm" />
      </button>
      {open && (
        <div className="dropdown menu" role="menu">
          <div className="head" style={{ display: 'block' }}>
            <div className="b6">{me.name}</div>
            <div className="xs muted" style={{ fontWeight: 500 }}>{me.email}</div>
          </div>
          <button type="button" className="item" role="menuitem" onClick={() => (close(), navigate('/profile'))}><UserRound size={16} />My profile</button>
          {!api.isDemo() && <button type="button" className="item" role="menuitem" onClick={() => (close(), navigate('/profile'))}><KeyRound size={16} />Change password</button>}
          {installApp && (
            <button type="button" className="item" role="menuitem" onClick={() => { close(); if (installApp.kind === 'ios') setIphoneHelp(true); else installApp.install(); }}>
              <Smartphone size={16} />{installApp.kind === 'ios' ? 'Add to Home Screen' : 'Install app'}
            </button>
          )}
          {/* Back to the HRMS, which keeps its own sign-in. */}
          {hrmsUrl && <button type="button" className="item" role="menuitem" onClick={() => window.location.assign(hrmsUrl)}><UsersRound size={16} />Open BrainADZ HRMS</button>}
          <button type="button" className="item danger" role="menuitem" onClick={() => (close(), onSignOut())}><LogOut size={16} />{api.isDemo() ? 'Switch person' : 'Sign out'}</button>
        </div>
      )}
      {/* At page level: the top bar's blur would otherwise trap the window inside the bar. */}
      {iphoneHelp && createPortal(<IPhoneInstall onClose={() => setIphoneHelp(false)} />, document.body)}
    </div>
  );
}

export function Layout({ children, onSignOut }) {
  const { verticals, vertical, setVertical, version, countsVersion, me } = useApp();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({ my: 0, myNew: 0, projectsNew: 0, groups: 0, groupsUnread: 0 });
  const [miniPref, setMini] = usePref('bpm.sidebarMini', false);
  // Floating: the side menu hides and a draggable Br button opens the menu instead.
  // Phones start with it (like a mobile app); anyone can switch either way and that sticks.
  const [floatingPref, setFloating] = usePref('bpm.menuFloating', null);
  const phone = usePhone();
  const floating = floatingPref ?? phone;
  const focusFloat = useRef(false); // move keyboard focus along when someone switches menu style
  const goFloating = useCallback(() => {
    focusFloat.current = true;
    setFloating(true);
  }, [setFloating]);
  const dock = useCallback(() => {
    setFloating(false);
    setTimeout(() => document.querySelector('.nav .nav-act')?.focus({ preventScroll: true }), 60);
  }, [setFloating]);
  const wide = useWide();
  const mini = miniPref && wide;
  const toggleMini = useCallback(() => wide && setMini(!miniPref), [wide, miniPref, setMini]);
  // "[" collapses or expands the menu, unless you are typing (the floating menu has its own).
  useEffect(() => {
    if (floating) return undefined;
    const onKey = (e) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      toggleMini();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMini, floating]);
  const [tick, setTick] = useState(0);
  const { path } = useRouter();

  // Group chats change without anyone here clicking, so check the counts every half minute.
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Sidebar counts: red while something new is waiting, grey once you have looked.
  useEffect(() => {
    let live = true;
    Promise.all([api.get('/tasks', { assignee: 'me', scope: 'open' }), api.get('/projects'), api.get('/groups')])
      .then(([t, p, g]) => {
        if (!live) return;
        const mine = g.items.filter((x) => x.member);
        setCounts({
          my: t.items.length,
          myNew: t.items.filter((x) => x.is_new).length,
          projectsNew: p.items.filter((x) => x.new_items > 0).length,
          groups: mine.length,
          groupsUnread: mine.reduce((n, x) => n + x.unread, 0),
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [version, countsVersion, path, me.id, tick]);

  return (
    <div className={`app ${floating ? 'menu-floating' : ''}`}>
      <Sidebar open={open} onClose={() => setOpen(false)} counts={counts} mini={mini} onToggleMini={toggleMini} onFloat={goFloating} />
      {floating && <FloatingNav counts={counts} onDock={dock} focusOnMount={focusFloat} />}
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn burger" aria-label="Open menu" onClick={() => setOpen(true)}><MenuIcon size={22} /></button>
          {floating && <span className="app-mark"><Monogram size={30} title="BrainADZ Projects" /></span>}
          {verticals.length > 1 && (
            <div className="verticals" role="group" aria-label="Filter by vertical">
              {verticals.map((v) => (
                <VerticalLogo key={v.id} v={v} active={vertical === v.id} onClick={() => setVertical(vertical === v.id ? null : v.id)} />
              ))}
            </div>
          )}
          {verticals.length === 1 && (
            <div className="verticals"><VerticalLogo v={verticals[0]} active onClick={() => {}} /></div>
          )}
          <div className="spacer" />
          <SearchBox />
          <Notifications />
          <UserMenu onSignOut={onSignOut} />
        </header>
        {verticals.length > 1 && (
          <div className="vfilter-sm" role="group" aria-label="Filter by vertical">
            <button type="button" className={`pick-chip ${!vertical ? 'on' : ''}`} onClick={() => setVertical(null)}>All</button>
            {verticals.map((v) => (
              <button key={v.id} type="button" className={`pick-chip ${vertical === v.id ? 'on' : ''}`} onClick={() => setVertical(vertical === v.id ? null : v.id)}>{v.short}</button>
            ))}
          </div>
        )}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
