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
              <button
                type="button"
                className="picker-app hrms"
                onClick={onHrms}
                disabled={busy}
                aria-label="Open HRMS"
              >
                <Monogram height={64} color="#fff" label={null} />
                <span className="picker-app-name">HRMS</span>
              </button>
              <button
                type="button"
                className="picker-app projects"
                onClick={projects}
                disabled={busy}
                aria-label="Open Projects"
              >
                {/* A spinner in place of the logo while Projects opens */}
                {busy ? (
                  <LoaderCircle size={64} strokeWidth={1.6} className="spin" />
                ) : (
                  <Monogram height={64} color="#fff" label={null} />
                )}
                <span className="picker-app-name">Projects</span>
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
