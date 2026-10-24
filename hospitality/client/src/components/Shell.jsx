// Application shell: fixed top header with the BrainADZ brand, horizontal module navigation
// (Dashboard first; items that do not fit go to "More"), property scope, business date,
// online / sync indicator, search and the user menu. There is no left sidebar by design.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Building2, CalendarDays, ChevronDown, CloudOff, KeyRound, LogOut, ScrollText, Settings, ShieldCheck, Wifi } from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../lib/api.js';
import { date, initials } from '../lib/format.js';
import { Monogram, Wordmark } from './Brand.jsx';
import { Menu, Toasts } from './ui.jsx';
import { WEB_DEMO } from '../lib/env.js';

// Navigation order is fixed by the product brief; permission decides visibility.
export const NAV = [
  { key: 'dashboard', label: 'Dashboard', to: '/', perm: 'dashboard.view' },
  { key: 'reservations', label: 'Reservations', to: '/reservations', perm: 'reservations.view' },
  { key: 'calendar', label: 'Calendar', to: '/calendar', perm: 'reservations.view' },
  { key: 'frontdesk', label: 'Front Desk', to: '/front-desk', perm: 'reservations.view' },
  { key: 'rooms', label: 'Rooms', to: '/rooms', perm: 'rooms.view' },
  { key: 'housekeeping', label: 'Housekeeping', to: '/housekeeping', perm: 'housekeeping.view' },
  { key: 'guests', label: 'Guests', to: '/guests', perm: 'guests.view' },
  { key: 'revenue', label: 'Revenue', to: '/revenue', perm: 'rates.view' },
  { key: 'channels', label: 'Channel Manager', to: '/channels', perm: 'rates.view', planned: true },
  { key: 'pos', label: 'POS & F&B', to: '/pos', perm: 'dashboard.view', planned: true },
  { key: 'finance', label: 'Finance', to: '/finance', perm: ['finance.view', 'folio.view'] },
  { key: 'inventory', label: 'Inventory', to: '/inventory', perm: 'dashboard.view', planned: true },
  { key: 'operations', label: 'Operations', to: '/operations', perm: 'dashboard.view', planned: true },
  { key: 'reports', label: 'Reports', to: '/reports', perm: 'reports.view' },
  { key: 'multiproperty', label: 'Multi-Property', to: '/portfolio', perm: 'dashboard.financial', multi: true },
];

const allowed = (item, can, properties) =>
  (Array.isArray(item.perm) ? item.perm.some(can) : can(item.perm)) && (!item.multi || properties.length > 1);

function useSyncStatus() {
  const [s, setS] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get('/system/status')
        .then((x) => alive && setS(x))
        .catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return s;
}

export function Shell({ children }) {
  const { user, properties, can, scope, setScope, property, opProperty, online, setSession } = useApp();
  const nav = useMemo(() => NAV.filter((n) => allowed(n, can, properties)), [can, properties]);
  const navRef = useRef(null);
  const [fit, setFit] = useState(nav.length);
  const loc = useLocation();
  const navigate = useNavigate();
  const sync = useSyncStatus();
  const [q, setQ] = useState('');

  // Fit as many module links as the header allows; the rest go into "More".
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const measure = () => {
      const avail = el.clientWidth - 70;
      let used = 0;
      let n = 0;
      for (const item of nav) {
        const w = item.label.length * 7.4 + 26;
        if (used + w > avail) break;
        used += w;
        n++;
      }
      setFit(n === nav.length ? n : Math.max(1, n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nav]);

  const shown = nav.slice(0, fit);
  const more = nav.slice(fit);
  const moreActive = more.some((m) => (m.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(m.to)));
  const signOut = async () => {
    await api.post('/auth/logout').catch(() => {});
    setSession(null);
    navigate('/');
  };
  const bizDate = (property || opProperty)?.business_date;
  const pending = sync?.sync?.pending ?? 0;

  return (
    <>
      <header className="header">
        <NavLink to="/" className="brand" aria-label="BrainADZ Hospitality OS — Dashboard">
          <span className="brand-mark">
            <Monogram size={20} />
          </span>
          <span className="brand-text">
            <Wordmark height={13} />
            <span className="brand-product">Hospitality OS</span>
          </span>
        </NavLink>
        <nav className="nav" ref={navRef} aria-label="Modules">
          {shown.map((n) => (
            <NavLink key={n.key} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')} title={n.planned ? `${n.label} — planned module` : undefined}>
              {n.label}
              {n.planned && <span className="planned-dot" aria-label="planned" />}
            </NavLink>
          ))}
          {more.length > 0 && (
            <Menu
              align="left"
              items={more.map((m) => ({ label: `${m.label}${m.planned ? ' (planned)' : ''}`, onClick: () => navigate(m.to) }))}
              button={({ toggle, open }) => (
                <button className={`nav-more ${moreActive ? 'active' : ''}`} onClick={toggle} aria-expanded={open} style={moreActive ? { background: 'var(--primary)', color: '#fff' } : undefined}>
                  More <ChevronDown size={14} />
                </button>
              )}
            />
          )}
        </nav>
        <div className="header-tools">
          <span className={`conn ${online ? '' : 'offline'}`} title={online ? 'Connected to the Hospitality OS server' : 'Offline — changes cannot be saved'}>
            <span className="pip" />
            {online ? <Wifi size={12} /> : <CloudOff size={12} />}
            <span className="hide-md">{online ? 'Online' : 'Offline'}</span>
          </span>
          <Menu
            items={[
              { heading: `${user.name} · ${user.roleLabel}` },
              { label: 'Profile & two-step sign-in', icon: KeyRound, onClick: () => navigate('/settings/profile') },
              can('property.manage') || can('users.manage') ? { label: 'Settings', icon: Settings, onClick: () => navigate('/settings') } : null,
              can('audit.view') ? { label: 'Audit trail', icon: ScrollText, onClick: () => navigate('/settings/audit') } : null,
              { label: 'System status', icon: ShieldCheck, onClick: () => navigate('/settings/system') },
              '-',
              { label: 'Sign out', icon: LogOut, onClick: signOut },
            ]}
            button={({ toggle }) => (
              <button className="icon-btn" onClick={toggle} aria-label="Account menu" style={{ width: 'auto', padding: '0 4px' }}>
                <span className="avatar">{initials(user.name)}</span>
              </button>
            )}
          />
        </div>
      </header>
      <div className="contextbar">
        {properties.length > 1 ? (
          <label className="row" style={{ gap: 6 }}>
            <Building2 size={15} className="muted" aria-hidden />
            <span className="sr-only">Property</span>
            <select className="select ctx-select" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All properties ({properties.length})</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.city}
                </option>
              ))}
            </select>
          </label>
        ) : (
          properties[0] && (
            <span className="row strong" style={{ gap: 6 }}>
              <Building2 size={15} className="muted" aria-hidden />
              {properties[0].name}
            </span>
          )
        )}
        {bizDate && (
          <span className="chip" title="Business date: the hotel day being traded, advanced only by the night audit">
            <CalendarDays size={14} aria-hidden />
            Business date <b>{date(bizDate)}</b>
            {!property && properties.length > 1 && <span className="faint">({(opProperty || {}).code})</span>}
          </span>
        )}
        <span className="small muted hide-md" title="Changes recorded locally and queued for head-office synchronisation (transport arrives in Phase 7)">
          {pending ? `${pending} change(s) queued for HQ sync` : 'Local data up to date'}
        </span>
        <div className="spacer" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) navigate(`/reservations?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <label className="sr-only" htmlFor="global-search">
            Search reservations and guests
          </label>
          <input id="global-search" className="input search" placeholder="Search guest, booking or room…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        </form>
      </div>
      {user.isDemo && (
        <div className="demo-ribbon">
          Demo environment — {user.orgName}. All properties, guests, companies and figures are fictional, generated by a simulation of
          {WEB_DEMO ? ' recent operations. This web demo runs entirely in your browser; changes last until you reload the page.' : ' a year of operations.'}
        </div>
      )}
      {!online && <div className="offline-banner">You are offline. Viewing is limited and changes cannot be saved until the connection returns.</div>}
      <main className="page">{children}</main>
      <Toasts />
    </>
  );
}

