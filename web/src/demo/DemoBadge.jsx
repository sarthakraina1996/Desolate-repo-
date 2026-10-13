import { useState } from 'react';
import { useApp } from '../store.jsx';

// Floating demo control, same style as the HRMS demo badge: switch person or reset data.
export function DemoBadge() {
  const { me, loadBoot, toast, confirm, refresh } = useApp();
  const [hidden, setHidden] = useState(false);
  const demo = window.__pmDemo;
  if (!demo || !me || hidden) return null;
  const people = demo.accounts();
  const others = demo.people().filter((p) => !people.some((a) => a.email === p.email));
  const switchTo = async (email) => {
    demo.signIn(email);
    await loadBoot();
    refresh();
  };
  const reset = async () => {
    if (!(await confirm({ title: 'Reset the demo?', message: 'This restores the sample projects and removes anything you added in this browser.', confirmLabel: 'Reset demo' }))) return;
    await demo.reset();
    await loadBoot();
    refresh();
    toast('Demo data restored', 'success');
  };
  return (
    <div className="demo-badge" role="region" aria-label="Demo controls">
      <b>Demo</b>
      <span className="place">
        Viewing as
        <select id="demo-person" value={me.email} onChange={(e) => switchTo(e.target.value)} aria-label="Switch person">
          <optgroup label="Suggested">
            {people.map((a) => <option key={a.email} value={a.email}>{a.name} · {a.label}</option>)}
          </optgroup>
          <optgroup label="Everyone else">
            {others.map((p) => <option key={p.email} value={p.email}>{p.name}{p.title ? ` · ${p.title}` : ''}</option>)}
          </optgroup>
        </select>
      </span>
      <button type="button" onClick={reset} title="Reset demo data" aria-label="Reset demo data" style={{ width: 'auto', padding: '0 8px', borderRadius: 8, fontSize: 12 }}>Reset</button>
      <button type="button" onClick={() => setHidden(true)} aria-label="Hide demo controls">×</button>
    </div>
  );
}
