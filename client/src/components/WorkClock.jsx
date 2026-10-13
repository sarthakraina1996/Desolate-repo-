// The work clock: a live timer at the right of the top bar, a pop-out
// window that stays on screen when the app is minimised, the "reason for the
// gap" step when someone comes back, and the short-hours prompt.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Timer, LogIn, LogOut, House, PictureInPicture2, Pause, Coffee, TriangleAlert, CircleAlert, MapPin } from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../lib/api.js';
import { useAction, useClickOutside } from '../lib/hooks.js';
import { fmtTime, fmtDay } from '../lib/format.js';
import { useWorkday, useNow, workedNow, clockText, checkIn, checkOut, refreshWorkday } from '../lib/workday.js';
import { getPosition, setLocationStatus, useLocationStatus, fmtDistance } from '../lib/location.js';
import { Button, Modal, Field, Textarea, Progress, Badge } from './ui.jsx';

const OFF_DAYS = ['H', 'WO', 'L'];
const BASE_TITLE = 'BrainADZ HRMS';
const POP_PREF = 'hrms.popOutOnCheckIn';
const canPopOut = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window && window.top === window;
const readPref = () => { try { return localStorage.getItem(POP_PREF) !== 'off'; } catch { return true; } };
const writePref = (on) => { try { localStorage.setItem(POP_PREF, on ? 'on' : 'off'); } catch { /* storage blocked */ } };

// ---------- floating clock (Document Picture-in-Picture) ----------
let pipWindow = null;
const pipListeners = new Set();
const setPip = (w) => { pipWindow = w; pipListeners.forEach((f) => f(w)); };

export async function openFloatingClock() {
  if (!canPopOut()) return false;
  if (pipWindow) return true;
  const win = await window.documentPictureInPicture.requestWindow({ width: 280, height: 168 });
  for (const sheet of [...document.styleSheets]) {
    try {
      const style = win.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      win.document.head.append(style);
    } catch {
      if (sheet.href) {
        const link = win.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        win.document.head.append(link);
      }
    }
  }
  win.document.title = 'Work clock';
  win.document.body.className = 'pip-body';
  win.addEventListener('pagehide', () => setPip(null));
  setPip(win);
  return true;
}

function usePipWindow() {
  const [w, setW] = useState(pipWindow);
  useEffect(() => {
    pipListeners.add(setW);
    return () => pipListeners.delete(setW);
  }, []);
  return w;
}

function FloatingClock({ s }) {
  const now = useNow(1000);
  const { toast } = useApp();
  const w = s.workday;
  const worked = workedNow(s, now);
  const running = Boolean(w.openSince);
  return (
    <div className="pip-clock">
      <div className="row between"><span className={`pip-state ${running ? 'on' : ''}`}>{running ? 'Working' : 'Paused'}</span><span className="xs muted">{clockText(w.requiredMinutes, false)} target</span></div>
      <div className="pip-time">{clockText(worked)}</div>
      <Progress value={Math.min(100, (worked / w.requiredMinutes) * 100)} color={worked >= w.requiredMinutes ? 'var(--green)' : 'var(--blue)'} height={6} />
      <div className="row between mt-8">
        <span className="xs muted">{running ? `Since ${fmtTime(w.openSince)}` : w.awaySince ? `Away since ${fmtTime(w.awaySince)}` : 'Not checked in'}</span>
        {running && <button type="button" className="btn xs" onClick={() => checkOut().then(() => toast('Checked out. Your clock is paused.', 'success')).catch((e) => toast(e.message, 'error'))}>Check out</button>}
      </div>
    </div>
  );
}

// ---------- reason for the gap ----------
export function GapReasonModal({ welcome, onClose }) {
  const { toast } = useApp();
  const s = useWorkday();
  const now = useNow(30000);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [run, busy] = useAction(toast);
  const w = s?.workday;
  if (!w) return null;
  const awayMin = w.awaySince ? Math.max(0, (now + (s.offset || 0) - Date.parse(w.awaySince)) / 60000) : 0;
  const resume = async () => {
    const out = await run(() => checkIn({ mode: w.mode || 'office', gap_reason: reason, gap_note: note }), 'Welcome back. Your clock is running again.');
    if (out) {
      onClose(true);
      if (readPref()) openFloatingClock().catch(() => {});
    }
  };
  return (
    <Modal title={welcome ? 'Welcome back' : 'Check in again'} size="narrow" onClose={() => onClose(false)}
      footer={<>
        <Button onClick={() => onClose(false)}>{welcome ? "Not now, I'm done for today" : 'Cancel'}</Button>
        <Button variant="primary" icon={LogIn} loading={busy} disabled={!reason || (reason === 'Other' && !note.trim())} onClick={resume}>Resume work</Button>
      </>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="alert info"><Pause size={16} /><span>Your clock has been paused since <b>{fmtTime(w.awaySince)}</b>{awayMin >= 1 ? ` (${clockText(awayMin, false)})` : ''}. You have worked <b>{clockText(w.workedMinutes, false)}</b> today.</span></div>
        <Field label="Reason for the gap">
          <div className="pick-chips" role="radiogroup" aria-label="Reason for the gap">
            {(s.gapReasons || []).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={reason === r} className={`pick-chip ${reason === r ? 'on' : ''}`} onClick={() => setReason(r)}>{r}</button>
            ))}
          </div>
        </Field>
        <Field label={reason === 'Other' ? 'Details' : 'Details (optional)'}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Brand review with the client at their office" />
        </Field>
        <div className="xs muted">Your manager sees this reason if you end the day short of {clockText(w.requiredMinutes, false)}.</div>
      </div>
    </Modal>
  );
}

// Buttons used by the check-in cards on My Space and Attendance.
export function ClockActions({ light }) {
  const { toast } = useApp();
  const s = useWorkday();
  const [run, busy] = useAction(toast);
  const [ask, setAsk] = useState(false);
  const w = s?.workday;
  if (!w || (OFF_DAYS.includes(s.dayStatus) && !w.sessions.length)) return null;
  const start = async (mode) => {
    if (await run(() => checkIn({ mode }), mode === 'wfh' ? 'Checked in (work from home)' : 'Checked in. Have a great day!')) {
      if (readPref()) openFloatingClock().catch(() => {});
    }
  };
  return (
    <div className="row">
      {!w.sessions.length && <>
        <Button variant="primary" icon={LogIn} loading={busy} onClick={() => start('office')}>Check in</Button>
        <Button icon={House} loading={busy} onClick={() => start('wfh')}>Work from home</Button>
      </>}
      {w.openSince && <Button icon={LogOut} loading={busy} onClick={() => run(() => checkOut(), (r) => `Checked out after ${r.worked} today. Your clock is paused.`)}>Check out</Button>}
      {!w.openSince && w.sessions.length > 0 && <Button variant={light ? '' : 'primary'} icon={LogIn} onClick={() => setAsk(true)}>Check in again</Button>}
      {ask && <GapReasonModal onClose={() => setAsk(false)} />}
    </div>
  );
}

// Today's sessions and the time away between them.
export function SessionList({ w, compact }) {
  if (!w?.sessions.length) return null;
  const rows = [];
  w.sessions.forEach((x, i) => {
    if (i > 0) {
      const g = w.gaps[i - 1];
      if (g) rows.push(<div key={`g${i}`} className="sess gap"><Coffee size={13} /><span>Away {clockText(g.minutes, false)}{g.reason ? ` · ${g.reason}` : ''}{g.note && !compact ? ` (${g.note})` : ''}</span></div>);
    }
    const mins = x.end ? (Date.parse(x.end) - Date.parse(x.start)) / 60000 : null;
    rows.push(<div key={`s${i}`} className="sess"><span className={`dot ${x.end ? '' : 'live'}`} /><span>{fmtTime(x.start)} – {x.end ? fmtTime(x.end) : 'now'}</span>{mins != null && <span className="muted">{clockText(mins, false)}</span>}{x.mode === 'wfh' && <Badge tone="amber">WFH</Badge>}</div>);
  });
  return <div className="sess-list">{rows}</div>;
}

// ---------- top-bar clock ----------
export default function WorkClock() {
  const { user, toast } = useApp();
  const s = useWorkday();
  const now = useNow(1000);
  const pip = usePipWindow();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const [pref, setPref] = useState(readPref);
  const [run, busy] = useAction(toast);
  const ref = useClickOutside(useCallback(() => setOpen(false), []));
  const w = s?.workday;
  const running = Boolean(w?.openSince);
  const worked = workedNow(s, now);

  // The running time in the tab title, so it shows even when the window is
  // minimised or another tab is in front.
  useEffect(() => {
    if (!running) { document.title = BASE_TITLE; return undefined; }
    document.title = `● ${clockText(worked, false)} · ${BASE_TITLE}`;
    return undefined;
  }, [running, Math.floor(worked)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { document.title = BASE_TITLE; }, []);

  if (!user.employeeId || !w) return null;
  if (OFF_DAYS.includes(s.dayStatus) && !w.sessions.length) return null;
  const pct = Math.min(100, (worked / w.requiredMinutes) * 100);
  const left = w.requiredMinutes - worked;
  const popOut = () => openFloatingClock().then((ok) => { if (!ok) toast('Use Chrome or Edge on a computer to pop out the clock.', 'error'); }).catch(() => toast('The floating clock could not open.', 'error'));
  const start = async (mode) => {
    if (await run(() => checkIn({ mode }), 'Checked in. Your clock is running.') && pref) popOut();
  };

  return (
    <div ref={ref} className="clock-wrap">
      <button type="button" className={`work-clock ${running ? 'on' : w.sessions.length ? 'paused' : 'idle'}`} onClick={() => setOpen((o) => !o)} aria-label="Work clock">
        {running ? <span className="pulse" /> : w.sessions.length ? <Pause size={14} /> : <Timer size={15} />}
        <span className="t">{w.sessions.length ? clockText(worked) : 'Check in'}</span>
        {w.sessions.length > 0 && <span className="lbl">{running ? 'Working' : 'Paused'}</span>}
      </button>
      {open && (
        <div className="dropdown clock-panel">
          <div className="head" style={{ display: 'block' }}>
            <div className="row between"><span>{fmtDay(s.today)}</span>{running ? <Badge tone="green">Working</Badge> : w.sessions.length ? <Badge tone="gray">Paused</Badge> : null}</div>
          </div>
          <div style={{ padding: 14 }}>
            <div className="clock-big">{clockText(worked)}</div>
            <Progress value={pct} color={left <= 0 ? 'var(--green)' : 'var(--blue)'} />
            <div className="xs muted mt-8">{left <= 0 ? `Target of ${clockText(w.requiredMinutes, false)} reached` : `${clockText(left, false)} to go of ${clockText(w.requiredMinutes, false)}`}</div>
            <SessionList w={w} compact />
            <LocationLine />
            <div className="row wrap mt-16" style={{ gap: 8 }}>
              {!w.sessions.length && <><Button size="sm" variant="primary" icon={LogIn} loading={busy} onClick={() => start('office')}>Check in</Button><Button size="sm" icon={House} loading={busy} onClick={() => start('wfh')}>From home</Button></>}
              {running && <Button size="sm" icon={LogOut} loading={busy} onClick={() => run(() => checkOut(), (r) => `Checked out after ${r.worked}. Your clock is paused.`)}>Check out</Button>}
              {!running && w.sessions.length > 0 && <Button size="sm" variant="primary" icon={LogIn} onClick={() => { setOpen(false); setAsk(true); }}>Check in again</Button>}
              {canPopOut() && w.sessions.length > 0 && !pip && <Button size="sm" icon={PictureInPicture2} onClick={popOut}>Pop out clock</Button>}
            </div>
            {canPopOut() && (
              <label className="check xs mt-8"><input type="checkbox" checked={pref} onChange={(e) => { setPref(e.target.checked); writePref(e.target.checked); }} />Pop out the clock when I check in</label>
            )}
            {canPopOut() && <div className="xs muted mt-8">The floating clock stays on top of other windows, even when this app is minimised.</div>}
          </div>
        </div>
      )}
      {ask && <GapReasonModal onClose={() => setAsk(false)} />}
      {pip && createPortal(<FloatingClock s={s} />, pip.document.body)}
    </div>
  );
}

// Short days to explain, and (for managers) explanations to approve.
export function AttentionBanner() {
  const s = useWorkday();
  if (!s || (!s.toExplain && !s.toApprove)) return null;
  return (
    <div className="col mb-16" style={{ gap: 8 }}>
      {s.toExplain > 0 && <div className="alert warn"><CircleAlert size={16} /><span className="grow">You have {s.toExplain === 1 ? 'a day' : `${s.toExplain} days`} with fewer hours than required. Tell your manager why so {s.toExplain === 1 ? 'it counts' : 'they count'} in full.</span><Link to="/attendance?tab=short" className="b6">Explain</Link></div>}
      {s.toApprove > 0 && <div className="alert info"><CircleAlert size={16} /><span className="grow">{s.toApprove === 1 ? 'One short-hours explanation is' : `${s.toApprove} short-hours explanations are`} waiting for your approval.</span><Link to="/attendance?tab=short" className="b6">Review</Link></div>}
    </div>
  );
}

// ---------- office location ----------
// While the office-only rule is on, checks where the device is every 10
// minutes during work (all the time in strict mode) and records it. In
// strict mode the server signs the user out after leaving the office.
export function LocationGuard() {
  const { meta, logout, toast } = useApp();
  const s = useWorkday();
  const geo = meta?.geofence;
  const running = Boolean(s?.workday?.openSince);
  const track = Boolean(geo && geo.mode !== 'off' && !geo.exempt && (geo.mode === 'strict' || running));
  const warned = useRef(false);
  const last = useRef(0);
  useEffect(() => {
    if (!track) { setLocationStatus(null); return undefined; }
    let stop = false;
    const ping = async () => {
      last.current = Date.now();
      let pos;
      try { pos = await getPosition({ maxAgeMs: 0 }); } catch (e) { if (!stop) setLocationStatus({ ok: false, error: true, message: e.message }); return; }
      try {
        const r = await api.post('/attendance/location', pos);
        if (stop) return;
        setLocationStatus(r);
        if (r.signedOut) {
          try { sessionStorage.setItem('hrms.flash', r.message); } catch { /* storage blocked */ }
          await logout();
          return;
        }
        if (!r.ok && r.message && !warned.current) {
          warned.current = true;
          toast(r.office && r.distance != null
            ? `You seem to be outside the office (${fmtDistance(r.distance)} from ${r.office}). Your location is recorded while your clock runs.`
            : r.message, 'error');
        }
        if (r.ok) warned.current = false;
      } catch { /* offline: try again next time */ }
    };
    ping();
    const timer = setInterval(ping, 10 * 60000);
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - last.current > 2 * 60000) ping(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('hrms:location-changed', ping);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('hrms:location-changed', ping);
    };
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function LocationLine() {
  const { meta } = useApp();
  const st = useLocationStatus();
  const geo = meta?.geofence;
  if (!geo || geo.mode === 'off') return null;
  let text;
  let tone = 'muted';
  if (geo.exempt) text = `Location check not needed: ${geo.exempt.toLowerCase()}`;
  else if (!st) text = 'Location is checked while your clock runs';
  else if (st.error) { text = st.message; tone = 'red'; }
  else if (st.ok && st.method === 'network') { text = `On the office network · ${st.office}`; tone = 'green'; }
  else if (st.ok) { text = `In the office · ${st.office}${st.distance != null ? ` (${fmtDistance(st.distance)})` : ''}`; tone = 'green'; }
  else { text = st.message || 'Outside the office'; tone = 'red'; }
  return <div className={`xs mt-8 row gap-6 ${tone}`}><MapPin size={13} /><span>{text}</span></div>;
}

// ---------- explain a short day ----------
export function ExplainModal({ item, onClose, onDone }) {
  const { toast } = useApp();
  const prefill = item.gaps.filter((g) => g.reason).map((g) => `${g.reason}${g.note ? ` (${g.note})` : ''}, ${fmtTime(g.from)}–${fmtTime(g.to)}`).join('; ');
  const [reason, setReason] = useState(item.reason || prefill);
  const [run, busy] = useAction(toast);
  return (
    <Modal title={`Short hours on ${fmtDay(item.date)}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Later</Button><Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={async () => { if (await run(() => api.post(`/attendance/short-hours/${item.id}/explain`, { reason }), 'Sent to your manager for approval')) { onDone?.(); onClose(); } }}>Send to manager</Button></>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="alert warn"><TriangleAlert size={16} /><span>You worked <b>{clockText(item.worked_minutes, false)}</b> of <b>{clockText(item.required_minutes, false)}</b>. Your reporting manager (or the CEO) approves the reason; if they don't, the day is marked as a half day.</span></div>
        <SessionList w={{ sessions: item.sessions.map((x) => ({ ...x })), gaps: item.gaps }} />
        <Field label="Why were your hours short?"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. Client meeting at Thane ran late; I worked from home in the evening." /></Field>
      </div>
    </Modal>
  );
}

// Shown after sign-in: first "welcome back" if the clock was paused at
// sign-out, then any short days still to explain (once per browser session).
export function SignInPrompts() {
  const { user } = useApp();
  const s = useWorkday();
  const navigate = useNavigate();
  const [welcome, setWelcome] = useState(false);
  const [short, setShort] = useState(null);
  const shown = useRef({ welcome: false, short: false });
  const key = (k) => `hrms.prompt.${k}.${user.id}.${s?.today}`;
  const seen = (k) => { try { return sessionStorage.getItem(key(k)) === '1'; } catch { return shown.current[k]; } };
  const markSeen = (k) => { shown.current[k] = true; try { sessionStorage.setItem(key(k), '1'); } catch { /* storage blocked */ } };
  useEffect(() => {
    if (!s?.workday || user.mustChangePassword) return;
    if (s.workday.signedOutAway && !shown.current.welcome && !seen('welcome')) {
      shown.current.welcome = true;
      setWelcome(true);
      return;
    }
    if (welcome || short || shown.current.short || seen('short') || !s.toExplain) return;
    shown.current.short = true;
    api.get('/attendance/short-hours?view=mine&status=Awaiting%20explanation').then((r) => { if (r.items[0]) setShort(r.items[0]); }).catch(() => {});
  }, [s, welcome, short]); // eslint-disable-line react-hooks/exhaustive-deps
  if (welcome) return <GapReasonModal welcome onClose={() => { markSeen('welcome'); setWelcome(false); }} />;
  if (short) return <ExplainModal item={short} onClose={() => { markSeen('short'); setShort(null); }} onDone={() => { refreshWorkday().catch(() => {}); navigate('/attendance?tab=short'); }} />;
  return null;
}

// Sign-out while the clock is running: pause it (and be asked the reason
// on return) or keep it running.
export function SignOutModal({ onClose }) {
  const { logout } = useApp();
  const s = useWorkday();
  const [busy, setBusy] = useState(false);
  const go = async (pause) => { setBusy(true); await logout({ pause }); };
  return (
    <Modal title="You're checked in" size="narrow" onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={() => go(false)}>Keep clock running</Button>
        <Button variant="primary" icon={Pause} loading={busy} onClick={() => go(true)}>Pause clock and sign out</Button>
      </>}>
      <div className="col" style={{ gap: 10 }}>
        <p>Your work clock is at <b>{clockText(workedNow(s), false)}</b>. If you're stepping out (a meeting, lunch, an errand), pause it. When you sign in again you'll be asked the reason for the gap.</p>
        <p className="small muted">Keep it running only if you're still working, for example switching to another computer.</p>
      </div>
    </Modal>
  );
}
