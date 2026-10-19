// Installing BrainADZ Projects as an app: home-screen icon, full screen, quick start.
// Android and computers (Chrome, Edge) offer an install prompt; iPhones use Safari's
// "Add to Home Screen". Not used by the browser demo.
import { useEffect, useState } from 'react';

let deferred = null; // the browser's install prompt, kept until someone asks for it
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export function setupInstallableApp() {
  if (__DEMO__ || !import.meta.env.PROD) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

export const isInstalledApp = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// { kind: 'prompt', install() } | { kind: 'ios' } | null when installing is not available
export function useInstallApp() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  if (__DEMO__ || isInstalledApp()) return null;
  if (deferred) {
    return {
      kind: 'prompt',
      install: async () => {
        const prompt = deferred;
        deferred = null;
        prompt.prompt();
        await prompt.userChoice.catch(() => null);
        notify();
      },
    };
  }
  return isIPhone() ? { kind: 'ios' } : null;
}
