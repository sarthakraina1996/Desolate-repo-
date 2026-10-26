// After signing in: choose BrainADZ HRMS or BrainADZ Projects. People who came from the
// "Sign in with BrainADZ" button in Projects go straight back there instead.
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, FileText, LoaderCircle } from 'lucide-react';
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
            Opening BrainADZ Projects…
          </p>
        ) : (
          <>
            <h1>Welcome, {user.firstName}</h1>
            <p className="picker-q">Which app do you want to open?</p>
            <div className="picker-apps">
              <button type="button" className="picker-app" onClick={onHrms} disabled={busy}>
                <span className="picker-ic hrms">
                  <PeopleGlyph />
                  <span className="picker-badge">
                    <FileText size={16} strokeWidth={2.4} />
                  </span>
                </span>
                <span className="picker-text">
                  <b>BrainADZ HRMS</b>
                  <span>Attendance, leave, payslips, documents and your team</span>
                </span>
                <span className="picker-go">
                  <ArrowRight size={20} />
                </span>
              </button>
              <button type="button" className="picker-app" onClick={projects} disabled={busy}>
                <span className="picker-ic projects">
                  <ListGlyph />
                  <span className="picker-badge">
                    <Check size={16} strokeWidth={3} />
                  </span>
                </span>
                <span className="picker-text">
                  <b>BrainADZ Projects</b>
                  <span>Projects, tasks, calendar and team groups</span>
                </span>
                <span className="picker-go">
                  {busy ? <LoaderCircle size={20} className="spin" /> : <ArrowRight size={20} />}
                </span>
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

// Solid white glyphs for the app tiles: a team of three, and a task list.
function PeopleGlyph() {
  return (
    <svg className="picker-glyph" viewBox="0 0 48 40" fill="#fff" aria-hidden="true">
      <circle cx="10" cy="12" r="5" />
      <path d="M1 33v-3a8.5 8.5 0 0 1 14-6.5V33z" />
      <circle cx="38" cy="12" r="5" />
      <path d="M47 33v-3a8.5 8.5 0 0 0-14-6.5V33z" />
      <circle cx="24" cy="9" r="7" />
      <path d="M12 36v-5a12 12 0 0 1 24 0v5z" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg className="picker-glyph" viewBox="0 0 48 40" fill="#fff" aria-hidden="true">
      <circle cx="7" cy="7" r="4" />
      <rect x="15" y="4" width="28" height="6" rx="3" />
      <circle cx="7" cy="20" r="4" />
      <rect x="15" y="17" width="22" height="6" rx="3" />
      <circle cx="7" cy="33" r="4" />
      <rect x="15" y="30" width="14" height="6" rx="3" />
    </svg>
  );
}
