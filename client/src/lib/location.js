// The device's location for the office sign-in check, and the latest result
// of the in-office check for the clock panel.
import { useSyncExternalStore } from 'react';

const ERRORS = {
  1: 'Location access is blocked for this site. Allow location in your browser’s site settings, then try again.',
  2: 'Your location could not be found. Turn on location services (and Wi-Fi on a laptop), then try again.',
  3: 'Getting your location took too long. Try again, ideally near a window or on the office Wi-Fi.',
};

function geoError(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// { lat, lng, accuracy } from the browser, or from the demo's location
// switcher when running as the claude.ai demo.
export function getPosition({ maxAgeMs = 60000 } = {}) {
  if (window.hrmsDemo?.getPosition) return Promise.resolve(window.hrmsDemo.getPosition());
  if (!window.isSecureContext) return Promise.reject(geoError('Location only works over a secure (https) connection. Ask your administrator to add this office network in Settings → Office locations.', 'geo_insecure'));
  if (!navigator.geolocation) return Promise.reject(geoError('This browser cannot share its location.', 'geo_unavailable'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(geoError(ERRORS[e.code] || 'Your location could not be found.', 'geo_failed')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: maxAgeMs },
    );
  });
}

// Calls `request(location)` without a location first; if the server asks
// for one, gets it and tries again. `onLocating` lets the UI say so.
export async function withLocation(request, { onLocating } = {}) {
  try {
    return await request(null);
  } catch (e) {
    if (e.code !== 'location_required') throw e;
    onLocating?.(true);
    try {
      return await request(await getPosition({ maxAgeMs: 0 }));
    } finally {
      onLocating?.(false);
    }
  }
}

// Latest in-office check while working: { ok, office, distance, method, message, at }.
let status = null;
const subscribers = new Set();
export function setLocationStatus(s) {
  status = s ? { ...s, at: Date.now() } : null;
  subscribers.forEach((f) => f());
}
export function useLocationStatus() {
  return useSyncExternalStore((f) => { subscribers.add(f); return () => subscribers.delete(f); }, () => status);
}

export const fmtDistance = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
