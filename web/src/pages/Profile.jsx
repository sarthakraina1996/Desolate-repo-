import { useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import { Field, Avatar, LEVEL_LABEL, VChip } from '../ui.jsx';

const COLORS = ['#1f2b7b', '#e31b3b', '#1a6df0', '#1fa855', '#f2a600', '#7c5cfc', '#ef4778', '#1fb2d6', '#0f766e', '#b45309'];

export default function Profile({ forced = false }) {
  const { me, verticals, toast, loadBoot } = useApp();
  const [f, setF] = useState({ name: me.name, title: me.title || '', phone: me.phone || '', color: me.color });
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwErr, setPwErr] = useState(null);
  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      await api.patch('/me', f);
      toast('Profile saved', 'success');
      loadBoot();
    } catch (e2) {
      toast(e2.message, 'error');
    }
  };
  const savePw = async (e) => {
    e.preventDefault();
    setPwErr(null);
    if (pw.next !== pw.again) return setPwErr('The two new passwords do not match');
    try {
      await api.post('/me/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', again: '' });
      toast('Password changed', 'success');
      loadBoot();
    } catch (e2) {
      setPwErr(e2.message);
    }
  };
  const pwForm = (
    <form className="card" onSubmit={savePw}>
      <div className="card-head"><h3>{forced ? 'Choose your own password' : 'Change password'}</h3></div>
      {forced && <p className="small muted mb-12">You signed in with a temporary password. Set your own to continue.</p>}
      {pwErr && <div className="alert error mb-12">{pwErr}</div>}
      <div className="col" style={{ gap: 12 }}>
        {!forced && <Field label="Current password" htmlFor="pw-cur"><input id="pw-cur" type="password" className="input" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></Field>}
        <Field label="New password" htmlFor="pw-new" hint="At least 8 characters"><input id="pw-new" type="password" className="input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={8} required /></Field>
        <Field label="New password again" htmlFor="pw-again"><input id="pw-again" type="password" className="input" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} autoComplete="new-password" minLength={8} required /></Field>
      </div>
      <button type="submit" className="btn primary mt-16">Save password</button>
    </form>
  );
  if (forced) return <div style={{ maxWidth: 460, margin: '40px auto' }}>{pwForm}</div>;
  return (
    <>
      <div className="page-head"><div><h1>My profile</h1><div className="sub">How you appear to your team.</div></div></div>
      <div className="grid">
        <form className="card span-6" onSubmit={saveProfile}>
          <div className="row mb-16" style={{ gap: 14 }}>
            <Avatar name={f.name} color={f.color} size={56} />
            <div><div className="b7" style={{ fontSize: 17 }}>{f.name}</div><div className="small muted">{me.email}</div></div>
          </div>
          <div className="form-grid">
            <Field label="Name" htmlFor="pr-name"><input id="pr-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
            <Field label="Job title" htmlFor="pr-title"><input id="pr-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Phone" htmlFor="pr-phone"><input id="pr-phone" className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
            <Field label="Avatar colour">
              <div className="row wrap" style={{ gap: 6 }}>
                {COLORS.map((c) => <button key={c} type="button" className={`swatch ${f.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} aria-label={`Colour ${c}`} />)}
              </div>
            </Field>
          </div>
          <button type="submit" className="btn primary mt-16">Save profile</button>
        </form>
        <div className="span-6 col" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-head"><h3>My access</h3></div>
            {me.role === 'admin' ? <p className="small">You are an admin and can see every vertical.</p> : verticals.length === 0 ? <p className="small muted">You have not been added to a vertical yet.</p> : (
              <div className="col" style={{ gap: 10 }}>
                {verticals.map((v) => <div key={v.id} className="row between"><VChip name={v.name} color={v.color} /><span className="small b6">{LEVEL_LABEL[v.level]}</span></div>)}
              </div>
            )}
            <p className="xs muted mt-12">An admin changes access under Team & Access.</p>
          </section>
          {!api.isDemo() && pwForm}
        </div>
      </div>
    </>
  );
}
