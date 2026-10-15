import { useCallback, useEffect, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  House, UserPlus, Sparkles, Users, CalendarDays, CreditCard, ChartColumnIncreasing, Clock, ShieldCheck, FileText, ChartNoAxesColumn,
  Settings, Bell, Search, ChevronDown, Menu as MenuIcon, LogOut, KeyRound, User, LayoutGrid, CheckCheck, FolderOpen, CalendarRange,
} from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../lib/api.js';
import { ago } from '../lib/format.js';
import { useClickOutside, useDebounced } from '../lib/hooks.js';
import { Avatar, Button, Field, Input, Modal } from './ui.jsx';
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

const VSTYLE = { Live: '#E5243B', Marketing: '#E5243B', Exhibits: '#3C9A3A' };
export function VerticalLogo({ v, active, onClick }) {
  return (
    <button type="button" className={`vlogo ${active ? 'active' : ''}`} onClick={onClick} title={active ? `Showing ${v.name} only. Click to show all verticals.` : `Show ${v.name} only`}>
      <span className="b">BrainADZ</span>
      <span className="n" style={{ color: VSTYLE[v.short] || v.color }}>{v.short}</span>
      <span className="t">{v.tagline}</span>
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
  { to: '/', label: 'Dashboard', icon: House, roles: ['admin', 'hr', 'manager'], end: true },
  { to: '/my', label: 'My Space', icon: LayoutGrid, roles: ['employee', 'manager'] },
  { to: '/hiring', label: 'Hiring', icon: UserPlus, roles: ['admin', 'hr', 'manager'] },
  { to: '/screener', label: 'Resume Screener AI', icon: Sparkles, roles: ['admin', 'hr'] },
  { to: '/employees', label: 'Employees', icon: Users },
  { to: '/documents', label: 'Documents', icon: FolderOpen },
  { to: '/leave', label: 'Leave & Policies', icon: CalendarDays },
  { to: '/calendar', label: 'Holiday Calendar', icon: CalendarRange },
  { to: '/payroll', label: 'Payroll', icon: CreditCard, roles: ['admin', 'hr'] },
  { to: '/performance', label: 'Performance', icon: ChartColumnIncreasing },
  { to: '/attendance', label: 'Attendance', icon: Clock },
  { to: '/posh', label: 'POSH', icon: ShieldCheck },
  { to: '/resignation', label: 'Resignation', icon: FileText },
  { to: '/reports', label: 'Reports', icon: ChartNoAxesColumn, roles: ['admin', 'hr'] },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ['admin', 'hr'] },
];

function Sidebar({ open, onClose }) {
  const { user } = useApp();
  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));
  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><Link to={user.role === 'employee' ? '/my' : '/'} onClick={onClose} style={{ textDecoration: 'none' }}><Logo /></Link></div>
        <nav className="nav" aria-label="Main">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={onClose}>
              <n.icon size={21} strokeWidth={1.9} />{n.label}
            </NavLink>
          ))}
        </nav>
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
      <Search size={18} />
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
        <Bell size={22} />
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
        <Avatar name={user.name} id={user.employeeId} hasPhoto={user.hasPhoto} size={46} />
        <div className="who"><div className="nm">{user.name}</div><div className="rl">{user.designation}</div></div>
        <ChevronDown size={18} className="muted" />
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
  const verticals = (meta?.verticals || []).filter((v) => v.short !== 'Corporate');
  return (
    <div className="app">
      <Sidebar open={open} onClose={() => setOpen(false)} />
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
