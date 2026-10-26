// After signing in: choose BrainADZ HRMS or BrainADZ Projects. People who came from the
// "Sign in with BrainADZ" button in Projects go straight back there instead.
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, FolderKanban, LoaderCircle, UsersRound } from 'lucide-react';
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
      await openProjects();
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
        {/* BrainADZ, not one app's name: this screen belongs to both */}
        <div className="picker-brand">
          <span className="picker-mark">
            <Monogram height={26} color="#fff" label={null} />
          </span>
          BrainADZ
        </div>
        {direct && busy ? (
          <p className="picker-wait">
            <LoaderCircle size={20} className="spin" />
            Opening BrainADZ Projects…
          </p>
        ) : (
          <>
            <h1>Welcome, {user.firstName}</h1>
            <p className="muted">Which app do you want to open?</p>
            <div className="picker-apps">
              <button type="button" className="picker-app" onClick={onHrms} disabled={busy}>
                <span className="picker-ic hrms">
                  <UsersRound size={24} />
                </span>
                <span className="picker-text">
                  <b>BrainADZ HRMS</b>
                  <span>Attendance, leave, payslips, documents and your team</span>
                </span>
                <ArrowRight size={18} className="picker-go" />
              </button>
              <button type="button" className="picker-app" onClick={projects} disabled={busy}>
                <span className="picker-ic projects">
                  <FolderKanban size={24} />
                </span>
                <span className="picker-text">
                  <b>BrainADZ Projects</b>
                  <span>Projects, tasks, calendar and team groups</span>
                </span>
                {busy ? (
                  <LoaderCircle size={18} className="spin picker-go" />
                ) : (
                  <ArrowRight size={18} className="picker-go" />
                )}
              </button>
            </div>
            {err && <div className="alert error">{err}</div>}
            <p className="small muted">You can switch apps any time from your name at the top.</p>
            <button type="button" className="link small" onClick={() => logout()}>
              Not {user.firstName}? Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
