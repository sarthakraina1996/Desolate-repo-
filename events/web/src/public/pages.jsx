// The public event site and the visitor journey: landing, directory, hall plan, agenda,
// registration, the browser pass, hosted-checkout demo page, sign-in and "my passes".
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CalendarDays, Map as MapIcon, Search, Ticket, UserRound } from 'lucide-react';
import { del, get, post, put } from '../api.js';
import { useMe } from '../App.jsx';
import { Field, Loaded, Loading, Notice, Status, useAction, useLoad } from '../ui.jsx';
import { AgendaList, HallPlan, PassCard } from '../components.jsx';
import { dateRange, inr, ROLE_LABELS } from '../format.js';

// ---------- event site frame ----------
const EventCtx = createContext(null);
const useEvent = () => useContext(EventCtx);

// "/" goes to the published event, or lists them when there are several.
export function Home() {
  const load = useLoad(() => get('/public/events'));
  return (
    <Loaded load={load}>
      {(events) =>
        events.length === 1 ? (
          <Navigate to={`/e/${events[0].slug}`} replace />
        ) : (
          <main id="main" className="site-main narrow stack">
            <h1>BrainADZ Events</h1>
            <div className="panel list">
              {events.map((e) => (
                <Link key={e.slug} className="list-row" to={`/e/${e.slug}`}>
                  <span className="grow">
                    <strong>{e.name}</strong>
                    <br />
                    <span className="muted small">
                      {dateRange(e.startsOn, e.endsOn)} · {e.city}
                    </span>
                  </span>
                </Link>
              ))}
              {!events.length && (
                <p className="empty">
                  No events are open yet. <Link to="/signin">Sign in</Link>
                </p>
              )}
            </div>
          </main>
        )
      }
    </Loaded>
  );
}

export function EventSite() {
  const { slug } = useParams();
  const { me } = useMe();
  const load = useLoad(() => get(`/public/events/${slug}/guide`), [slug]);
  const base = `/e/${slug}`;
  return (
    <Loaded load={load}>
      {(guide) => (
        <EventCtx.Provider value={{ guide, base, slug }}>
          <header className="site-head">
            <div className="in">
              <Link to={base} className="brand" style={{ padding: 0 }}>
                BrainADZ Events
              </Link>
              <nav className="site-nav" aria-label="Event">
                <NavLink to={base} end>
                  Overview
                </NavLink>
                <NavLink to={`${base}/exhibitors`}>Exhibitors</NavLink>
                <NavLink to={`${base}/map`}>Floor plan</NavLink>
                <NavLink to={`${base}/agenda`}>Agenda</NavLink>
              </nav>
              <Link className="btn plain" to={me.user ? '/account' : '/signin'}>
                {me.user ? 'My passes' : 'Sign in'}
              </Link>
            </div>
          </header>
          <main id="main" className="site-main">
            <Outlet />
          </main>
          <nav className="tabbar site-tabbar" aria-label="Event">
            <NavLink to={me.user ? '/account' : `${base}/register`}>
              <Ticket className="icon" />
              Pass
            </NavLink>
            <NavLink to={`${base}/map`}>
              <MapIcon className="icon" />
              Explore
            </NavLink>
            <NavLink to={`${base}/agenda`}>
              <CalendarDays className="icon" />
              Agenda
            </NavLink>
            <NavLink to={base} end>
              <UserRound className="icon" />
              Event
            </NavLink>
          </nav>
        </EventCtx.Provider>
      )}
    </Loaded>
  );
}

export function Landing() {
  const { guide, base } = useEvent();
  const e = guide.event;
  return (
    <>
      <section className="hero">
        <p className="eyebrow">
          {dateRange(e.startsOn, e.endsOn)} · {e.city}
        </p>
        <h1>{e.name}</h1>
        <p className="lede">{e.tagline}</p>
        <div className="row wrap" style={{ marginTop: 24 }}>
          <Link className="btn primary big" to={`${base}/register`}>
            Register
          </Link>
          <Link className="btn plain" to={`${base}/register?find=1`}>
            Find my pass
          </Link>
        </div>
      </section>
      {guide.announcements.map((a) => (
        <div key={a.id} style={{ marginBottom: 12 }}>
          <Notice tone="pending">
            <strong>{a.title}.</strong> {a.body}
          </Notice>
        </div>
      ))}
      <div className="facts">
        <div>
          <div className="eyebrow">Dates</div>
          <div className="v">{dateRange(e.startsOn, e.endsOn)}</div>
        </div>
        <div>
          <div className="eyebrow">Hours</div>
          <div className="v">
            {e.openTime}–{e.closeTime} daily
          </div>
        </div>
        <div>
          <div className="eyebrow">Venue</div>
          <div className="v">{e.venueName}</div>
          <div className="muted small">{e.venueAddress}</div>
        </div>
        <div>
          <div className="eyebrow">On the floor</div>
          <div className="v">
            {guide.exhibitorCount} exhibitors · {guide.sessionCount} sessions
          </div>
        </div>
      </div>
      <section className="section">
        <h2>About the event</h2>
        <p style={{ marginTop: 8, maxWidth: '70ch' }}>{e.description}</p>
        <p style={{ marginTop: 12 }}>
          <Link to={`${base}/exhibitors`}>Browse exhibitors</Link> · <Link to={`${base}/map`}>See the floor plan</Link> ·{' '}
          <Link to={`${base}/agenda`}>View the agenda</Link>
        </p>
      </section>
      <section className="section">
        <h2>Passes</h2>
        <div className="panel list" style={{ marginTop: 12 }}>
          {guide.passClasses.map((c) => (
            <div key={c.code}>
              <span className="grow">
                <strong>{c.name}</strong>
                <br />
                <span className="muted small">{c.description}</span>
              </span>
              {c.soldOut ? (
                <Status tone="pending">Fully booked</Status>
              ) : (
                <strong>{c.mode === 'invited' ? 'By invitation' : c.priceLabel}</strong>
              )}
            </div>
          ))}
        </div>
        {guide.features.exhibitors && (
          <p style={{ marginTop: 12 }}>
            Want to exhibit? <Link to={`${base}/exhibit`}>Apply for a stand</Link>
          </p>
        )}
      </section>
      {guide.accessibility && (
        <section className="section">
          <h2>Accessibility</h2>
          <p style={{ marginTop: 8, maxWidth: '70ch' }}>{guide.accessibility}</p>
        </section>
      )}
      {guide.faqs.length > 0 && (
        <section className="section">
          <h2>Questions</h2>
          <div style={{ marginTop: 8 }}>
            {guide.faqs.map((f) => (
              <details key={f.q} className="faq">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ExhibitorCard({ ex, onClose }) {
  const { base } = useEvent();
  return (
    <div className="panel">
      <div className="head">
        <div>
          <h3>{ex.name}</h3>
          <div className="muted">{ex.hall ? `${ex.hall} · Booth ${ex.boothCode}` : 'Booth to be announced'}</div>
        </div>
        {onClose && (
          <button className="btn sm" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      <div className="body stack tight">
        <p>{ex.description}</p>
        {ex.categories.length > 0 && <p className="muted small">{ex.categories.join(' · ')}</p>}
        <div className="row wrap">
          {ex.boothId && (
            <Link className="btn sm" to={`${base}/map?booth=${ex.boothId}`}>
              Show on plan
            </Link>
          )}
          {ex.website && (
            <a className="btn sm" href={ex.website} target="_blank" rel="noreferrer">
              Website
            </a>
          )}
          {ex.catalogueLinks.map((l) => (
            <a key={l.url} className="btn sm" href={l.url} target="_blank" rel="noreferrer">
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Directory() {
  const { guide } = useEvent();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState(null);
  const cats = useMemo(() => [...new Set(guide.exhibitors.flatMap((e) => e.categories))].sort(), [guide]);
  const rows = guide.exhibitors.filter(
    (e) =>
      (!cat || e.categories.includes(cat)) &&
      (!q || [e.name, e.boothCode, e.industry, ...e.categories].some((v) => v && v.toLowerCase().includes(q.toLowerCase()))),
  );
  return (
    <div className="stack">
      <h1>Exhibitors</h1>
      <div className="search">
        <Search className="icon" aria-hidden="true" />
        <input
          className="input"
          type="search"
          placeholder="Search by company, booth or product"
          aria-label="Search exhibitors"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="chips" role="group" aria-label="Product category">
        <button className="chip" aria-pressed={!cat} onClick={() => setCat('')}>
          All
        </button>
        {cats.map((c) => (
          <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? '' : c)}>
            {c}
          </button>
        ))}
      </div>
      <p className="muted small" role="status">
        {rows.length} of {guide.exhibitors.length} exhibitors
      </p>
      <div className="panel list">
        {rows.map((e) => (
          <div key={e.id} style={{ display: 'block' }}>
            <button
              className="list-row"
              style={{ display: 'flex', gap: 12, padding: 0, border: 0 }}
              onClick={() => setOpen(open === e.id ? null : e.id)}
              aria-expanded={open === e.id}
            >
              <strong style={{ width: 52 }}>{e.boothCode || '—'}</strong>
              <span className="grow">
                <strong>{e.name}</strong>
                <br />
                <span className="muted small">{[e.hall, e.industry].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
            {open === e.id && (
              <div style={{ marginTop: 12 }}>
                <ExhibitorCard ex={e} />
              </div>
            )}
          </div>
        ))}
        {!rows.length && <p className="empty">No exhibitors match. Try a different search.</p>}
      </div>
    </div>
  );
}

export function MapPage() {
  const { guide } = useEvent();
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get('booth')) || null;
  const ex = guide.exhibitors.find((e) => e.boothId === selected);
  return (
    <div className="stack">
      <h1>Floor plan</h1>
      <HallPlan
        halls={guide.halls}
        selected={selected}
        onSelect={(b) => setParams(b.exhibitorId ? { booth: b.id } : {}, { replace: true })}
      />
      {ex ? (
        <ExhibitorCard ex={ex} onClose={() => setParams({}, { replace: true })} />
      ) : (
        <p className="muted">Choose a booth to see who is there. Use List for a text version of the plan.</p>
      )}
    </div>
  );
}

export function AgendaPage() {
  const { guide } = useEvent();
  const { me } = useMe();
  const [track, setTrack] = useState(null);
  const [mine, setMine] = useState(false);
  const marks = useLoad(() => (me.user ? get('/me/bookmarks') : Promise.resolve([])), [me.user?.id]);
  const act = useAction();
  const toggle = (s, on) => act(() => (on ? put(`/me/bookmarks/${s.id}`) : del(`/me/bookmarks/${s.id}`)).then(marks.reload));
  const agenda = mine ? { ...guide.agenda, sessions: guide.agenda.sessions.filter((s) => marks.data?.includes(s.id)) } : guide.agenda;
  return (
    <div className="stack">
      <h1>Agenda</h1>
      <div className="chips" role="group" aria-label="Track">
        <button className="chip" aria-pressed={!track && !mine} onClick={() => (setTrack(null), setMine(false))}>
          All sessions
        </button>
        {guide.agenda.tracks.map((t) => (
          <button key={t.id} className="chip" aria-pressed={track === t.id} onClick={() => (setTrack(t.id), setMine(false))}>
            {t.name}
          </button>
        ))}
        {me.user && (
          <button className="chip" aria-pressed={mine} onClick={() => (setMine(!mine), setTrack(null))}>
            My bookmarks
          </button>
        )}
      </div>
      {!me.user && (
        <p className="muted small">
          <Link to="/signin">Sign in</Link> to bookmark sessions.
        </p>
      )}
      <AgendaList agenda={agenda} track={track} bookmarks={marks.data || []} onToggle={me.user ? toggle : null} />
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
    passClass: open[0]?.code || '',
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
        <p className="eyebrow">{guide.event.name}</p>
        <h1>Check your email</h1>
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
      <div>
        <p className="eyebrow">{guide.event.name}</p>
        <h1>Register</h1>
      </div>
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
        Already registered? Find my pass
      </button>
    </form>
  );
}

function FindPass({ slug, onBack }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  return (
    <form
      className="narrow stack"
      onSubmit={(e) => (
        e.preventDefault(),
        post(`/public/events/${slug}/pass-link`, { email })
          .then(() => setSent(true))
          .catch((er) => setError(er.message))
      )}
    >
      <h1>Find my pass</h1>
      {sent ? (
        <Notice tone="ok">If {email} is registered, a new pass link is on its way. Earlier links stop working.</Notice>
      ) : (
        <>
          <p>Enter the email you registered with and we will send a new link to your pass.</p>
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
      <Link to="/signin">Sign in to see all your passes</Link>
    </form>
  );
}

// ---------- registration state: pass, payment, review ----------
// One view for wherever a registration stands. Used by the pass link and "my passes".
export function RegistrationState({ state, onCancel, returnPath }) {
  const act = useAction();
  const pay = () =>
    act(async () => {
      const out = await post(`/public/orders/${state.order.token}/checkout`, { returnPath });
      window.location.assign(out.url);
    });
  if (state.step === 'pass')
    return (
      <div className="stack">
        <PassCard pass={state.pass} />
        {state.pass.firstAdmittedAt && <Notice tone="ok">Admitted. Keep this pass for re-entry.</Notice>}
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
      <div className="stack">
        <Notice tone="pending">
          <strong>Payment needed.</strong> Your {state.passClass.name} place is held. Your pass is issued as soon as payment is confirmed.
          {state.paymentStatus === 'failed' && ' The last payment attempt did not go through.'}
        </Notice>
        <div className="panel">
          <div className="body totals">
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
        </div>
        <button className="btn primary big block" onClick={pay}>
          Pay {inr(state.order.balancePaise)}
        </button>
        <p className="muted small">You pay on a secure hosted checkout page by UPI or card. Order {state.order.number}.</p>
      </div>
    );
  if (state.step === 'review')
    return (
      <Notice tone="pending">
        <strong>Awaiting review.</strong> The organiser reviews {state.passClass.name} registrations and will email {state.email} with a
        decision. Reference {state.ref}.
      </Notice>
    );
  if (state.step === 'rejected')
    return (
      <Notice tone="error">
        <strong>Not approved.</strong> {state.reviewNote || 'The organiser could not approve this registration.'} Reference {state.ref}.
      </Notice>
    );
  return (
    <Notice tone="error">
      <strong>Cancelled.</strong> This registration ({state.ref}) was cancelled and its pass no longer works.
    </Notice>
  );
}

// The pass retrieval link: works in any browser without the app or an account.
export function PassPage() {
  const { token } = useParams();
  const load = useLoad(() => get(`/public/pass/${token}`), [token]);
  const act = useAction();
  if (load.error)
    return (
      <main id="main" className="site-main">
        <FindPassFallback message={load.error.message} />
      </main>
    );
  if (!load.data) return <Loading />;
  const s = load.data;
  return (
    <main id="main" className="site-main narrow stack">
      <div>
        <p className="eyebrow">
          <Link to={`/e/${s.event.slug}`}>{s.event.name}</Link>
        </p>
        <h1>{s.step === 'pass' ? 'My pass' : 'My registration'}</h1>
      </div>
      <RegistrationState
        state={s}
        returnPath={`/p/${token}`}
        onCancel={() => act(() => post(`/public/pass/${token}/cancel`).then(load.reload), 'Registration cancelled')}
      />
      {s.step === 'pass' && (
        <p className="muted small no-print">
          With the BrainADZ Events app installed, this link opens your pass in the app, where it also works offline.
        </p>
      )}
    </main>
  );
}
function FindPassFallback({ message }) {
  const events = useLoad(() => get('/public/events'));
  return (
    <div className="narrow stack">
      <Notice tone="error">{message}</Notice>
      {events.data?.[0] && <FindPass slug={events.data[0].slug} />}
    </div>
  );
}

// The local demo payment adapter's own page. Clearly labelled; no money moves.
export function Pay() {
  const { intent } = useParams();
  const [params] = useSearchParams();
  const load = useLoad(() => get(`/public/pay/${intent}`), [intent]);
  const [done, setDone] = useState(null);
  const back = params.get('return') || '/';
  const go = (outcome, method) =>
    post(`/public/pay/${intent}/simulate`, { outcome, method })
      .then(() => setDone(outcome))
      .catch((e) => alert(e.message));
  return (
    <main id="main" className="site-main narrow stack">
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
                <a className="btn primary big block" href={back}>
                  Continue
                </a>
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
                <a className="btn plain" href={back}>
                  Cancel and go back
                </a>
              </div>
            )}
          </>
        )}
      </Loaded>
    </main>
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
export const homeFor = (me) =>
  me.organiser?.length ? '/org' : me.exhibitor?.length ? `/x/${me.exhibitor[0].exhibitorId}` : me.gate?.length ? '/gate' : '/account';

export function SignIn() {
  const { me, config, refresh } = useMe();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState('code'); // code | password
  const [sent, setSent] = useState(null);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const done = async () => {
    const m = await refresh();
    nav(params.get('next') || homeFor(m), { replace: true });
  };
  useEffect(() => {
    if (me.user) nav(params.get('next') || homeFor(me), { replace: true });
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
    <main id="main" className="site-main narrow stack">
      <div>
        <Link to="/" className="eyebrow">
          BrainADZ Events
        </Link>
        <h1>Sign in</h1>
      </div>
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
                <span className="demo-tag">Demo</span> No email is sent by the local email adapter. Your code is{' '}
                <strong>{sent.demoCode}</strong>.
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
          {mode === 'password' ? 'Sign in' : sent ? 'Sign in' : 'Email me a code'}
        </button>
        <button
          type="button"
          className="btn plain"
          onClick={() => (setMode(mode === 'code' ? 'password' : 'code'), setSecret(''), setSent(null), setError(null))}
        >
          {mode === 'code' ? 'Use a password instead' : 'Email me a code instead'}
        </button>
      </form>
      {config.demo && (
        <div className="panel">
          <div className="head">
            <h3>Demo accounts</h3>
            <span className="demo-tag">Demo</span>
          </div>
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
        </div>
      )}
    </main>
  );
}

// ---------- my passes ----------
export function Account() {
  const { me, signOut } = useMe();
  const nav = useNavigate();
  const load = useLoad(() => get('/me/passes'));
  const act = useAction();
  return (
    <main id="main" className="site-main narrow stack">
      <div className="row between">
        <div>
          <p className="eyebrow">{me.user.email}</p>
          <h1>My passes</h1>
        </div>
        <button className="btn" onClick={() => signOut().then(() => nav('/'))}>
          Sign out
        </button>
      </div>
      {(me.organiser.length > 0 || me.exhibitor.length > 0 || me.gate.length > 0) && (
        <div className="panel list">
          {me.organiser.map((o) => (
            <Link key={o.eventId} className="list-row" to={`/org/${o.eventId}`}>
              <span className="grow">
                <strong>{o.name}</strong>
                <br />
                <span className="muted small">Organiser console · {ROLE_LABELS[o.role]}</span>
              </span>
            </Link>
          ))}
          {me.exhibitor.map((x) => (
            <Link key={x.exhibitorId} className="list-row" to={`/x/${x.exhibitorId}`}>
              <span className="grow">
                <strong>{x.companyName}</strong>
                <br />
                <span className="muted small">Exhibitor workspace · {x.eventName}</span>
              </span>
            </Link>
          ))}
          {me.gate.length > 0 && (
            <Link className="list-row" to="/gate">
              <span className="grow">
                <strong>Gate scanner</strong>
                <br />
                <span className="muted small">{me.gate[0].name}</span>
              </span>
            </Link>
          )}
        </div>
      )}
      <Loaded load={load}>
        {(d) => (
          <>
            {d.badges.map((b) => (
              <PassCard key={b.id} pass={b} />
            ))}
            {d.registrations.map((r) => (
              <section key={r.id} className="stack tight" aria-label={`${r.passClass.name}, ${r.event.name}`}>
                <p className="eyebrow">
                  {r.event.name} · {r.passClass.name}
                </p>
                <RegistrationState
                  state={r}
                  returnPath="/account"
                  onCancel={() => act(() => post(`/me/registrations/${r.id}/cancel`).then(load.reload), 'Registration cancelled')}
                />
              </section>
            ))}
            {!d.badges.length && !d.registrations.length && (
              <p className="empty">
                You have no passes yet. <Link to="/">Find an event</Link>
              </p>
            )}
          </>
        )}
      </Loaded>
    </main>
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
        <p className="eyebrow">{guide.event.name}</p>
        <h1>Apply to exhibit</h1>
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
