// The installable app: service worker registration, the "Install the app" prompt and the
// online/offline state.
import { useEffect, useState } from 'react';

let deferred = null; // Chrome, Edge and Android hand over their install prompt here
let installedNow = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

// Listen from module load: the browser may offer the install prompt before React mounts.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // shown from our own button instead of the browser's mini bar
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

// Registers the service worker after page load; browsers only allow it over https.
export function registerApp() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// True when running as the installed app (navigator.standalone covers iOS Safari).
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
// iPhone or iPad; iPadOS reports itself as a Mac, so touch support gives it away.
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isPhone = () => window.matchMedia?.('(max-width: 760px)').matches ?? false;
// The demo runs inside a single page with no server; installing it makes no sense there.
export const canOfferApp = () => /^https?:$/.test(window.location.protocol) && !window.hrmsDemo;

// Install state for the UI and an install() that shows the browser's own prompt.
export function useInstall() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return {
    installed: isStandalone() || installedNow,
    canPrompt: Boolean(deferred), // one tap installs it (Android, Chrome and Edge on computers)
    ios: isIOS(),
    secure: window.isSecureContext,
    async install() {
      if (!deferred) return false;
      // A saved prompt can be shown only once.
      const prompt = deferred;
      deferred = null;
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      notify();
      return outcome === 'accepted';
    },
  };
}

// Whether the browser currently reports a network connection.
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
