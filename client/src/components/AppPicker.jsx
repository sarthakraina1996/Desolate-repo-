// After signing in: choose BrainADZ HRMS, Projects or (when connected) CRM. People who came from the
// "Sign in with BrainADZ" button in Projects go straight back there instead.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context.jsx';
import { openCrm, openProjects } from '../lib/apps.js';
import { launch } from '../lib/launch.js';
import { Monogram } from './icons.jsx';

export default function AppPicker({ direct, onHrms }) {
  const { user, meta, logout } = useApp();
  const [busy, setBusy] = useState(direct);
  const [err, setErr] = useState(null);
  // The opening animation under way, if any.
  const fx = useRef(null);
  const hrms = async (e) => {
    setBusy(true);
    fx.current = launch(e.currentTarget, 'hrms');
    await fx.current.covered;
    onHrms();
    fx.current.done();
  };
  // Hands over to Projects once the animation fills the screen; on failure the picker comes
  // back so HRMS is still one click away.
  const projects = async (tile) => {
    setBusy(true);
    setErr(null);
    const opening = launch(tile, 'projects');
    fx.current = opening;
    try {
      // Opened next to this page (the combined demo): carry on into HRMS here.
      if (!(await openProjects(opening.covered))) {
        onHrms();
        opening.done();
      }
    } catch (e) {
      opening.cancel();
      setErr(e.message);
      setBusy(false);
    }
  };
  // The CRM has its own sign-in: a plain link, after the same opening animation.
  const crm = async (tile) => {
    setBusy(true);
    fx.current = launch(tile, 'crm');
    await openCrm(meta.crmUrl, fx.current.covered);
  };
  // Straight to Projects, once (StrictMode runs effects twice in development).
  const started = useRef(false);
  const directTile = useRef(null);
  useEffect(() => {
    if (direct && !started.current) {
      started.current = true;
      projects(directTile.current);
    }
  });
  // Back to this page from Projects (the browser kept it): the picker again, not the glow.
  useEffect(() => {
    const back = (e) => {
      if (!e.persisted) return;
      fx.current?.cancel();
      setBusy(false);
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  return (
    <div className="picker">
      <div className="picker-box">
        <Wordmark />
        {direct && busy ? (
          // The Projects tile, which opens by itself
          <div className="picker-apps" role="status" aria-label="Opening Projects">
            <div className="picker-app projects" ref={directTile}>
              <Monogram height={64} color="#fff" label={null} />
              <span className="picker-app-name">Projects</span>
            </div>
          </div>
        ) : (
          <>
            <h1>Welcome, {user.firstName}</h1>
            <p className="picker-q">Which app do you want to open?</p>
            <div className={`picker-apps${meta.crmUrl ? ' three' : ''}`}>
              <button
                type="button"
                className="picker-app hrms"
                onClick={hrms}
                disabled={busy}
                aria-label="Open HRMS"
              >
                <Monogram height={64} color="#fff" label={null} />
                <span className="picker-app-name">HRMS</span>
              </button>
              <button
                type="button"
                className="picker-app projects"
                onClick={(e) => projects(e.currentTarget)}
                disabled={busy}
                aria-label="Open Projects"
              >
                <Monogram height={64} color="#fff" label={null} />
                <span className="picker-app-name">Projects</span>
              </button>
              {meta.crmUrl && (
                <button
                  type="button"
                  className="picker-app crm"
                  onClick={(e) => crm(e.currentTarget)}
                  disabled={busy}
                  aria-label="Open CRM"
                >
                  <Monogram height={64} color="#fff" label={null} />
                  <span className="picker-app-name">CRM</span>
                </button>
              )}
            </div>
            {err && <div className="alert error">{err}</div>}
            <p className="picker-hint">You can switch apps any time from your name at the top.</p>
            <div className="picker-out">
              <button type="button" className="link" onClick={() => logout()}>
                Not {user.firstName}? Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The BrainADZ wordmark: the Br monogram as the first two letters, then "ainADZ".
function Wordmark() {
  return (
    <div className="picker-brand" role="img" aria-label="BrainADZ">
      <Monogram height="0.74em" color="currentColor" label={null} />
      <span aria-hidden="true">ainADZ</span>
      <sup aria-hidden="true">®</sup>
    </div>
  );
}
