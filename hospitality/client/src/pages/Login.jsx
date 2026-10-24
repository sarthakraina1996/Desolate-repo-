// Sign-in with optional two-step (TOTP) verification; demo accounts listed while demo data exists.
import { useEffect, useState } from 'react';
import { LogIn, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../context.jsx';
import { Button, Field, Input, Notice } from '../components/ui.jsx';

export default function Login() {
  const { setSession } = useApp();
  const [config, setConfig] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/auth/config').then(setConfig).catch(() => setConfig({ demo: false, demoAccounts: [] }));
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) setSession(await api.post('/auth/mfa/verify', { challenge, code }));
      else {
        const r = await api.post('/auth/login', { email, password });
        if (r.mfaRequired) setChallenge(r.challenge);
        else setSession(r);
      }
    } catch (err) {
      setError(err.message);
      if (err.code === 'mfa_expired') setChallenge(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <div className="login-grid">
        <div className="login-hero">
          <img src="/brand/brainadz-live-logo.svg" alt="BrainADZ Live" style={{ height: 74 }} />
          <h1>BrainADZ Hospitality OS</h1>
          <p className="tagline">Intelligence for Hospitality. Control for Growth.</p>
          <ul className="login-points">
            <li>Reservations, booking calendar and front office</li>
            <li>Housekeeping, folios, ledgers and night audit</li>
            <li>Revenue, financial intelligence and multi-property control</li>
          </ul>
        </div>
        <form className="login-card" onSubmit={submit}>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>{challenge ? 'Two-step verification' : 'Sign in'}</h2>
          <p className="muted small" style={{ marginBottom: 16 }}>
            {challenge ? 'Enter the 6-digit code from your authenticator app.' : 'Use your BrainADZ Hospitality OS account.'}
          </p>
          <div className="stack" style={{ gap: 12 }}>
            {challenge ? (
              <Field label="Authenticator code">
                <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
              </Field>
            ) : (
              <>
                <Field label="Email">
                  <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                </Field>
                <Field label="Password">
                  <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
              </>
            )}
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="primary" icon={challenge ? ShieldCheck : LogIn} busy={busy}>
              {challenge ? 'Verify' : 'Sign in'}
            </Button>
          </div>
          {config?.demo && !challenge && (
            <div className="demo-accounts">
              <div className="small strong" style={{ marginBottom: 6 }}>
                Demo accounts <span className="muted" style={{ fontWeight: 400 }}>· password Hospitality@2026</span>
              </div>
              <div className="demo-list">
                {config.demoAccounts.map((a) => (
                  <button
                    type="button"
                    key={a.email}
                    onClick={() => {
                      setEmail(a.email);
                      setPassword('Hospitality@2026');
                    }}
                  >
                    <b>{a.name}</b>
                    <span>{a.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
