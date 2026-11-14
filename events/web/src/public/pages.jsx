// The visitor app (home, explore, agenda, tickets) as it looks on a phone, with a top bar and
// a four-tab bar; on wide screens the tabs move into the top bar. Also registration, the
// browser pass, the hosted-checkout demo page, sign-in and "my tickets".
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Accessibility,
  Bookmark,
  CalendarDays,
  ChevronRight,
  CircleX,
  Clock,
  Compass,
  CreditCard,
  DoorOpen,
  ExternalLink,
  Hourglass,
  House,
  LogOut,
  Map as MapIcon,
  MapPin,
  Megaphone,
  Search,
  Store,
  Sun,
  Ticket,
} from 'lucide-react';
import { del, get, goTo, post, put } from '../api.js';
import logo from '../assets/brainadz-live.png';
import { useMe } from '../App.jsx';
import { Dialog, Field, Loaded, Loading, Notice, useAction, useImage, useLoad } from '../ui.jsx';
import { AgendaList, HallPlan, PassCard, trackColour } from '../components.jsx';
import { dateRange, inr, nowHM, ROLE_LABELS, shortDay, todayISO } from '../format.js';

// ---------- app frame ----------
const initialsOf = (u) =>
  (u.name || u.email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

// Top bar: the BrainADZ Live mark, the event's sections on wide screens, and the account button.
function AppBar({ home, nav }) {
  const { me } = useMe();
  return (
    <header className="appbar">
      <div className="in">
        <Link to={home} className="brand" aria-label="BrainADZ Live home">
          <img src={logo} alt="BrainADZ Live" width="72" height="34" />
        </Link>
        {nav || <span className="grow" />}
        {me.user ? (
          <Link className="avatar" to="/account" aria-label={`My account, ${me.user.email}`}>
            {initialsOf(me.user)}
          </Link>
        ) : (
          <Link className="btn sm" to="/signin">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

const TABS = [
  ['home', 'Home', House, ''],
  ['explore', 'Explore', Compass, '/exhibitors'],
  ['agenda', 'Agenda', CalendarDays, '/agenda'],
  ['tickets', 'Tickets', Ticket, '/tickets'],
];
const tabFor = (path) =>
  path.startsWith('/account') || path.startsWith('/p/') || path.endsWith('/tickets')
    ? 'tickets'
    : /\/(exhibitors|map)$/.test(path)
      ? 'explore'
      : path.endsWith('/agenda')
        ? 'agenda'
        : 'home';

// The visitor app frame. With an event, the four tabs (bottom bar on phones, top bar on wide
// screens) lead to that event's home, explore, agenda and tickets.
export function AppFrame({ slug, event, children }) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  const active = tabFor(pathname);
  const tabs = slug ? TABS.map(([key, label, Icon, path]) => ({ key, label, Icon, to: `/e/${slug}${path}` })) : null;
  const here = (key) => (active === key ? { className: 'active', 'aria-current': 'page' } : {});
  return (
    <>
      <div className="app">
        <AppBar
          home={slug ? `/e/${slug}` : '/'}
          nav={
            tabs && (
              <nav className="app-nav" aria-label="Event">
                {tabs.map((t) => (
                  <Link key={t.key} to={t.to} {...here(t.key)}>
                    {t.label}
                  </Link>
                ))}
              </nav>
            )
          }
        />
        <main id="main" className="app-main">
          {children}
        </main>
        <SiteFooter event={event} />
      </div>
      {tabs && (
        <nav className="app-tabs no-print" aria-label="Event">
          {tabs.map(({ key, label, Icon, to }) => (
            <Link key={key} to={to} {...here(key)}>
              <Icon className="icon" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
// Red band at the foot of wide screens, like the booklet's contact strip.
function SiteFooter({ event }) {
  return (
    <footer className="site-foot no-print">
      <div className="in">
        {event ? (
          <>
            <span>{event.name}</span>
            <span>
              {dateRange(event.startsOn, event.endsOn)} · {event.openTime}–{event.closeTime}
            </span>
            <span>{[event.venueName, event.city].filter(Boolean).join(', ')}</span>
          </>
        ) : (
          <span>BrainADZ Live · From Vision to Visibility</span>
        )}
      </div>
    </footer>
  );
}
// A standalone page outside any event (the demo checkout, an expired ticket link).
export function PublicPage({ children }) {
  return (
    <AppFrame>
      <div className="narrow stack">{children}</div>
    </AppFrame>
  );
}

// ---------- event app ----------
const EventCtx = createContext(null);
const useEvent = () => useContext(EventCtx);

// The first page: the sign-in page. Signed-in people go straight to their tickets or workspace.
export function Home() {
  const { me } = useMe();
  if (me.user) return <Navigate to={homeFor(me)} replace />;
  return <SignIn />;
}

export function EventSite() {
  const { slug } = useParams();
  const load = useLoad(() => get(`/public/events/${slug}/guide`), [slug]);
  return (
    <Loaded load={load}>
      {(guide) => (
        <EventCtx.Provider value={{ guide, base: `/e/${slug}`, slug }}>
          <AppFrame slug={slug} event={guide.event}>
            <Outlet />
          </AppFrame>
        </EventCtx.Provider>
      )}
    </Loaded>
  );
}

// "Starts in 12 days", "Open now · until 18:00" and so on, at the venue's local time.
function eventStatus(e) {
  const today = todayISO();
  const now = nowHM();
  if (today > e.endsOn) return 'This edition has ended';
  if (today < e.startsOn) {
    const days = Math.round((new Date(e.startsOn) - new Date(today)) / 86400000);
    return days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`;
  }
  if (now < e.openTime) return `Opens today at ${e.openTime}`;
  if (now < e.closeTime) return `Open now · until ${e.closeTime}`;
  return today < e.endsOn ? `Closed for today · opens ${e.openTime} tomorrow` : 'Closed · final day';
}
// The next sessions still to come.
function upNext(agenda, n = 3) {
  const today = todayISO();
  const now = nowHM();
  return agenda.sessions
    .filter((s) => s.status === 'scheduled' && (s.day > today || (s.day === today && s.endTime > now)))
    .sort((a, b) => (a.day + a.startTime).localeCompare(b.day + b.startTime))
    .slice(0, n);
}

function Section({ title, action, children }) {
  return (
    <section className="block" aria-label={title}>
      <div className="block-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
// One row of a grouped list: optional icon, title, a line of detail, optional chevron.
function Row({ icon: Icon, title, detail, chevron, children }) {
  return (
    <>
      {Icon && (
        <span className="row-icon">
          <Icon aria-hidden="true" />
        </span>
      )}
      <span className="grow">
        <strong>{title}</strong>
        {detail && <span className="detail">{detail}</span>}
      </span>
      {children}
      {chevron && <ChevronRight className="icon chev" aria-hidden="true" />}
    </>
  );
}

export function Landing() {
  const { guide, base } = useEvent();
  const { me } = useMe();
  const e = guide.event;
  const photo = useImage(e.loginImage);
  const next = upNext(guide.agenda);
  const where = [e.venueName, e.city].filter(Boolean).join(', ');
  const halls = guide.halls.filter((h) => h.cols > 0).length;
  const NOTE_ICON = { schedule: CalendarDays, gate: DoorOpen };
  return (
    <div className="stack loose">
      <section
        className={`hero-card ${photo ? 'has-photo' : ''}`}
        style={photo ? { backgroundImage: `linear-gradient(180deg, rgba(14,22,48,0.2), rgba(14,22,48,0.88)), url(${photo})` } : undefined}
      >
        <span className="hero-status">{eventStatus(e)}</span>
        <h1>{e.name}</h1>
        {e.tagline && <p className="hero-tagline">{e.tagline}</p>}
        <div className="hero-facts">
          <span>
            <CalendarDays className="icon" aria-hidden="true" />
            {dateRange(e.startsOn, e.endsOn)} · {e.openTime}–{e.closeTime}
          </span>
          {where && (
            <span>
              <MapPin className="icon" aria-hidden="true" />
              {where}
            </span>
          )}
        </div>
        <div className="hero-actions">
          <Link className="btn hero-primary" to={`${base}/register`}>
            Get your pass
          </Link>
          <Link className="btn hero-ghost" to={`${base}/tickets`}>
            {me.user ? 'My ticket' : 'Find my ticket'}
          </Link>
        </div>
      </section>

      <nav className="quick" aria-label="Shortcuts">
        <QuickLink to={`${base}/exhibitors`} icon={Store} label="Exhibitors" sub={`${guide.exhibitorCount} companies`} />
        <QuickLink to={`${base}/map`} icon={MapIcon} label="Floor plan" sub={halls === 1 ? '1 hall' : `${halls} halls`} />
        <QuickLink to={`${base}/agenda`} icon={CalendarDays} label="Agenda" sub={`${guide.sessionCount} sessions`} />
        <QuickLink to={`${base}/tickets`} icon={Ticket} label="Ticket" sub={me.user ? 'Show at the gate' : 'Register or find'} />
      </nav>

      {guide.announcements.length > 0 && (
        <Section title="Updates">
          <div className="group">
            {guide.announcements.map((a) => (
              <div key={a.id} className="row-item">
                <Row icon={NOTE_ICON[a.kind] || Megaphone} title={a.title} detail={a.body} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {next.length > 0 && (
        <Section title="Up next" action={<Link to={`${base}/agenda`}>Full agenda</Link>}>
          <div className="group">
            {next.map((s) => (
              <Link
                key={s.id}
                to={`${base}/agenda?day=${s.day}`}
                className="session"
                style={{ '--track': trackColour(guide.agenda, s.trackId) }}
              >
                <div className="session-time num">
                  <strong>{s.startTime}</strong>
                  <span>{shortDay(s.day)}</span>
                </div>
                <div className="grow">
                  <div className="session-title">{s.title}</div>
                  <div className="muted small">{[s.room, s.track].filter(Boolean).join(' · ')}</div>
                </div>
                <ChevronRight className="icon chev" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </Section>
      )}

      {e.description && (
        <Section title="About">
          <p className="about">{e.description}</p>
        </Section>
      )}

      <Section title="Passes">
        <div className="group">
          {guide.passClasses.map((c) => (
            <Link key={c.code} className="row-item" to={`${base}/register?pass=${c.code}`}>
              <Row title={c.name} detail={c.soldOut ? 'Fully booked' : c.description} chevron>
                <span className="price">{c.mode === 'invited' ? 'Invite' : c.priceLabel}</span>
              </Row>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="Plan your visit">
        <div className="group">
          <div className="row-item">
            <Row icon={Clock} title={`${e.openTime}–${e.closeTime} daily`} detail={dateRange(e.startsOn, e.endsOn)} />
          </div>
          <div className="row-item">
            <Row icon={MapPin} title={e.venueName} detail={e.venueAddress} />
          </div>
          {guide.accessibility && (
            <div className="row-item">
              <Row icon={Accessibility} title="Accessibility" detail={guide.accessibility} />
            </div>
          )}
          {guide.features.exhibitors && (
            <Link className="row-item" to={`${base}/exhibit`}>
              <Row icon={Store} title="Exhibit with us" detail="Apply for a stand" chevron />
            </Link>
          )}
        </div>
      </Section>

      {guide.faqs.length > 0 && (
        <Section title="Questions">
          <div className="group">
            {guide.faqs.map((f) => (
              <details key={f.q} className="faq">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
function QuickLink({ to, icon: Icon, label, sub }) {
  return (
    <Link className="quick-link" to={to}>
      <span className="quick-icon">
        <Icon aria-hidden="true" />
      </span>
      <span>
        <strong>{label}</strong>
        <span className="detail">{sub}</span>
      </span>
    </Link>
  );
}

// ---------- explore: exhibitors and floor plan ----------
function ExploreHead() {
  const { base } = useEvent();
  const map = useLocation().pathname.endsWith('/map');
  return (
    <>
      <h1 className="page-title">Explore</h1>
      <div className="seg wide" role="group" aria-label="Explore">
        <Link to={`${base}/exhibitors`} replace aria-current={map ? undefined : 'page'}>
          Exhibitors
        </Link>
        <Link to={`${base}/map`} replace aria-current={map ? 'page' : undefined}>
          Floor plan
        </Link>
      </div>
    </>
  );
}

// A company's initials on a tint of a colour picked from its name, in place of a logo.
const MONO = ['#233e85', '#c82026', '#0f766e', '#b45309', '#6d28d9', '#0369a1', '#be185d', '#4d7c0f'];
function Monogram({ name, big }) {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(' ')
    .filter(Boolean);
  const text = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span className={`monogram ${big ? 'big' : ''}`} style={{ '--c': MONO[h % MONO.length] }} aria-hidden="true">
      {text}
    </span>
  );
}

function ExhibitorSheet({ ex, onClose, showMap = true }) {
  const { base } = useEvent();
  return (
    <Dialog title={ex.name} onClose={onClose} sheet>
      <div className="stack">
        <div className="row">
          <Monogram name={ex.name} big />
          <div className="grow">
            <strong>{ex.boothCode ? `Stall ${ex.boothCode}` : 'Stall to be announced'}</strong>
            <div className="muted small">{[ex.hall, ex.industry].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        {ex.description && <p>{ex.description}</p>}
        {ex.categories.length > 0 && (
          <div className="tags">
            {ex.categories.map((c) => (
              <span key={c} className="tag">
                {c}
              </span>
            ))}
          </div>
        )}
        {showMap && ex.boothId && (
          <Link className="btn primary block" to={`${base}/map?booth=${ex.boothId}`}>
            <MapIcon className="icon" aria-hidden="true" />
            Show on floor plan
          </Link>
        )}
        {(ex.website || ex.catalogueLinks.length > 0) && (
          <div className="group">
            {[...(ex.website ? [{ label: 'Website', url: ex.website }] : []), ...ex.catalogueLinks].map((l) => (
              <a key={l.url} className="row-item" href={l.url} target="_blank" rel="noreferrer">
                <span className="grow">{l.label}</span>
                <ExternalLink className="icon chev" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function Directory() {
  const { guide } = useEvent();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState(null);
  const cats = useMemo(() => [...new Set(guide.exhibitors.flatMap((e) => e.categories))].sort(), [guide]);
  const rows = guide.exhibitors
    .filter(
      (e) =>
        (!cat || e.categories.includes(cat)) &&
        (!q || [e.name, e.boothCode, e.industry, ...e.categories].some((v) => v && v.toLowerCase().includes(q.toLowerCase()))),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const ex = guide.exhibitors.find((e) => e.id === open);
  return (
    <div className="stack">
      <ExploreHead />
      <div className="search">
        <Search className="icon" aria-hidden="true" />
        <input
          className="input"
          type="search"
          placeholder="Company, stall or product"
          aria-label="Search exhibitors"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {cats.length > 0 && (
        <div className="chips scroll" role="group" aria-label="Product category">
          <button className="chip" aria-pressed={!cat} onClick={() => setCat('')}>
            All
          </button>
          {cats.map((c) => (
            <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? '' : c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <p className="muted small" role="status">
        {rows.length === guide.exhibitors.length ? `${rows.length} exhibitors` : `${rows.length} of ${guide.exhibitors.length} exhibitors`}
      </p>
      {rows.length ? (
        <div className="group">
          {rows.map((e) => (
            <button key={e.id} className="row-item" onClick={() => setOpen(e.id)}>
              <Monogram name={e.name} />
              <Row title={e.name} detail={e.industry || e.categories.join(', ')} chevron>
                {e.boothCode && <span className="stall-code">{e.boothCode}</span>}
              </Row>
            </button>
          ))}
        </div>
      ) : (
        <p className="empty">No exhibitors match. Try a different search.</p>
      )}
      {ex && <ExhibitorSheet ex={ex} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function MapPage() {
  const { guide } = useEvent();
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState(false);
  const selected = Number(params.get('booth')) || null;
  const ex = selected ? guide.exhibitors.find((e) => e.boothId === selected) : null;
  return (
    <div className="stack">
      <ExploreHead />
      <HallPlan
        zoomable
        halls={guide.halls}
        selected={selected}
        onSelect={(b) => {
          setParams(b.exhibitorId ? { booth: b.id } : {}, { replace: true });
          setSheet(Boolean(b.exhibitorId));
        }}
      />
      {ex ? (
        <div className="group">
          <button className="row-item" onClick={() => setSheet(true)}>
            <Monogram name={ex.name} />
            <Row title={ex.name} detail={`Stall ${ex.boothCode}${ex.hall ? ` · ${ex.hall}` : ''}`} chevron />
          </button>
        </div>
      ) : (
        <p className="muted small">Tap a stall to see who is there. Zoom in for a closer look.</p>
      )}
      {ex && sheet && <ExhibitorSheet ex={ex} showMap={false} onClose={() => setSheet(false)} />}
    </div>
  );
}

export function AgendaPage() {
  const { guide, base } = useEvent();
  const { me } = useMe();
  const [params, setParams] = useSearchParams();
  const [track, setTrack] = useState(null);
  const [mine, setMine] = useState(false);
  const days = useMemo(() => [...new Set(guide.agenda.sessions.filter((s) => s.status === 'scheduled').map((s) => s.day))].sort(), [guide]);
  const today = todayISO();
  const asked = params.get('day');
  const day = days.includes(asked) ? asked : days.includes(today) ? today : days[0];
  const marks = useLoad(() => (me.user ? get('/me/bookmarks') : Promise.resolve([])), [me.user?.id]);
  const act = useAction();
  const toggle = (s, on) => act(() => (on ? put(`/me/bookmarks/${s.id}`) : del(`/me/bookmarks/${s.id}`)).then(marks.reload));
  const agenda = mine ? { ...guide.agenda, sessions: guide.agenda.sessions.filter((s) => marks.data?.includes(s.id)) } : guide.agenda;
  return (
    <div className="stack">
      <h1 className="page-title">Agenda</h1>
      {days.length > 1 && (
        <div className="seg wide" role="group" aria-label="Day">
          {days.map((d) => (
            <button key={d} aria-pressed={d === day} onClick={() => setParams({ day: d }, { replace: true })}>
              {shortDay(d)}
            </button>
          ))}
        </div>
      )}
      <div className="chips scroll" role="group" aria-label="Track">
        <button className="chip" aria-pressed={!track && !mine} onClick={() => (setTrack(null), setMine(false))}>
          All
        </button>
        {guide.agenda.tracks.map((t) => (
          <button key={t.id} className="chip" aria-pressed={track === t.id} onClick={() => (setTrack(t.id), setMine(false))}>
            <span className="dot" style={{ background: trackColour(guide.agenda, t.id) }} aria-hidden="true" />
            {t.name}
          </button>
        ))}
        {me.user && (
          <button className="chip" aria-pressed={mine} onClick={() => (setMine(!mine), setTrack(null))}>
            <Bookmark className="icon" aria-hidden="true" />
            Saved
          </button>
        )}
      </div>
      {!me.user && (
        <p className="muted small">
          <Link to={`/signin?next=${base}/agenda`}>Sign in</Link> to save sessions to your plan.
        </p>
      )}
      <AgendaList agenda={agenda} days={day ? [day] : []} track={track} bookmarks={marks.data || []} onToggle={me.user ? toggle : null} />
    </div>
  );
}

// ---------- tickets ----------
// The visitor's tickets: badges and registrations, optionally for one event only.
function MyTickets({ slug, empty }) {
  const load = useLoad(() => get('/me/passes'));
  const act = useAction();
  return (
    <Loaded load={load}>
      {(d) => {
        const badges = d.badges.filter((b) => !slug || b.event.slug === slug);
        const regs = d.registrations.filter((r) => !slug || r.event.slug === slug);
        if (!badges.length && !regs.length) return empty;
        return (
          <div className="stack loose">
            {badges.map((b) => (
              <PassCard key={`b${b.id}`} pass={b} />
            ))}
            {regs.map((r) => (
              <section key={r.id} aria-label={`${r.passClass.name}, ${r.event.name}`}>
                <RegistrationState
                  state={r}
                  returnPath={slug ? `/e/${slug}/tickets` : '/account'}
                  onCancel={() => act(() => post(`/me/registrations/${r.id}/cancel`).then(load.reload), 'Registration cancelled')}
                />
              </section>
            ))}
          </div>
        );
      }}
    </Loaded>
  );
}
function NoTickets({ base, eventName, signedIn }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Ticket aria-hidden="true" />
      </span>
      <h2>{signedIn ? 'No ticket yet' : 'Your ticket lives here'}</h2>
      <p className="muted">
        {signedIn
          ? `Register for ${eventName} and your ticket appears here, ready to show at the gate.`
          : `Register for ${eventName}, or sign in with the email you registered with. Show your ticket at the gate to get in.`}
      </p>
      <div className="stack tight">
        <Link className="btn primary big block" to={`${base}/register`}>
          Get your pass
        </Link>
        {!signedIn && (
          <Link className="btn big block" to={`/signin?next=${base}/tickets`}>
            Sign in
          </Link>
        )}
        <Link className="btn plain" to={`${base}/register?find=1`}>
          Lost your ticket link?
        </Link>
      </div>
    </div>
  );
}
export function EventTickets() {
  const { guide, base, slug } = useEvent();
  const { me } = useMe();
  const none = <NoTickets base={base} eventName={guide.event.name} signedIn={Boolean(me.user)} />;
  return (
    <div className="narrow stack">
      <h1 className="page-title">Tickets</h1>
      {me.user ? <MyTickets slug={slug} empty={none} /> : none}
    </div>
  );
}

// ---------- registration ----------
// Single-column form with persistent labels, inline errors, a visible privacy notice and a
// completion step that reflects pass, review or payment.
export function Register() {
  const { guide, slug, base } = useEvent();
  const { refresh } = useMe();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const open = guide.passClasses.filter((c) => !c.soldOut);
  const [form, setForm] = useState({
    passClass: (open.find((c) => c.code === params.get('pass')) || open[0])?.code || '',
    name: '',
    email: '',
    phone: '',
    company: '',
    jobTitle: '',
    inviteCode: '',
    consent: false,
    leadOptOut: false,
    answers: {},
  });
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(params.get('find') ? 'find' : 'form');
  const [pending, setPending] = useState(null); // { ref, email, demoCode }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cls = guide.passClasses.find((c) => c.code === form.passClass);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const cta = !cls
    ? 'Register'
    : cls.mode === 'approval'
      ? 'Submit for review'
      : cls.pricePaise
        ? 'Continue to payment'
        : `Get ${cls.name.toLowerCase()} pass`;

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = 'Enter your full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a work email address, like name@company.com';
    if (cls?.mode === 'invited' && !form.inviteCode.trim()) errs.inviteCode = 'Enter the code from your invitation';
    for (const f of guide.formFields)
      if (f.required && !form.answers[f.key]) errs[f.key] = f.type === 'checkbox' ? 'Tick this box to continue' : 'Choose an answer';
    if (!form.consent) errs.consent = 'Accept the privacy notice to register';
    setErrors(errs);
    if (Object.keys(errs).length) return document.querySelector('[aria-invalid="true"]')?.focus();
    setBusy(true);
    setError(null);
    try {
      setPending(await post(`/public/events/${slug}/registrations`, form));
      setStep('code');
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await post(`/public/events/${slug}/registrations/${pending.ref}/verify`, { code });
      await refresh();
      nav(`/p/${out.accessToken}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (step === 'find') return <FindPass slug={slug} onBack={() => setStep('form')} />;
  if (step === 'code')
    return (
      <form className="narrow stack" onSubmit={verify}>
        <h1 className="page-title">Check your email</h1>
        <p>
          We sent a 6-digit code to <strong>{pending.email}</strong>. Enter it to confirm the address is yours.
        </p>
        {pending.demoCode && (
          <Notice tone="pending">
            <span className="demo-tag">Demo</span> No email is sent by the local email adapter. Your code is{' '}
            <strong>{pending.demoCode}</strong>.
          </Notice>
        )}
        <Field label="6-digit code" error={error}>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus
            style={{ fontSize: 24, letterSpacing: '0.3em' }}
          />
        </Field>
        <button className="btn primary big block" disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Confirm'}
        </button>
        <button
          type="button"
          className="btn plain"
          onClick={() =>
            post(`/public/events/${slug}/registrations/${pending.ref}/resend-code`)
              .then((o) => setPending({ ...pending, demoCode: o.demoCode }))
              .catch((er) => setError(er.message))
          }
        >
          Send a new code
        </button>
      </form>
    );
  return (
    <form className="narrow stack" onSubmit={submit} noValidate>
      <h1 className="page-title">Get your pass</h1>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 4 }}>
          Pass type
        </legend>
        <div className="choices">
          {guide.passClasses.map((c) => (
            <label key={c.code} className="choice">
              <input
                type="radio"
                name="passClass"
                checked={form.passClass === c.code}
                disabled={c.soldOut}
                onChange={() => set('passClass', c.code)}
              />
              <span className="grow">
                <strong>{c.name}</strong>
                <br />
                <span className="muted small">{c.soldOut ? 'Fully booked' : c.description}</span>
              </span>
              <span>{c.mode === 'invited' ? 'Invitation' : c.mode === 'approval' ? 'Reviewed' : c.priceLabel}</span>
            </label>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Exhibiting instead? <Link to={`${base}/exhibit`}>Apply for a stand</Link>. Speakers are registered by the organiser.
        </p>
      </fieldset>
      {cls?.mode === 'invited' && (
        <Field label="Invitation code" error={errors.inviteCode}>
          <input
            className="input"
            value={form.inviteCode}
            onChange={(e) => set('inviteCode', e.target.value)}
            autoCapitalize="characters"
          />
        </Field>
      )}
      <Field label="Full name" hint="As it should appear on your badge" error={errors.name}>
        <input className="input" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label="Work email" hint="We send your pass here" error={errors.email}>
        <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <Field label="Mobile number (optional)">
        <input className="input" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      </Field>
      <Field label="Company (optional)">
        <input className="input" autoComplete="organization" value={form.company} onChange={(e) => set('company', e.target.value)} />
      </Field>
      <Field label="Job title (optional)">
        <input
          className="input"
          autoComplete="organization-title"
          value={form.jobTitle}
          onChange={(e) => set('jobTitle', e.target.value)}
        />
      </Field>
      {guide.formFields.map((f) =>
        f.type === 'checkbox' ? (
          <label key={f.key} className="check">
            <input
              type="checkbox"
              checked={Boolean(form.answers[f.key])}
              onChange={(e) => set('answers', { ...form.answers, [f.key]: e.target.checked })}
            />
            <span>
              {f.label}
              {errors[f.key] && (
                <span className="err" role="alert">
                  <br />
                  {errors[f.key]}
                </span>
              )}
            </span>
          </label>
        ) : (
          <Field key={f.key} label={f.label + (f.required ? '' : ' (optional)')} error={errors[f.key]}>
            {f.type === 'select' ? (
              <select
                className="input"
                value={form.answers[f.key] || ''}
                onChange={(e) => set('answers', { ...form.answers, [f.key]: e.target.value })}
              >
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                value={form.answers[f.key] || ''}
                onChange={(e) => set('answers', { ...form.answers, [f.key]: e.target.value })}
              />
            )}
          </Field>
        ),
      )}
      <div className="notice info">
        <div className="stack tight">
          <strong>How we use your details</strong>
          <span className="small">We use them to issue your pass and run the event. {guide.leadSharingNotice}</span>
          <label className="check">
            <input type="checkbox" checked={form.leadOptOut} onChange={(e) => set('leadOptOut', e.target.checked)} />
            <span className="small">Do not share my details with exhibitors, even if they scan my badge</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.consent}
              aria-invalid={errors.consent ? 'true' : undefined}
              onChange={(e) => set('consent', e.target.checked)}
            />
            <span>
              I accept this privacy notice
              {errors.consent && (
                <span className="err" role="alert">
                  <br />
                  {errors.consent}
                </span>
              )}
            </span>
          </label>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn primary big block" disabled={busy || !cls}>
        {busy ? 'Sending…' : cta}
      </button>
      <button type="button" className="btn plain" onClick={() => setStep('find')}>
        Already registered? Find my ticket
      </button>
    </form>
  );
}

function FindPass({ slug, onBack }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [error, setError] = useState(null);
  return (
    <form
      className="narrow stack"
      onSubmit={(e) => (
        e.preventDefault(),
        post(`/public/events/${slug}/pass-link`, { email })
          .then((out) => setSent(out))
          .catch((er) => setError(er.message))
      )}
    >
      <h1 className="page-title">Find my ticket</h1>
      {sent ? (
        <>
          <Notice tone="ok">If {email} is registered, a new ticket link is on its way. Earlier links stop working.</Notice>
          {sent.demoLinks?.length > 0 && (
            <Notice tone="pending">
              <span className="demo-tag">Demo</span> No email is sent in the demo. Open your ticket here:{' '}
              {sent.demoLinks.map((l) => (
                <Link key={l} to={l}>
                  {' '}
                  Open ticket
                </Link>
              ))}
            </Notice>
          )}
          {sent.demoLinks && !sent.demoLinks.length && <Notice>No ticket was found for {email}.</Notice>}
        </>
      ) : (
        <>
          <p>
            Enter the email you registered with and we will send a new link to your ticket. You can also sign in with that email to see all
            your tickets.
          </p>
          <Field label="Email" error={error}>
            <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="btn primary big block">Email me the link</button>
        </>
      )}
      {onBack && (
        <button type="button" className="btn plain" onClick={onBack}>
          Back to registration
        </button>
      )}
      <Link to="/signin">Sign in to see all your tickets</Link>
    </form>
  );
}

// ---------- registration state: pass, payment, review ----------
// A status card for a registration that has no ticket yet.
function StateCard({ tone, icon: Icon, title, sub, children }) {
  return (
    <div className={`state-card ${tone}`}>
      <div className="state-head">
        <span className="state-icon">
          <Icon aria-hidden="true" />
        </span>
        <div className="grow">
          <strong>{title}</strong>
          {sub && <div className="muted small">{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}
// One view for wherever a registration stands. Used by the pass link and "my tickets".
export function RegistrationState({ state, onCancel, returnPath }) {
  const act = useAction();
  const pay = () =>
    act(async () => {
      const out = await post(`/public/orders/${state.order.token}/checkout`, { returnPath });
      goTo(out.url);
    });
  const sub = [state.event?.name, state.passClass.name].filter(Boolean).join(' · ');
  if (state.step === 'pass')
    return (
      <div className="stack">
        {state.pass.firstAdmittedAt && <Notice tone="ok">Admitted. Keep this ticket for re-entry.</Notice>}
        <PassCard pass={state.pass} />
        <p className="tip no-print">
          <Sun className="icon" aria-hidden="true" />
          Turn your screen brightness up at the gate.
        </p>
        <div className="row between wrap no-print">
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
          {onCancel && (
            <button
              className="btn plain"
              onClick={() => window.confirm('Cancel this registration? Your pass will stop working.') && onCancel()}
            >
              Cancel registration
            </button>
          )}
        </div>
      </div>
    );
  if (state.step === 'payment')
    return (
      <StateCard tone="pending" icon={CreditCard} title="Payment needed" sub={sub}>
        <p>
          Your place is held. Your ticket is issued as soon as payment is confirmed.
          {state.paymentStatus === 'failed' && ' The last payment attempt did not go through.'}
        </p>
        <div className="totals">
          {state.order.items.map((i) => (
            <div key={i.description}>
              <span>{i.description}</span>
              <span className="num">{inr(i.amountPaise)}</span>
            </div>
          ))}
          <div>
            <span>GST</span>
            <span className="num">{inr(state.order.gstPaise)}</span>
          </div>
          <div className="strong">
            <span>Total</span>
            <span className="num">{inr(state.order.balancePaise)}</span>
          </div>
        </div>
        <button className="btn primary big block" onClick={pay}>
          Pay {inr(state.order.balancePaise)}
        </button>
        <p className="muted small">UPI or card, on a secure hosted checkout page. Order {state.order.number}.</p>
      </StateCard>
    );
  if (state.step === 'review')
    return (
      <StateCard tone="pending" icon={Hourglass} title="Awaiting review" sub={sub}>
        <p>
          The organiser reviews {state.passClass.name} registrations and will email {state.email} with a decision. Reference {state.ref}.
        </p>
      </StateCard>
    );
  return (
    <StateCard tone="error" icon={CircleX} title={state.step === 'rejected' ? 'Not approved' : 'Cancelled'} sub={sub}>
      <p>
        {state.step === 'rejected'
          ? state.reviewNote || 'The organiser could not approve this registration.'
          : 'This registration was cancelled and its pass no longer works.'}{' '}
        Reference {state.ref}.
      </p>
    </StateCard>
  );
}

// The pass retrieval link: works in any browser without the app or an account.
export function PassPage() {
  const { token } = useParams();
  const { me } = useMe();
  const load = useLoad(() => get(`/public/pass/${token}`), [token]);
  const act = useAction();
  if (load.error)
    return (
      <PublicPage>
        <FindPassFallback message={load.error.message} />
      </PublicPage>
    );
  if (!load.data) return <Loading />;
  const s = load.data;
  return (
    <AppFrame slug={s.event.slug}>
      <div className="narrow stack">
        <h1 className="page-title">{s.step === 'pass' ? 'Your ticket' : 'Your registration'}</h1>
        <RegistrationState
          state={s}
          returnPath={`/p/${token}`}
          onCancel={() => act(() => post(`/public/pass/${token}/cancel`).then(load.reload), 'Registration cancelled')}
        />
        <p className="muted small no-print">
          {me.user ? (
            <>
              Signed in as {me.user.email}. All your tickets are under <Link to="/account">My tickets</Link>, on any phone you sign in on.
            </>
          ) : (
            <>
              <Link to={`/signin?next=/p/${token}`}>Sign in</Link> with the same email to see this ticket on any phone.
            </>
          )}
        </p>
      </div>
    </AppFrame>
  );
}
function FindPassFallback({ message }) {
  const events = useLoad(() => get('/public/events'));
  return (
    <>
      <Notice tone="error">{message}</Notice>
      {events.data?.[0] && <FindPass slug={events.data[0].slug} />}
    </>
  );
}

// The local demo payment adapter's own page. Clearly labelled; no money moves.
export function Pay() {
  const { intent } = useParams();
  const [params] = useSearchParams();
  const load = useLoad(() => get(`/public/pay/${intent}`), [intent]);
  const [done, setDone] = useState(null);
  const nav = useNavigate();
  const back = params.get('return') || '/';
  const go = (outcome, method) =>
    post(`/public/pay/${intent}/simulate`, { outcome, method })
      .then(() => setDone(outcome))
      .catch(() => setDone('failed'));
  return (
    <PublicPage>
      <Loaded load={load}>
        {(p) => (
          <>
            <Notice tone="pending">
              <span className="demo-tag">Demo</span> {p.adapter}. In production this page is the payment provider's hosted checkout.
            </Notice>
            <div>
              <p className="eyebrow">
                {p.event.name} · Order {p.order.number}
              </p>
              <h1>Pay {inr(p.amountPaise)}</h1>
            </div>
            {done ? (
              <>
                <Notice tone={done === 'captured' ? 'ok' : done === 'failed' ? 'error' : 'pending'}>
                  {done === 'captured'
                    ? 'Payment successful.'
                    : done === 'failed'
                      ? 'Payment failed. You have not been charged.'
                      : 'Payment is pending with the bank.'}
                </Notice>
                <button className="btn primary big block" onClick={() => nav(back, { replace: true })}>
                  {done === 'captured' ? 'See my ticket' : 'Continue'}
                </button>
              </>
            ) : (
              <div className="stack tight">
                <button className="btn primary big block" onClick={() => go('captured', 'upi')}>
                  Pay by UPI (succeeds)
                </button>
                <button className="btn big block" onClick={() => go('captured', 'card')}>
                  Pay by card (succeeds)
                </button>
                <button className="btn big block" onClick={() => go('failed', 'card')}>
                  Simulate a failed payment
                </button>
                <button className="btn big block" onClick={() => go('pending', 'upi')}>
                  Simulate a pending payment
                </button>
                <button className="btn plain" onClick={() => nav(back, { replace: true })}>
                  Cancel and go back
                </button>
              </div>
            )}
          </>
        )}
      </Loaded>
    </PublicPage>
  );
}

// ---------- sign-in ----------
const DEMO = [
  ['organiser@futureworks.example', 'Organiser admin'],
  ['ops@futureworks.example', 'Operations'],
  ['finance@futureworks.example', 'Finance'],
  ['supervisor@futureworks.example', 'Gate supervisor'],
  ['gate1@futureworks.example', 'Gate 1 staff'],
  ['ritu@novadisplays.example', 'Exhibitor admin, Nova Displays'],
  ['karan@novadisplays.example', 'Booth staff, Nova Displays'],
];
// Where a person lands after signing in, from the roles the server reports.
// Where to go after signing in: the page someone was heading for, if this person may open it
// (a visitor signing in on a device an organiser just used must not be sent to the console).
const nextFor = (me, next) => {
  const allowed =
    next &&
    next.startsWith('/') &&
    !(next.startsWith('/org') && !me.organiser?.length) &&
    !(next.startsWith('/x/') && !me.exhibitor?.length) &&
    !(next.startsWith('/gate') && !me.gate?.length);
  return allowed ? next : homeFor(me);
};
export const homeFor = (me) =>
  me.organiser?.length ? '/org' : me.exhibitor?.length ? `/x/${me.exhibitor[0].exhibitorId}` : me.gate?.length ? '/gate' : '/account';

// The exhibition shown on the sign-in page: the one on now or next, else the latest.
function featuredEvent(events) {
  const today = new Date().toISOString().slice(0, 10);
  return events.find((e) => e.endsOn >= today) || events[events.length - 1] || null;
}

// Sign-in page, full screen over the exhibition's own background photo. With no photo set
// the BrainADZ Live navy and red background is used.
export function SignIn() {
  const { me, config, refresh } = useMe();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const events = useLoad(() => get('/public/events'));
  const event = events.data ? featuredEvent(events.data) : null;
  const bg = useImage(event?.loginImage);
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState('code'); // code | password
  const [sent, setSent] = useState(null);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const done = async () => {
    const m = await refresh();
    nav(nextFor(m, params.get('next')), { replace: true });
  };
  useEffect(() => {
    if (me.user) nav(nextFor(me, params.get('next')), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  const submit = (e) => {
    e.preventDefault();
    if (mode === 'password') return run(() => post('/auth/login', { email, password: secret }).then(done));
    if (!sent) return run(() => post('/auth/code', { email }).then(setSent));
    return run(() => post('/auth/code/verify', { email, code: secret }).then(done));
  };
  return (
    <div className="login" style={bg ? { '--login-photo': `url("${bg}")` } : undefined}>
      <div className="login-in">
        <section className="login-event" aria-label="Exhibition">
          {event ? (
            <>
              <p className="login-when">
                {dateRange(event.startsOn, event.endsOn)} · {event.openTime}–{event.closeTime}
              </p>
              <h1>{event.name}</h1>
              {event.tagline && <p className="login-tag">{event.tagline}</p>}
              <p className="login-where">{[event.venueName, event.city].filter(Boolean).join(', ')}</p>
            </>
          ) : (
            <h1>BrainADZ Events</h1>
          )}
        </section>
        <main id="main" className="login-card">
          <img className="login-logo" src={logo} alt="BrainADZ Live" width="150" height="70" />
          <h2>Sign in</h2>
          <p className="muted small">Visitors, exhibitors and event staff all sign in here.</p>
          <form className="stack" onSubmit={submit}>
            <Field label="Email">
              <input
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => (setEmail(e.target.value), setSent(null))}
                required
              />
            </Field>
            {mode === 'password' && (
              <Field label="Password">
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  required
                />
              </Field>
            )}
            {mode === 'code' && sent && (
              <>
                {sent.demoCode && (
                  <Notice tone="pending">
                    <span className="demo-tag">Demo</span> No email is sent in the demo. Your code is <strong>{sent.demoCode}</strong>.
                  </Notice>
                )}
                <Field label="6-digit code" hint={`Sent to ${email}`}>
                  <input
                    className="input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                </Field>
              </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <button className="btn primary big block" disabled={busy}>
              {mode === 'password' || sent ? 'Sign in' : 'Email me a sign-in code'}
            </button>
            <button
              type="button"
              className="btn plain"
              onClick={() => (setMode(mode === 'code' ? 'password' : 'code'), setSecret(''), setSent(null), setError(null))}
            >
              {mode === 'code' ? 'Staff: sign in with a password' : 'Email me a code instead'}
            </button>
          </form>
          {event && (
            <div className="login-more">
              <span className="muted small">New to {event.name}?</span>
              <Link className="btn block" to={`/e/${event.slug}/register`}>
                Register for a ticket
              </Link>
              <div className="row between wrap small">
                <Link to={`/e/${event.slug}/register?find=1`}>Find my ticket</Link>
                <Link to={`/e/${event.slug}`}>See the exhibitors and floor plan</Link>
              </div>
            </div>
          )}
          {config.demo && (
            <details className="login-demo">
              <summary>
                <span className="demo-tag">Demo</span> Try a demo account
              </summary>
              <div className="list">
                {DEMO.map(([e, label]) => (
                  <button
                    key={e}
                    className="list-row"
                    onClick={() => run(() => post('/auth/login', { email: e, password: 'Events@2026' }).then(done))}
                  >
                    <span className="grow">
                      <strong>{label}</strong>
                      <br />
                      <span className="muted small">{e}</span>
                    </span>
                  </button>
                ))}
                <div className="muted small">
                  Password for all: Events@2026. Visitors sign in with an email code, for example aarav.mehta@meridianretail.example.
                </div>
              </div>
            </details>
          )}
        </main>
      </div>
    </div>
  );
}

// ---------- my passes ----------
export function Account() {
  const { me, signOut } = useMe();
  const nav = useNavigate();
  const events = useLoad(() => get('/public/events'));
  const event = events.data ? featuredEvent(events.data) : null;
  const work = [
    ...me.organiser.map((o) => ({
      key: `o${o.eventId}`,
      to: `/org/${o.eventId}`,
      title: o.name,
      detail: `Organiser console · ${ROLE_LABELS[o.role]}`,
    })),
    ...me.exhibitor.map((x) => ({
      key: `x${x.exhibitorId}`,
      to: `/x/${x.exhibitorId}`,
      title: x.companyName,
      detail: `Exhibitor workspace · ${x.eventName}`,
    })),
    ...(me.gate.length ? [{ key: 'gate', to: '/gate', title: 'Gate scanner', detail: me.gate[0].name }] : []),
  ];
  return (
    <AppFrame slug={event?.slug} event={event}>
      <div className="narrow stack loose">
        <div className="profile">
          <span className="avatar big" aria-hidden="true">
            {initialsOf(me.user)}
          </span>
          <div className="grow">
            <h1 className="page-title">My tickets</h1>
            <div className="muted small">{me.user.email}</div>
          </div>
        </div>
        {work.length > 0 && (
          <Section title="Workspaces">
            <div className="group">
              {work.map((w) => (
                <Link key={w.key} className="row-item" to={w.to}>
                  <Row title={w.title} detail={w.detail} chevron />
                </Link>
              ))}
            </div>
          </Section>
        )}
        <MyTickets
          empty={
            event ? (
              <NoTickets base={`/e/${event.slug}`} eventName={event.name} signedIn />
            ) : (
              <p className="empty">You have no tickets yet.</p>
            )
          }
        />
        <button className="btn block" onClick={() => signOut().then(() => nav('/'))}>
          <LogOut className="icon" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </AppFrame>
  );
}

// ---------- exhibitor application ----------
export function ExhibitApply() {
  const { guide, slug } = useEvent();
  const { me, refresh } = useMe();
  const nav = useNavigate();
  const existing = me.exhibitor.find((x) => x.slug === slug);
  const [f, setF] = useState({
    companyName: '',
    industry: '',
    description: '',
    website: '',
    contactName: me.user.name || '',
    contactEmail: me.user.email,
    contactPhone: '',
    billingName: '',
    gstin: '',
    billingAddress: '',
    hall: '',
    kind: 'shell',
    sizeSqm: 9,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (existing) return <Navigate to={`/x/${existing.exhibitorId}`} replace />;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const send = async (submit) => {
    setBusy(true);
    setError(null);
    try {
      const out = await post(`/events/${slug}/exhibitor-applications`, {
        ...f,
        spacePref: { hall: f.hall, kind: f.kind, sizeSqm: Number(f.sizeSqm) },
        submit,
      });
      await refresh();
      nav(`/x/${out.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const text = (k, label, { hint, ...props } = {}) => (
    <Field label={label} hint={hint}>
      <input className="input" value={f[k]} onChange={set(k)} {...props} />
    </Field>
  );
  return (
    <form className="narrow stack" onSubmit={(e) => (e.preventDefault(), send(true))}>
      <div>
        <h1 className="page-title">Apply to exhibit</h1>
        <p className="muted">{guide.event.name}</p>
      </div>
      <p className="muted">
        The organiser reviews each application. Once approved you get a booth, an order and a setup checklist in your exhibitor workspace.
      </p>
      <h3>Company</h3>
      {text('companyName', 'Company name', { required: true })}
      {text('industry', 'Industry', { required: true })}
      <Field label="What will you show? (optional)">
        <textarea className="input" value={f.description} onChange={set('description')} />
      </Field>
      {text('website', 'Website (optional)', { type: 'url', placeholder: 'https://' })}
      <h3>Contact</h3>
      {text('contactName', 'Contact name', { required: true })}
      {text('contactEmail', 'Contact email', { type: 'email', required: true })}
      {text('contactPhone', 'Contact phone', { type: 'tel', required: true })}
      <h3>Billing</h3>
      {text('billingName', 'Billing name', { required: true, hint: 'The legal name for the tax invoice' })}
      {text('gstin', 'GSTIN (optional)', { hint: '15 characters, for example 07AAACN0000A1Z5' })}
      <Field label="Billing address">
        <textarea className="input" value={f.billingAddress} onChange={set('billingAddress')} required />
      </Field>
      <h3>Space</h3>
      <Field label="Preferred hall (optional)">
        <select className="input" value={f.hall} onChange={set('hall')}>
          <option value="">No preference</option>
          {guide.halls
            .filter((h) => h.cols > 0)
            .map((h) => (
              <option key={h.id}>{h.name}</option>
            ))}
        </select>
      </Field>
      <Field label="Stand type">
        <select className="input" value={f.kind} onChange={set('kind')}>
          <option value="shell">Shell scheme (walls, fascia, carpet)</option>
          <option value="raw">Raw space (build your own)</option>
          <option value="premium">Premium corner</option>
        </select>
      </Field>
      <Field label="Stand size in square metres">
        <input className="input" type="number" min="6" max="500" value={f.sizeSqm} onChange={set('sizeSqm')} />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <button className="btn primary big block" disabled={busy}>
        Submit application
      </button>
      <button type="button" className="btn" disabled={busy || !f.companyName} onClick={() => send(false)}>
        Save as draft
      </button>
    </form>
  );
}
