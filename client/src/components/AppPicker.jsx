// After signing in: choose BrainADZ HRMS or BrainADZ Projects. People who came from the
// "Sign in with BrainADZ" button in Projects go straight back there instead.
import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useApp } from '../context.jsx';
import { openProjects } from '../lib/apps.js';
import { Monogram } from './icons.jsx';

export default function AppPicker({ direct, onHrms }) {
  const { user, logout } = useApp();
  const [busy, setBusy] = useState(direct);
  const [err, setErr] = useState(null);
  // Hands over to Projects; on failure the picker stays so HRMS is still one click away.
  const projects = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Opened next to this page (the combined demo): carry on into HRMS here.
      if (!(await openProjects())) onHrms();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };
  // Straight to Projects, once (StrictMode runs effects twice in development).
  const started = useRef(false);
  useEffect(() => {
    if (direct && !started.current) {
      started.current = true;
      projects();
    }
  });

  return (
    <div className="picker">
      <div className="picker-box">
        <Wordmark />
        {direct && busy ? (
          <p className="picker-wait">
            <LoaderCircle size={20} className="spin" />
            Opening Projects…
          </p>
        ) : (
          <>
            <h1>Welcome, {user.firstName}</h1>
            <p className="picker-q">Which app do you want to open?</p>
            <div className="picker-apps">
              <button type="button" className="picker-app" onClick={onHrms} disabled={busy}>
                <AppTile app="hrms" name="HRMS" />
                <span className="picker-text">
                  <b>HRMS</b>
                  <span>Attendance, leave, payslips, documents and your team</span>
                </span>
              </button>
              <button type="button" className="picker-app" onClick={projects} disabled={busy}>
                <AppTile app="projects" name="Projects" />
                <span className="picker-text">
                  <b>Projects</b>
                  <span>Projects, tasks, calendar and team groups</span>
                </span>
                {/* The whole card opens the app; a spinner shows while Projects opens */}
                {busy && (
                  <span className="picker-go">
                    <LoaderCircle size={20} className="spin" />
                  </span>
                )}
              </button>
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

// An app's tile: the Br logo with the app's name under it.
function AppTile({ app, name }) {
  return (
    <span className={`picker-ic ${app}`}>
      <Monogram height={40} color="#fff" label={null} />
      <span className="picker-ic-name">{name}</span>
    </span>
  );
}
