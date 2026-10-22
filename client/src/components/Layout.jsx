// The app shell: side menu (or floating menu), top bar with search, clock, notifications and
// account menu, and the phone navigation.
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Menu as MenuIcon,
  LogOut,
  KeyRound,
  User,
  LayoutGrid,
  CheckCheck,
  ChevronsLeft,
  Smartphone,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../lib/api.js';
import { ago } from '../lib/format.js';
import { useClickOutside, useDebounced, useScrollEdges } from '../lib/hooks.js';
import { Avatar, Button, Field, Input, Modal } from './ui.jsx';
import {
  IconDashboard,
  IconMySpace,
  IconHiring,
  IconScreener,
  IconEmployees,
  IconDocuments,
  IconLeave,
  IconHolidays,
  IconPayroll,
  IconPerformance,
  IconAttendance,
  IconPosh,
  IconResignation,
  IconReports,
  IconSettings,
  IconSearch,
  IconBell,
  IconProfile,
  IconChevronDown,
  VERTICAL_ICONS,
  Monogram,
} from './icons.jsx';
import WorkClock, { SignInPrompts, SignOutModal, LocationGuard } from './WorkClock.jsx';
import FloatingNav from './FloatingNav.jsx';
import { BottomBar, MoreSheet } from './MobileNav.jsx';
import { GetAppModal, InstallBanner } from './InstallApp.jsx';
import { canOfferApp, useInstall } from '../lib/pwa.js';
import { useWorkday } from '../lib/workday.js';

// BrainADZ HRMS wordmark; the small size drops the tagline.
export function Logo({ size = '' }) {
  return (
    <div className={`logo ${size}`}>
      <div className="b">BrainADZ</div>
      <div className="h">HRMS</div>
      {size !== 'sm' && (
        <div className="tg">People &nbsp;|&nbsp; Process &nbsp;|&nbsp; Possibilities</div>
      )}
    </div>
  );
}

// Brand colour of each vertical's name in its logo.
const VSTYLE = { Live: '#E5243B', Marketing: '#E5243B', Exhibits: '#3C9A3A' };
// A vertical's logo in the top bar; clicking shows only that vertical, clicking again shows all.
export function VerticalLogo({ v, active, onClick }) {
  const Icon = VERTICAL_ICONS[v.short];
  return (
    <button
      type="button"
      className={`vlogo ${active ? 'active' : ''}`}
      onClick={onClick}
      title={
        active ? `Showing ${v.name} only. Click to show all verticals.` : `Show ${v.name} only`
      }
    >
      {Icon && <Icon size={28} className="vi" />}
      <span className="vt">
        <span className="b">BrainADZ</span>
        <span className="n" style={{ color: VSTYLE[v.short] || v.color }}>
          {v.short}
        </span>
        <span className="t">{v.tagline}</span>
      </span>
    </button>
  );
}

// Wide banner with the product name and the "People, Power, Progress" line.
export function BrandBanner() {
  return (
    <div className="brand-banner">
      <div>
        <div className="big">
          <span className="b">BrainADZ</span> <span className="h">HRMS</span>
        </div>
        <div className="sub">Unified people operations across all BrainADZ verticals</div>
      </div>
      <div className="script">
        People
        <br />
        Power
        <br />
        Progress
      </div>
    </div>
  );
}

// Leaf drawing for the quote card at the bottom of the side menu.
function Leaves() {
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

// Menu modules in order; `roles` limits who sees one, no `roles` means everyone.
const NAV = [
  {
    to: '/',
    label: 'Dashboard',
    icon: IconDashboard,
    roles: ['admin', 'hr', 'manager'],
    end: true,
  },
  { to: '/my', label: 'My Space', icon: IconMySpace, roles: ['employee', 'manager'] },
  { to: '/hiring', label: 'Hiring', icon: IconHiring, roles: ['admin', 'hr', 'manager'] },
  { to: '/screener', label: 'Resume Screener AI', icon: IconScreener, roles: ['admin', 'hr'] },
  { to: '/employees', label: 'Employees', icon: IconEmployees },
  { to: '/documents', label: 'Documents', icon: IconDocuments },
  { to: '/leave', label: 'Leave & Policies', icon: IconLeave },
  { to: '/calendar', label: 'Holiday Calendar', icon: IconHolidays },
  { to: '/payroll', label: 'Payroll', icon: IconPayroll, roles: ['admin', 'hr'] },
  { to: '/performance', label: 'Performance', icon: IconPerformance },
  { to: '/attendance', label: 'Attendance', icon: IconAttendance },
  { to: '/posh', label: 'POSH', icon: IconPosh },
  { to: '/resignation', label: 'Resignation', icon: IconResignation },
  { to: '/reports', label: 'Reports', icon: IconReports, roles: ['admin', 'hr'] },
  { to: '/settings', label: 'Settings', icon: IconSettings, roles: ['admin', 'hr'] },
];

// localStorage keys: sidebar collapsed or not, and docked or floating menu.
const COLLAPSE_KEY = 'hrms.sidebar';
const NAV_LAYOUT_KEY = 'hrms.navLayout';
// Whether the sidebar was left collapsed last time.
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

// Side menu: logo, collapse button, module links, floating-menu switch and quote card.
function Sidebar({ items, open, onClose, collapsed, onToggle, onFloat }) {
  const { user } = useApp();
  // Labels for the icon-only rail; drawn outside the scrolling menu so they are not clipped.
  const [tip, setTip] = useState(null);
  const showTip = (label) => (e) => {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);
  useEffect(hideTip, [collapsed]);
  const scroll = useScrollEdges();
  return (
    <>
      {/* Backdrop behind the menu when it slides open on small screens */}
      {open && <div className="scrim" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        {/* Logo, linking to the user's home page */}
        <div className="brand">
          <Link
            to={user.role === 'employee' ? '/my' : '/'}
            onClick={onClose}
            className="brand-link"
            aria-label="BrainADZ HRMS home"
          >
            <Logo />
            <Monogram className="mono" />
          </Link>
        </div>
        {/* Collapse to an icon-only rail */}
        <button
          type="button"
          className="collapse-btn"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronsLeft size={16} />
        </button>
        {/* Module links; scrolling hides the rail tooltip */}
        <nav
          className={`nav ${scroll.edges}`}
          aria-label="Main"
          ref={scroll.ref}
          onScroll={() => {
            hideTip();
            scroll.onScroll();
          }}
        >
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={onClose}
              onMouseEnter={showTip(n.label)}
              onMouseLeave={hideTip}
              onFocus={showTip(n.label)}
              onBlur={hideTip}
            >
              <n.icon size={22} />
              <span className="lbl">{n.label}</span>
            </NavLink>
          ))}
          {/* Hide this menu and use the draggable Br button instead. */}
          <button
            type="button"
            className="nav-act"
            onClick={() => {
              onClose();
              onFloat();
            }}
            aria-label={collapsed ? 'Floating menu' : undefined}
            title="Hide the menu and use a floating Br button you can drag anywhere"
            onMouseEnter={showTip('Floating menu')}
            onMouseLeave={hideTip}
            onFocus={showTip('Floating menu')}
            onBlur={hideTip}
          >
            <span className="nav-act-ic">
              <Monogram height={13} color="#fff" label={null} />
            </span>
            <span className="lbl">Floating menu</span>
          </button>
        </nav>
        {/* Rail tooltip */}
        {collapsed && tip && (
          <div className="nav-tip" style={{ top: tip.top }} aria-hidden="true">
            {tip.label}
          </div>
        )}
        {/* Quote card */}
        <div className="leaf-card">
          <b>Great People Build Brighter Tomorrows</b>
          <i />
          <Leaves />
        </div>
      </aside>
    </>
  );
}

// Top-bar search across employees, jobs and policies, with arrow-key navigation.
function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [focus, setFocus] = useState(0);
  const dq = useDebounced(q, 220);
  const nav = useNavigate();
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  // Search once typing pauses (2+ characters); a reply to an older query is ignored.
  useEffect(() => {
    if (dq.trim().length < 2) return setResults([]);
    let alive = true;
    api
      .get(`/search?q=${encodeURIComponent(dq.trim())}`)
      .then((r) => alive && (setResults(r.results), setFocus(0)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [dq]);
  // Opens a result and clears the box.
  const go = (r) => {
    setOpen(false);
    setQ('');
    nav(r.link);
  };
  return (
    <div className="search" ref={ref}>
      <IconSearch size={19} />
      <input
        value={q}
        placeholder="Search employees, jobs, policies…"
        aria-label="Search"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setFocus((f) => Math.min(results.length - 1, f + 1));
          if (e.key === 'ArrowUp') setFocus((f) => Math.max(0, f - 1));
          if (e.key === 'Enter' && results[focus]) go(results[focus]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {/* Results; mousedown picks one before the input's blur can close the list */}
      {open && q.trim().length >= 2 && (
        <div className="dropdown" style={{ left: 0, right: 'auto', width: '100%', minWidth: 300 }}>
          {results.length === 0 ? (
            <div className="item muted">No matches</div>
          ) : (
            results.map((r, i) => (
              <div
                key={`${r.type}${r.id}`}
                className={`item ${i === focus ? 'focus' : ''}`}
                onMouseDown={() => go(r)}
              >
                {r.type === 'Employee' ? (
                  <Avatar name={r.title} size={30} />
                ) : (
                  <span className="badge b-blue" style={{ minWidth: 70, justifyContent: 'center' }}>
                    {r.type}
                  </span>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="b6 ellipsis">{r.title}</div>
                  <div className="small muted ellipsis">{r.subtitle}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Notification bell and list; reloads every minute and whenever the page changes.
function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const nav = useNavigate();
  const loc = useLocation();
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  const load = useCallback(
    () =>
      api
        .get('/notifications')
        .then(setData)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load, loc.pathname]);
  // Marks it read, then follows its link.
  const click = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    setOpen(false);
    load();
    if (n.link) nav(n.link);
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell with the unread count */}
      <button
        type="button"
        className="icon-btn"
        aria-label={`Notifications (${data.unread} unread)`}
        onClick={() => setOpen((o) => !o)}
      >
        <IconBell size={24} />
        {data.unread > 0 && (
          <span className="badge-dot">{data.unread > 9 ? '9+' : data.unread}</span>
        )}
      </button>
      {/* Dropdown: "Mark all read", then the list */}
      {open && (
        <div className="dropdown" style={{ width: 360 }}>
          <div className="head">
            Notifications{' '}
            {data.unread > 0 && (
              <button
                type="button"
                className="link"
                onClick={async () => {
                  await api.post('/notifications/read-all');
                  load();
                }}
              >
                <CheckCheck size={14} />
                Mark all read
              </button>
            )}
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {data.items.length === 0 && <div className="item muted">You're all caught up.</div>}
            {data.items.map((n) => (
              <div
                key={n.id}
                className="item"
                onClick={() => click(n)}
                style={{ alignItems: 'flex-start' }}
              >
                <span
                  className="dot"
                  style={{ background: n.read ? 'transparent' : 'var(--red)', marginTop: 6 }}
                />
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: n.read ? 400 : 600, lineHeight: 1.4 }}>
                    {n.text}
                  </div>
                  <div className="xs muted mt-8" style={{ marginTop: 3 }}>
                    {ago(n.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Change-password dialog; when `forced` (temporary password) it can't be dismissed.
export function ChangePassword({ onClose, forced }) {
  const { toast, loadMe } = useApp();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Checks the confirmation, saves, then reloads the user so a forced prompt goes away.
  const save = async () => {
    if (f.next !== f.confirm) return setErr('New passwords do not match');
    setBusy(true);
    setErr('');
    try {
      await api.post('/auth/change-password', { current: f.current, next: f.next });
      toast('Password changed', 'success', { module: '/account' });
      await loadMe();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={forced ? 'Set a new password' : 'Change password'}
      size="narrow"
      onClose={forced ? undefined : onClose}
      footer={
        <>
          {!forced && <Button onClick={onClose}>Cancel</Button>}
          <Button variant="primary" loading={busy} onClick={save}>
            Save password
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        {forced && (
          <div className="alert info">
            You signed in with a temporary password. Choose your own to continue.
          </div>
        )}
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={f.current}
            onChange={(e) => setF({ ...f, current: e.target.value })}
          />
        </Field>
        <Field label="New password" hint="At least 8 characters with letters and numbers">
          <Input
            type="password"
            autoComplete="new-password"
            value={f.next}
            onChange={(e) => setF({ ...f, next: e.target.value })}
          />
        </Field>
        <Field label="Confirm new password">
          <Input
            type="password"
            autoComplete="new-password"
            value={f.confirm}
            onChange={(e) => setF({ ...f, confirm: e.target.value })}
          />
        </Field>
        {err && <div className="error-text">{err}</div>}
      </div>
    </Modal>
  );
}

// Account chip and menu: My Space, profile, password, the app and sign-out.
function UserMenu({ onGetApp }) {
  const { user, logout } = useApp();
  const workday = useWorkday();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // With the clock still running, ask about checking out before signing out.
  const signOut = () => {
    setOpen(false);
    if (workday?.workday?.openSince) setLeaving(true);
    else logout();
  };
  const nav = useNavigate();
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Photo (or profile icon), name and designation */}
      <button
        type="button"
        className="user-chip"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
      >
        {user.hasPhoto ? (
          <Avatar name={user.name} id={user.employeeId} hasPhoto size={46} />
        ) : (
          <IconProfile size={46} />
        )}
        <div className="who">
          <div className="nm">{user.name}</div>
          <div className="rl">{user.designation}</div>
        </div>
        <IconChevronDown size={18} />
      </button>
      {/* Account menu */}
      {open && (
        <div className="dropdown" style={{ width: 240 }}>
          <div className="head" style={{ display: 'block' }}>
            <div>{user.name}</div>
            <div className="small muted" style={{ fontWeight: 400 }}>
              {user.email} · {user.role}
            </div>
          </div>
          <div
            className="item"
            onClick={() => {
              setOpen(false);
              nav('/my');
            }}
          >
            <LayoutGrid size={16} />
            My Space
          </div>
          {user.employeeId && (
            <div
              className="item"
              onClick={() => {
                setOpen(false);
                nav(`/employees/${user.employeeId}`);
              }}
            >
              <User size={16} />
              My profile
            </div>
          )}
          <div
            className="item"
            onClick={() => {
              setOpen(false);
              setPw(true);
            }}
          >
            <KeyRound size={16} />
            Change password
          </div>
          {onGetApp && (
            <div
              className="item"
              onClick={() => {
                setOpen(false);
                onGetApp();
              }}
            >
              <Smartphone size={16} />
              Get the mobile app
            </div>
          )}
          <div className="item" style={{ color: 'var(--red)' }} onClick={signOut}>
            <LogOut size={16} />
            Sign out
          </div>
        </div>
      )}
      {/* Change password and the check-out-before-sign-out dialog */}
      {pw && <ChangePassword onClose={() => setPw(false)} />}
      {leaving && <SignOutModal onClose={() => setLeaving(false)} />}
    </div>
  );
}

// The shell around every signed-in page.
export default function Layout({ children }) {
  const { user, meta, vertical, setVertical } = useApp();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Collapses or expands the sidebar and remembers the choice.
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? 'expanded' : 'collapsed');
      } catch {
        // Storage can be blocked (private windows); the toggle still works for this visit.
      }
      return !c;
    });
  // Floating: the side menu hides and a draggable Br button opens the menu instead.
  const [floating, setFloatingState] = useState(() => {
    try {
      return localStorage.getItem(NAV_LAYOUT_KEY) === 'floating';
    } catch {
      return false;
    }
  });
  const setFloating = (on) => {
    setFloatingState(on);
    try {
      localStorage.setItem(NAV_LAYOUT_KEY, on ? 'floating' : 'docked');
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  };
  const focusFloat = useRef(false); // move keyboard focus along when someone switches menu style
  const goFloating = () => {
    focusFloat.current = true;
    setFloating(true);
  };
  // Back to the side menu; focus its floating-menu button once it has rendered.
  const dock = () => {
    setFloating(false);
    setTimeout(() => document.querySelector('.nav .nav-act')?.focus({ preventScroll: true }), 60);
  };
  // "[" collapses or expands the side menu, unless you are typing (the floating menu has its own).
  useEffect(() => {
    if (floating) return undefined;
    const onKey = (e) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || window.innerWidth <= 1100) return;
      const t = e.target;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      toggleCollapsed();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [floating]); // eslint-disable-line react-hooks/exhaustive-deps
  // Modules this role can open, and the verticals offered as top-bar filters (not Corporate).
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  const verticals = (meta?.verticals || []).filter((v) => v.short !== 'Corporate');
  // Phones: bottom tabs with "More" for everything else, and the app install offer.
  const [more, setMore] = useState(false);
  const [getApp, setGetApp] = useState(false);
  const app = useInstall();
  // Offered only where the app can be installed and isn't already.
  const offerApp = canOfferApp() && !app.installed ? () => setGetApp(true) : null;
  return (
    <div className={`app ${floating ? 'nav-floating' : ''}`}>
      {/* Side menu (hidden in floating mode) and the floating Br button */}
      <Sidebar
        items={items}
        open={open}
        onClose={() => setOpen(false)}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onFloat={goFloating}
      />
      {floating && <FloatingNav items={items} onDock={dock} focusOnMount={focusFloat} />}
      <div className="main">
        {/* Top bar */}
        <header className="topbar no-print">
          <button
            type="button"
            className="icon-btn burger"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
          >
            <MenuIcon size={22} />
          </button>
          {/* Vertical filters (not for employees) */}
          {user.role !== 'employee' && (
            <div className="verticals">
              {verticals.map((v) => (
                <VerticalLogo
                  key={v.id}
                  v={v}
                  active={vertical === v.id}
                  onClick={() => setVertical(vertical === v.id ? null : v.id)}
                />
              ))}
            </div>
          )}
          <div className="spacer" />
          {/* Search, work clock, notifications and account */}
          <GlobalSearch />
          <WorkClock />
          <Notifications />
          <UserMenu onGetApp={offerApp} />
        </header>
        {/* Page content, under the one-time install banner on phones */}
        <main className="content">
          <InstallBanner onHow={() => setGetApp(true)} />
          {children}
        </main>
      </div>
      {/* Phone tab bar and its More sheet */}
      <BottomBar items={items} moreOpen={more} onMore={() => setMore(true)} />
      {more && <MoreSheet items={items} onClose={() => setMore(false)} onGetApp={offerApp} />}
      {/* App-wide dialogs: get the app, forced password change, sign-in and location prompts */}
      {getApp && <GetAppModal onClose={() => setGetApp(false)} />}
      {user.mustChangePassword && <ChangePassword forced onClose={() => {}} />}
      <SignInPrompts />
      <LocationGuard />
    </div>
  );
}
