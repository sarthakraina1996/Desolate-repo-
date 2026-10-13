import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, ListChecks, FolderKanban, CalendarDays, Images, FolderArchive, Users, Settings, Search, Bell,
  Menu as MenuIcon, LogOut, KeyRound, UserRound, ChevronDown, FileText, FolderOpen, CheckCircle2,
} from 'lucide-react';
import { useApp, useLoad } from './store.jsx';
import { useRouter, Link } from './router.jsx';
import { api } from './api.js';
import { Avatar, useClickOutside, alpha } from './ui.jsx';
import { timeAgo } from './format.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/my', label: 'My Work', icon: ListChecks, count: 'my' },
  { to: '/projects', label: 'Projects', icon: FolderKanban, count: 'projects' },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/assets', label: 'Asset Library', icon: Images },
  { to: '/archive', label: 'Past Projects', icon: FolderArchive },
  { to: '/team', label: 'Team & Access', icon: Users, admin: true },
  { to: '/settings', label: 'Settings', icon: Settings, manager: true },
];

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

function Sidebar({ open, onClose, counts }) {
  const { isAdmin, manageableVerticals } = useApp();
  const { path } = useRouter();
  const isActive = (n) => (n.exact ? path === n.to : path === n.to || path.startsWith(n.to + '/'));
  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand"><Logo /></div>
        <nav className="nav" aria-label="Main">
          {NAV.filter((n) => (!n.admin || isAdmin) && (!n.manager || isAdmin || manageableVerticals.length)).map((n) => (
            <Link key={n.to} to={n.to} className={isActive(n) ? 'active' : ''} onClick={onClose} aria-current={isActive(n) ? 'page' : undefined}>
              <n.icon size={21} strokeWidth={1.9} />
              {n.label}
              {n.count === 'my' && counts.my > 0 && (
                <span className={`count ${counts.myNew ? '' : 'seen'}`} title={counts.myNew ? `${counts.myNew} newly assigned to you` : `${counts.my} open tasks`}>{counts.my}</span>
              )}
              {n.count === 'projects' && counts.projectsNew > 0 && (
                <span className="count" title={`${counts.projectsNew} projects with something new for you`}>{counts.projectsNew}</span>
              )}
            </Link>
          ))}
        </nav>
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
    if (n.project_id) navigate(n.task_id ? `/projects/${n.project_id}/tasks/${n.task_id}` : `/projects/${n.project_id}`);
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

function UserMenu({ onSignOut }) {
  const { me, verticals } = useApp();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(close);
  const { navigate } = useRouter();
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
          <button type="button" className="item danger" role="menuitem" onClick={() => (close(), onSignOut())}><LogOut size={16} />{api.isDemo() ? 'Switch person' : 'Sign out'}</button>
        </div>
      )}
    </div>
  );
}

export function Layout({ children, onSignOut }) {
  const { verticals, vertical, setVertical, version, countsVersion, me } = useApp();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({ my: 0, myNew: 0, projectsNew: 0 });
  const { path } = useRouter();

  // Sidebar counts: red while something new is waiting, grey once you have looked.
  useEffect(() => {
    let live = true;
    Promise.all([api.get('/tasks', { assignee: 'me', scope: 'open' }), api.get('/projects')])
      .then(([t, p]) => live && setCounts({
        my: t.items.length,
        myNew: t.items.filter((x) => x.is_new).length,
        projectsNew: p.items.filter((x) => x.new_items > 0).length,
      }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [version, countsVersion, path, me.id]);

  return (
    <div className="app">
      <Sidebar open={open} onClose={() => setOpen(false)} counts={counts} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn burger" aria-label="Open menu" onClick={() => setOpen(true)}><MenuIcon size={22} /></button>
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
