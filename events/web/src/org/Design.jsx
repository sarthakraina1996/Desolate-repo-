// Design studio: the organiser sets how the visitor app and the ticket look for this
// exhibition, with a live preview of both. Nothing changes for visitors until it is saved.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Compass,
  House,
  ImageUp,
  Map as MapIcon,
  MapPin,
  Palette,
  RotateCcw,
  Save,
  Store,
  Ticket,
  Trash2,
} from 'lucide-react';
import { api as call, del, put } from '../api.js';
import { shrinkImage } from '../images.js';
import logo from '../assets/brainadz-live.png';
import hallPhoto from '../assets/expo-hall.jpg';
import { useAction, useImage, useToast } from '../ui.jsx';
import { PassCard } from '../components.jsx';
import { dateRange } from '../format.js';
import { CORNERS, FONTS, PATTERNS, PRESETS, themeVars, ticketFromTheme } from '../theme.js';
import { useOrg } from './shared.jsx';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Colour({ label, value, onChange }) {
  return (
    <label className="colour">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="grow">{label}</span>
      <input
        className="input hex"
        value={value}
        maxLength={7}
        aria-label={`${label} colour code`}
        onChange={(e) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && onChange(e.target.value)}
      />
    </label>
  );
}
function Choice({ label, options, value, onChange }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
function Tick({ label, checked, onChange }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// An image slot of the ticket (artwork or logo): upload, replace, remove.
function ImageSlot({ slot, title, hint, url, keepFormat, onChange }) {
  const { api } = useOrg();
  const toast = useToast();
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  const shown = useImage(url);
  const upload = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const form = new FormData();
      // Logos keep their format (PNG transparency); photos and artwork are resized to JPG.
      if (keepFormat) form.append('file', f, f.name);
      else form.append('file', (await shrinkImage(f, 1800)).blob, f.name.replace(/\.[^.]+$/, '') + '.jpg');
      const out = await call(`${api}/design-image/${slot}`, { method: 'POST', form });
      onChange(out.url);
      toast(`${title} uploaded`);
    } catch (err) {
      toast(err.message, 'error');
    }
    setBusy(false);
  };
  return (
    <div className="image-slot">
      <div className="thumb" style={shown ? { backgroundImage: `url("${shown}")` } : undefined}>
        {!shown && <ImageUp aria-hidden="true" />}
      </div>
      <div className="grow">
        <strong>{title}</strong>
        <div className="muted small">{hint}</div>
        <div className="row wrap" style={{ marginTop: 6 }}>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={upload} />
          <button type="button" className="btn sm" disabled={busy} onClick={() => file.current.click()}>
            <ImageUp className="icon" aria-hidden="true" />
            {busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}
          </button>
          {url && (
            <button
              type="button"
              className="btn sm plain"
              onClick={() =>
                del(`${api}/design-image/${slot}`)
                  .then(() => onChange(null))
                  .catch((err) => toast(err.message, 'error'))
              }
            >
              <Trash2 className="icon" aria-hidden="true" />
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// The visitor app's home screen, drawn small inside a phone with the theme applied.
function PhonePreview({ theme, event }) {
  const photo = useImage(event.loginImage);
  return (
    <div className="phone" aria-label="Preview of the visitor app">
      <div className="app-root phone-screen" style={themeVars(theme)} data-pattern={theme.pattern} data-tabs={theme.tabs} data-motion="off">
        <div className="pv-bar">
          <img src={logo} alt="" height="22" />
          <span className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
            AM
          </span>
        </div>
        <div className="pv-body">
          <section className="hero-card">
            <div className="hero-photo" style={{ backgroundImage: `url("${photo || hallPhoto}")` }} aria-hidden="true" />
            <span className="hero-status">Open now · until {event.closeTime}</span>
            <h1>{event.name}</h1>
            <div className="hero-facts">
              <span>
                <CalendarDays className="icon" aria-hidden="true" />
                {dateRange(event.startsOn, event.endsOn)}
              </span>
              <span>
                <MapPin className="icon" aria-hidden="true" />
                {event.city}
              </span>
            </div>
            <div className="hero-actions">
              <span className="btn hero-primary">Get your pass</span>
              <span className="btn hero-ghost">My ticket</span>
            </div>
          </section>
          <div className="quick">
            {[
              [Store, 'Exhibitors'],
              [MapIcon, 'Floor plan'],
              [CalendarDays, 'Agenda'],
              [Ticket, 'Ticket'],
            ].map(([Icon, label]) => (
              <span key={label} className="quick-link">
                <span className="quick-icon">
                  <Icon aria-hidden="true" />
                </span>
                <strong>{label}</strong>
              </span>
            ))}
          </div>
          <div className="block-head">
            <h2>Up next</h2>
            <a>Full agenda</a>
          </div>
          <div className="group">
            <div className="session" style={{ '--track': theme.primary }}>
              <div className="session-time">
                <strong>11:30</strong>
                <span>12:15</span>
              </div>
              <div className="grow">
                <span className="live-tag">On now</span>
                <div className="session-title">Opening keynote</div>
                <div className="muted small">Main stage</div>
              </div>
            </div>
          </div>
          <span className="btn primary big block">Register</span>
        </div>
        <div className="pv-tabs">
          {[
            [House, 'Home', true],
            [Compass, 'Explore'],
            [CalendarDays, 'Agenda'],
            [Ticket, 'Tickets'],
          ].map(([Icon, label, on]) => (
            <span key={label} className={on ? 'active' : ''}>
              <Icon className="icon" aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DesignStudio() {
  const { api, cfg, can, reloadConfig } = useOrg();
  const saved = cfg.event.design;
  const [d, setD] = useState(saved);
  const [tab, setTab] = useState('app');
  const act = useAction();
  const edit = can('event.manage');
  const theme = (patch) => setD((x) => ({ ...x, theme: { ...x.theme, ...patch } }));
  const ticket = (patch) => setD((x) => ({ ...x, ticket: { ...x.ticket, ...patch } }));
  const t = d.theme;
  const k = d.ticket;
  const dirty = !same(d, saved);
  const e = cfg.event;
  const sample = {
    passClass: { name: cfg.passClasses?.[0]?.name || 'Visitor' },
    holderName: 'Aarav Mehta',
    holderCompany: 'Meridian Retail',
    qr: 'BAE1.PREVIEW.PREVIEW',
    ref: 'FW-SAMPLE',
    gates: ['Gate 1', 'Gate 2'],
    zones: ['Hall A', 'Hall B'],
    validFrom: e.startsOn,
    validTo: e.endsOn,
    instructions: 'Show this pass at the gate. Carry a government photo ID.',
    event: e,
  };
  const save = () =>
    act(() => put(`${api}/design`, d).then((out) => (setD(out), reloadConfig())), 'Design saved. Visitors see it straight away.');
  return (
    <div className="stack">
      <div className="row between wrap">
        <div>
          <h1>Design studio</h1>
          <p className="muted">Set how the app and the ticket look for {e.name}. The preview updates as you edit.</p>
        </div>
        {edit && (
          <div className="row">
            {dirty && <span className="muted small">Unsaved changes</span>}
            <button className="btn plain" disabled={!dirty} onClick={() => setD(saved)}>
              <RotateCcw className="icon" aria-hidden="true" />
              Undo changes
            </button>
            <button className="btn primary" disabled={!dirty} onClick={save}>
              <Save className="icon" aria-hidden="true" />
              Save design
            </button>
          </div>
        )}
      </div>
      <div className="seg" role="group" aria-label="What to design" style={{ alignSelf: 'flex-start' }}>
        <button aria-pressed={tab === 'app'} onClick={() => setTab('app')}>
          <Palette className="icon" aria-hidden="true" />
          App look
        </button>
        <button aria-pressed={tab === 'ticket'} onClick={() => setTab('ticket')}>
          <Ticket className="icon" aria-hidden="true" />
          Ticket
        </button>
      </div>
      <div className="studio">
        <fieldset className="stack" disabled={!edit}>
          {tab === 'app' ? (
            <>
              <section className="panel">
                <div className="head">
                  <div>
                    <h3>Start from a style</h3>
                    <p className="muted small">Pick the one closest to your exhibition, then adjust anything below. The ticket follows.</p>
                  </div>
                </div>
                <div className="body swatches">
                  {PRESETS.map(({ key, name, ...p }) => (
                    <button
                      key={key}
                      type="button"
                      className="swatch"
                      aria-pressed={same({ ...t, ...p }, t)}
                      onClick={() => setD((x) => ({ theme: { ...x.theme, ...p }, ticket: ticketFromTheme(p, x.ticket) }))}
                    >
                      <span className="chip2" style={{ background: p.primary }}>
                        <i style={{ background: p.accent }} />
                      </span>
                      {name}
                    </button>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="head">
                  <h3>Colours</h3>
                </div>
                <div className="body stack tight">
                  <Colour label="Main colour (header card, ticket band)" value={t.primary} onChange={(v) => theme({ primary: v })} />
                  <Colour label="Action colour (buttons, highlights)" value={t.accent} onChange={(v) => theme({ accent: v })} />
                  <Colour label="Page background" value={t.canvas} onChange={(v) => theme({ canvas: v })} />
                </div>
              </section>
              <section className="panel">
                <div className="head">
                  <h3>Style</h3>
                </div>
                <div className="body stack">
                  <Choice label="Pattern on the header card" options={PATTERNS} value={t.pattern} onChange={(v) => theme({ pattern: v })} />
                  <Choice label="Corners" options={CORNERS} value={t.corners} onChange={(v) => theme({ corners: v })} />
                  <Choice
                    label="Tab bar"
                    options={[
                      ['light', 'White'],
                      ['solid', 'Main colour'],
                    ]}
                    value={t.tabs}
                    onChange={(v) => theme({ tabs: v })}
                  />
                  <div className="field">
                    <label className="label" htmlFor="ds-font">
                      Lettering
                    </label>
                    <select id="ds-font" className="input" value={t.font} onChange={(ev) => theme({ font: ev.target.value })}>
                      {FONTS.map(([v, text]) => (
                        <option key={v} value={v}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Tick
                    label="Lively motion (pages glide in, the ticket band shimmers)"
                    checked={t.motion}
                    onChange={(v) => theme({ motion: v })}
                  />
                  <p className="muted small">
                    The photo on the header card is the sign-in photo. Change it in <Link to="../settings">Settings → Event</Link>.
                  </p>
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="panel">
                <div className="head">
                  <div>
                    <h3>Your own artwork</h3>
                    <p className="muted small">
                      Upload a finished ticket design or the show&apos;s key visual, and your logo. The name, QR code and gate details are
                      added on top.
                    </p>
                  </div>
                </div>
                <div className="body stack">
                  <ImageSlot
                    slot="art"
                    title="Ticket artwork"
                    hint="JPG or PNG. Wide images suit the top banner; tall ones suit the whole ticket."
                    url={k.art}
                    onChange={(url) => (ticket({ art: url }), reloadConfig())}
                  />
                  {k.art && (
                    <Choice
                      label="Where the artwork goes"
                      options={[
                        ['banner', 'Top banner'],
                        ['full', 'Whole ticket'],
                      ]}
                      value={k.artPlacement}
                      onChange={(v) => ticket({ artPlacement: v })}
                    />
                  )}
                  <ImageSlot
                    slot="logo"
                    title="Logo on the ticket"
                    hint="PNG with a clear background works best."
                    url={k.logo}
                    keepFormat
                    onChange={(url) => (ticket({ logo: url }), reloadConfig())}
                  />
                </div>
              </section>
              <section className="panel">
                <div className="head">
                  <h3>Layout and colours</h3>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setD((x) => ({ ...x, ticket: ticketFromTheme(x.theme, x.ticket) }))}
                  >
                    Match the app look
                  </button>
                </div>
                <div className="body stack">
                  <Choice
                    label="Layout"
                    options={[
                      ['classic', 'Classic'],
                      ['poster', 'Poster'],
                      ['badge', 'Badge'],
                    ]}
                    value={k.layout}
                    onChange={(v) => ticket({ layout: v })}
                  />
                  <div className="stack tight">
                    <Colour label="Band" value={k.band} onChange={(v) => ticket({ band: v })} />
                    <Colour label="Text on the band" value={k.bandText} onChange={(v) => ticket({ bandText: v })} />
                    <Colour label="Pass-type label and footer" value={k.accent} onChange={(v) => ticket({ accent: v })} />
                    <Colour label="Ticket paper" value={k.paper} onChange={(v) => ticket({ paper: v })} />
                    <Colour label="Text on the paper" value={k.ink} onChange={(v) => ticket({ ink: v })} />
                  </div>
                  <Choice label="Pattern on the band" options={PATTERNS} value={k.pattern} onChange={(v) => ticket({ pattern: v })} />
                  <Choice label="Corners" options={CORNERS} value={k.corners} onChange={(v) => ticket({ corners: v })} />
                  <Tick label="Tear-off notches at the sides" checked={k.notches} onChange={(v) => ticket({ notches: v })} />
                </div>
              </section>
              <section className="panel">
                <div className="head">
                  <h3>Words and details</h3>
                </div>
                <div className="body stack">
                  <div className="field">
                    <label className="label" htmlFor="ds-headline">
                      Small line above the event name (optional)
                    </label>
                    <input
                      id="ds-headline"
                      className="input"
                      maxLength={40}
                      placeholder="For example: Admit one"
                      value={k.headline}
                      onChange={(ev) => ticket({ headline: ev.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="ds-footer">
                      Line at the bottom (optional)
                    </label>
                    <input
                      id="ds-footer"
                      className="input"
                      maxLength={120}
                      placeholder="For example: See you on the show floor!"
                      value={k.footer}
                      onChange={(ev) => ticket({ footer: ev.target.value })}
                    />
                  </div>
                  <div className="stack tight">
                    <span className="label">Show on the ticket</span>
                    <Tick label="Venue" checked={k.showVenue} onChange={(v) => ticket({ showVenue: v })} />
                    <Tick label="Holder's company" checked={k.showCompany} onChange={(v) => ticket({ showCompany: v })} />
                    <Tick label="Which gates to use" checked={k.showGates} onChange={(v) => ticket({ showGates: v })} />
                    <Tick label="Areas the pass opens" checked={k.showZones} onChange={(v) => ticket({ showZones: v })} />
                    <Tick label="Reference number" checked={k.showRef} onChange={(v) => ticket({ showRef: v })} />
                    <Tick label="Gate instructions" checked={k.showNote} onChange={(v) => ticket({ showNote: v })} />
                  </div>
                </div>
              </section>
            </>
          )}
        </fieldset>
        <aside className="studio-preview" aria-label="Preview">
          <p className="muted small" style={{ textAlign: 'center', marginBottom: 8 }}>
            Live preview{dirty ? ' · not saved yet' : ''}
          </p>
          {tab === 'app' ? (
            <PhonePreview theme={t} event={e} />
          ) : (
            <div className="app-root ticket-stage" style={themeVars(t)} data-motion={t.motion ? 'on' : 'off'}>
              <PassCard pass={sample} design={k} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
