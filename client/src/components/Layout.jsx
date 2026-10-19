import { useCallback, useEffect, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu as MenuIcon, LogOut, KeyRound, User, LayoutGrid, CheckCheck, ChevronsLeft } from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../lib/api.js';
import { ago } from '../lib/format.js';
import { useClickOutside, useDebounced } from '../lib/hooks.js';
import { Avatar, Button, Field, Input, Modal } from './ui.jsx';
import {
  IconDashboard, IconMySpace, IconHiring, IconScreener, IconEmployees, IconDocuments, IconLeave, IconHolidays, IconPayroll,
  IconPerformance, IconAttendance, IconPosh, IconResignation, IconReports, IconSettings, IconSearch, IconBell, IconProfile,
  IconChevronDown, VERTICAL_ICONS,
} from './icons.jsx';
import WorkClock, { SignInPrompts, SignOutModal, LocationGuard } from './WorkClock.jsx';
import { useWorkday } from '../lib/workday.js';

export function Logo({ size = '' }) {
  return (
    <div className={`logo ${size}`}>
      <div className="b">BrainADZ</div>
      <div className="h">HRMS</div>
      {size !== 'sm' && <div className="tg">People &nbsp;|&nbsp; Process &nbsp;|&nbsp; Possibilities</div>}
    </div>
  );
}

// The "Br" monogram shown when the sidebar is collapsed (traced from the brand artwork).
const MONOGRAM_PATH = 'M31.7 0.0L26.3 0.4L22.7 1.1L19.1 2.2L17.4 2.9L14.9 4.2L11.9 6.3L9.9 8.2L8.6 9.6L7.4 11.3L6.3 13.0L4.9 16.2L4.2 18.5L3.6 20.8L3.1 25.6L3.3 30.1L3.6 32.2L4.2 34.2L4.8 35.6L6.1 38.1L8.4 41.1L10.1 42.8L11.8 44.1L13.2 44.9L15.2 45.8L15.2 45.9L13.5 46.6L10.1 48.4L7.7 50.1L6.0 51.7L4.3 53.9L3.5 55.3L2.0 58.3L1.4 60.1L0.5 63.5L0.2 66.3L0.0 68.9L0.1 72.4L0.4 75.9L1.1 79.0L2.0 81.7L3.2 84.4L4.7 86.9L6.3 89.0L9.2 91.9L12.0 94.1L15.5 95.9L17.7 96.9L21.3 98.1L23.9 98.7L26.5 99.2L30.2 99.6L34.9 99.9L82.2 100.0L82.3 55.8L82.8 54.0L83.4 52.3L84.1 50.9L85.8 48.6L87.6 46.9L88.9 46.0L90.3 45.3L92.3 44.6L93.9 44.1L97.2 43.7L101.3 43.6L105.2 44.1L105.2 23.9L99.8 23.9L97.7 24.1L94.4 24.6L92.2 25.2L89.1 26.6L86.7 28.1L85.1 29.4L83.5 30.9L82.7 32.0L82.4 32.2L82.4 0.1ZM62.3 22.4L62.2 39.0L34.9 39.0L32.0 38.7L30.6 38.4L29.0 37.9L27.6 37.2L26.2 36.1L25.4 35.2L24.5 34.0L23.9 32.6L23.6 31.4L23.3 29.4L23.3 26.4L23.8 23.9L24.6 22.1L25.5 20.8L26.7 19.7L28.6 18.6L30.8 17.9L32.9 17.5L35.2 17.3L62.3 17.4ZM20.4 69.3L20.3 68.0L20.6 65.3L21.2 63.1L22.1 61.3L23.0 60.1L24.6 58.7L25.6 58.1L28.0 57.0L30.3 56.4L33.9 56.0L62.2 56.0L62.2 83.0L33.8 82.9L31.9 82.6L29.9 82.2L28.1 81.5L25.8 80.1L24.5 79.1L23.0 77.4L21.9 75.6L21.0 73.4L20.5 71.5Z';
export function Monogram({ className = '', height = 36 }) {
  return (
    <svg className={className} height={height} viewBox="0 0 105.2 100" role="img" aria-label="BrainADZ">
      <path fill="#2B3C6D" fillRule="evenodd" d={MONOGRAM_PATH} />
    </svg>
  );
}

const VSTYLE = { Live: '#E5243B', Marketing: '#E5243B', Exhibits: '#3C9A3A' };
export function VerticalLogo({ v, active, onClick }) {
  const Icon = VERTICAL_ICONS[v.short];
  return (
    <button type="button" className={`vlogo ${active ? 'active' : ''}`} onClick={onClick} title={active ? `Showing ${v.name} only. Click to show all verticals.` : `Show ${v.name} only`}>
      {Icon && <Icon size={28} className="vi" />}
      <span className="vt">
        <span className="b">BrainADZ</span>
        <span className="n" style={{ color: VSTYLE[v.short] || v.color }}>{v.short}</span>
        <span className="t">{v.tagline}</span>
      </span>
    </button>
  );
}

export function BrandBanner() {
  return (
    <div className="brand-banner">
      <div>
        <div className="big"><span className="b">BrainADZ</span> <span className="h">HRMS</span></div>
        <div className="sub">Unified people operations across all BrainADZ verticals</div>
      </div>
      <div className="script">People<br />Power<br />Progress</div>
    </div>
  );
}

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

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconDashboard, roles: ['admin', 'hr', 'manager'], end: true },
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

const COLLAPSE_KEY = 'hrms.sidebar';
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function Sidebar({ open, onClose, collapsed, onToggle }) {
  const { user } = useApp();
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  // Labels for the icon-only rail; drawn outside the scrolling menu so they are not clipped.
  const [tip, setTip] = useState(null);
  const showTip = (label) => (e) => {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);
  useEffect(hideTip, [collapsed]);
  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div className="brand">
          <Link to={user.role === 'employee' ? '/my' : '/'} onClick={onClose} className="brand-link" aria-label="BrainADZ HRMS home">
            <Logo />
            <Monogram className="mono" />
          </Link>
        </div>
        <button type="button" className="collapse-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <ChevronsLeft size={16} />
        </button>
        <nav className="nav" aria-label="Main" onScroll={hideTip}>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={onClose} onMouseEnter={showTip(n.label)} onMouseLeave={hideTip} onFocus={showTip(n.label)} onBlur={hideTip}>
              <n.icon size={22} /><span className="lbl">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        {collapsed && tip && <div className="nav-tip" style={{ top: tip.top }} aria-hidden="true">{tip.label}</div>}
        <div className="leaf-card">
          <b>Great People Build Brighter Tomorrows</b>
          <i />
          <Leaves />
        </div>
      </aside>
    </>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [focus, setFocus] = useState(0);
  const dq = useDebounced(q, 220);
  const nav = useNavigate();
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  useEffect(() => {
    if (dq.trim().length < 2) return setResults([]);
    let alive = true;
    api.get(`/search?q=${encodeURIComponent(dq.trim())}`).then((r) => alive && (setResults(r.results), setFocus(0))).catch(() => {});
    return () => { alive = false; };
  }, [dq]);
  const go = (r) => {
    setOpen(false);
    setQ('');
    nav(r.link);
  };
  return (
    <div className="search" ref={ref}>
      <IconSearch size={19} />
      <input
        value={q} placeholder="Search employees, jobs, policies…" aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setFocus((f) => Math.min(results.length - 1, f + 1));
          if (e.key === 'ArrowUp') setFocus((f) => Math.max(0, f - 1));
          if (e.key === 'Enter' && results[focus]) go(results[focus]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="dropdown" style={{ left: 0, right: 'auto', width: '100%', minWidth: 300 }}>
          {results.length === 0 ? <div className="item muted">No matches</div> : results.map((r, i) => (
            <div key={`${r.type}${r.id}`} className={`item ${i === focus ? 'focus' : ''}`} onMouseDown={() => go(r)}>
              {r.type === 'Employee' ? <Avatar name={r.title} size={30} /> : <span className="badge b-blue" style={{ minWidth: 70, justifyContent: 'center' }}>{r.type}</span>}
              <div style={{ minWidth: 0 }}><div className="b6 ellipsis">{r.title}</div><div className="small muted ellipsis">{r.subtitle}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const nav = useNavigate();
  const loc = useLocation();
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  const load = useCallback(() => api.get('/notifications').then(setData).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load, loc.pathname]);
  const click = async (n) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    setOpen(false);
    load();
    if (n.link) nav(n.link);
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="icon-btn" aria-label={`Notifications (${data.unread} unread)`} onClick={() => setOpen((o) => !o)}>
        <IconBell size={24} />
        {data.unread > 0 && <span className="badge-dot">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="dropdown" style={{ width: 360 }}>
          <div className="head">Notifications {data.unread > 0 && <button type="button" className="link" onClick={async () => { await api.post('/notifications/read-all'); load(); }}><CheckCheck size={14} />Mark all read</button>}</div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {data.items.length === 0 && <div className="item muted">You're all caught up.</div>}
            {data.items.map((n) => (
              <div key={n.id} className="item" onClick={() => click(n)} style={{ alignItems: 'flex-start' }}>
                <span className="dot" style={{ background: n.read ? 'transparent' : 'var(--red)', marginTop: 6 }} />
                <div><div style={{ fontSize: 13.5, fontWeight: n.read ? 400 : 600, lineHeight: 1.4 }}>{n.text}</div><div className="xs muted mt-8" style={{ marginTop: 3 }}>{ago(n.created_at)}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChangePassword({ onClose, forced }) {
  const { toast, loadMe } = useApp();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (f.next !== f.confirm) return setErr('New passwords do not match');
    setBusy(true);
    setErr('');
    try {
      await api.post('/auth/change-password', { current: f.current, next: f.next });
      toast('Password changed', 'success');
      await loadMe();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={forced ? 'Set a new password' : 'Change password'} size="narrow" onClose={forced ? undefined : onClose}
      footer={<>{!forced && <Button onClick={onClose}>Cancel</Button>}<Button variant="primary" loading={busy} onClick={save}>Save password</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        {forced && <div className="alert info">You signed in with a temporary password. Choose your own to continue.</div>}
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 8 characters with letters and numbers"><Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        {err && <div className="error-text">{err}</div>}
      </div>
    </Modal>
  );
}

function UserMenu() {
  const { user, logout } = useApp();
  const workday = useWorkday();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const signOut = () => {
    setOpen(false);
    if (workday?.workday?.openSince) setLeaving(true);
    else logout();
  };
  const nav = useNavigate();
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="user-chip" onClick={() => setOpen((o) => !o)} aria-label="Account menu">
        {user.hasPhoto ? <Avatar name={user.name} id={user.employeeId} hasPhoto size={46} /> : <IconProfile size={46} />}
        <div className="who"><div className="nm">{user.name}</div><div className="rl">{user.designation}</div></div>
        <IconChevronDown size={18} />
      </button>
      {open && (
        <div className="dropdown" style={{ width: 240 }}>
          <div className="head" style={{ display: 'block' }}><div>{user.name}</div><div className="small muted" style={{ fontWeight: 400 }}>{user.email} · {user.role}</div></div>
          <div className="item" onClick={() => { setOpen(false); nav('/my'); }}><LayoutGrid size={16} />My Space</div>
          {user.employeeId && <div className="item" onClick={() => { setOpen(false); nav(`/employees/${user.employeeId}`); }}><User size={16} />My profile</div>}
          <div className="item" onClick={() => { setOpen(false); setPw(true); }}><KeyRound size={16} />Change password</div>
          <div className="item" style={{ color: 'var(--red)' }} onClick={signOut}><LogOut size={16} />Sign out</div>
        </div>
      )}
      {pw && <ChangePassword onClose={() => setPw(false)} />}
      {leaving && <SignOutModal onClose={() => setLeaving(false)} />}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, meta, vertical, setVertical } = useApp();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggleCollapsed = () => setCollapsed((c) => {
    try {
      localStorage.setItem(COLLAPSE_KEY, c ? 'expanded' : 'collapsed');
    } catch {
      // Storage can be blocked (private windows); the toggle still works for this visit.
    }
    return !c;
  });
  const verticals = (meta?.verticals || []).filter((v) => v.short !== 'Corporate');
  return (
    <div className="app">
      <Sidebar open={open} onClose={() => setOpen(false)} collapsed={collapsed} onToggle={toggleCollapsed} />
      <div className="main">
        <header className="topbar no-print">
          <button type="button" className="icon-btn burger" aria-label="Open menu" onClick={() => setOpen(true)}><MenuIcon size={22} /></button>
          {user.role !== 'employee' && (
            <div className="verticals">
              {verticals.map((v) => <VerticalLogo key={v.id} v={v} active={vertical === v.id} onClick={() => setVertical(vertical === v.id ? null : v.id)} />)}
            </div>
          )}
          <div className="spacer" />
          <GlobalSearch />
          <WorkClock />
          <Notifications />
          <UserMenu />
        </header>
        <main className="content">{children}</main>
      </div>
      {user.mustChangePassword && <ChangePassword forced onClose={() => {}} />}
      <SignInPrompts />
      <LocationGuard />
    </div>
  );
}
