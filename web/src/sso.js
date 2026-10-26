// One sign-in with the BrainADZ HRMS: the HRMS address when the two apps are connected, and the
// one-time pass the HRMS sends people here with (after "#sso=" in the address).
import { useEffect, useState } from 'react';

let hrmsUrl = null;
// The HRMS address, or null when sign-in through it isn't set up (always null in the demo).
export const loadHrmsUrl = () =>
  (hrmsUrl ??= fetch('/api/auth/config').then((r) => r.json()).then((c) => c.hrms_url || null).catch(() => null));

export function useHrmsUrl(skip) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!skip) loadHrmsUrl().then(setUrl);
  }, [skip]);
  return url;
}

// Why a pass from the HRMS didn't sign the person in, for the sign-in page to show.
export let passProblem = null;

// Signs in with the pass in the address, if there is one, and takes it out of the address.
export async function signInWithPassInAddress() {
  const m = /^#sso=([\w-]+\.[\w-]+)$/.exec(window.location.hash);
  if (!m) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
  try {
    const res = await fetch('/api/auth/sso', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-bpm': '1' },
      body: JSON.stringify({ pass: m[1] }),
    });
    if (!res.ok) passProblem = (await res.json().catch(() => ({}))).error || 'Could not sign you in from the HRMS.';
  } catch {
    passProblem = 'Could not reach the server. Check your connection and try again.';
  }
}
