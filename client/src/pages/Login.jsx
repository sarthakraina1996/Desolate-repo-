import { useEffect, useState } from 'react';
import { LogIn, Users, CalendarDays, CreditCard, Sparkles, MapPin } from 'lucide-react';
import { api } from '../lib/api.js';
import { withLocation } from '../lib/location.js';
import { useApp } from '../context.jsx';
import { Avatar, Field, Input } from '../components/ui.jsx';
import { Logo } from '../components/Layout.jsx';

export default function Login() {
  const { loadMe } = useApp();
  const [cfg, setCfg] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  // A message left by the app when it signed someone out (e.g. they left the office).
  const [flash] = useState(() => {
    try {
      const m = sessionStorage.getItem('hrms.flash');
      sessionStorage.removeItem('hrms.flash');
      return m;
    } catch { return null; }
  });
  useEffect(() => { api.get('/auth/config').then(setCfg).catch(() => setCfg({ demoAccounts: [] })); }, []);

  const signIn = async (e, creds) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await withLocation((location) => api.post('/auth/login', { ...(creds || { email, password }), ...(location ? { location } : {}) }), { onLocating: setLocating });
      await loadMe();
    } catch (ex) {
      setErr({ message: ex.message, outside: ex.code === 'outside_office' || ex.code === 'location_imprecise' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="left">
        <Logo />
        <div>
          <h2>Unified people operations across all BrainADZ verticals.</h2>
          <p>Hiring, onboarding, attendance, leave, payroll, performance, POSH and exits for BrainADZ Live, Marketing and Exhibits, in one place.</p>
          <div className="row wrap mt-16" style={{ gap: 18, marginTop: 28 }}>
            {[[Users, 'Employee records'], [CalendarDays, 'Leave & attendance'], [CreditCard, 'Indian payroll'], [Sparkles, 'AI resume screening']].map(([I, t]) => (
              <span key={t} className="row" style={{ gap: 8, color: 'rgba(255,255,255,.9)', fontSize: 14 }}><I size={18} />{t}</span>
            ))}
          </div>
        </div>
        <div style={{ fontFamily: 'Caveat, cursive', fontSize: 30, opacity: 0.9 }}>People · Power · Progress</div>
      </div>
      <div className="right">
        <div className="box">
          <h1 style={{ fontSize: 28, letterSpacing: '-0.5px' }}>Sign in</h1>
          <p className="muted mt-8">Welcome back to {cfg?.companyName || 'BrainADZ'} HRMS.</p>
          {cfg?.officeOnly && <p className="small muted mt-8 row gap-6"><MapPin size={15} />Sign-in works only from a {cfg.companyName || 'BrainADZ'} office. {window.hrmsDemo ? 'In this demo, choose where you are in the bottom-left corner.' : 'Your browser will ask to share your location.'}</p>}
          {flash && <div className="alert warn mt-16">{flash}</div>}
          <form className="col mt-16" style={{ gap: 14, marginTop: 24 }} onSubmit={signIn}>
            <Field label="Work email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brainadz.com" required /></Field>
            <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {err && <div className="alert error"><div>{err.message}{err.outside && <div className="mt-8">On an approved work-from-home or leave day you can sign in from anywhere.</div>}</div></div>}
            <button type="submit" className="btn primary lg block" disabled={busy}>{locating ? <MapPin size={18} /> : <LogIn size={18} />}{locating ? 'Checking your location…' : busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          {cfg?.demo && cfg.demoAccounts.length > 0 && (
            <div className="mt-16" style={{ marginTop: 28 }}>
              <div className="small muted b6 mb-8">DEMO ACCOUNTS · password {cfg.demoAccounts[0].password}</div>
              <div className="col" style={{ gap: 8 }}>
                {cfg.demoAccounts.map((a) => {
                  const name = a.email.split('@')[0].split('.').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
                  return (
                    <button key={a.email} type="button" className="demo-acc" disabled={busy} onClick={() => signIn(null, { email: a.email, password: a.password })}>
                      <Avatar name={name} size={34} />
                      <div className="grow"><div className="b6">{name}</div><div className="small muted">{a.email}</div></div>
                      <span className="badge b-blue">{a.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
