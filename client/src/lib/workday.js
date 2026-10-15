// Shared state of the signed-in employee's work clock: today's sessions,
// whether the clock is running, and what needs attention. The top-bar clock,
// the check-in cards and the prompts all read and update this one store.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './api.js';
import { withLocation } from './location.js';

let state = null;
let pending = null;
const subscribers = new Set();
const emit = () => subscribers.forEach((f) => f());
const subscribe = (f) => {
  subscribers.add(f);
  return () => subscribers.delete(f);
};

export function refreshWorkday() {
  if (pending) return pending;
  const sentAt = Date.now();
  pending = api.get('/attendance/workday').then((r) => {
    // Offset between the server clock and this device, so the running time
    // is right even when the device clock is not.
    const offset = Date.parse(r.serverNow) - (sentAt + Date.now()) / 2;
    state = { ...r, offset };
    emit();
    window.dispatchEvent(new Event('hrms:workday'));
    return state;
  }).finally(() => { pending = null; });
  return pending;
}

export function clearWorkday() {
  state = null;
  emit();
}

export function useWorkday() {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (!state) refreshWorkday().catch(() => {});
  }, []);
  return s;
}

// Re-renders every `ms` while mounted.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// Minutes worked today, counting a running session up to now.
export function workedNow(s, now = Date.now()) {
  const w = s?.workday;
  if (!w) return 0;
  const running = w.openSince ? Math.max(0, (now + (s.offset || 0) - Date.parse(w.openSince)) / 60000) : 0;
  return w.workedMinutes + running;
}

export const clockText = (minutes, seconds = true) => {
  const total = Math.floor(minutes * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return seconds ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${h}h ${String(m).padStart(2, '0')}m`;
};

// Office check-in needs the device's location when the office-only rule is on.
export async function checkIn(body) {
  const r = await withLocation((location) => api.post('/attendance/check-in', { ...body, ...(location ? { location } : {}) }));
  await refreshWorkday();
  return r;
}

export async function checkOut() {
  const r = await api.post('/attendance/check-out');
  await refreshWorkday();
  return r;
}

// Pages that show attendance reload when the clock changes.
export function useOnWorkdayChange(fn) {
  useEffect(() => {
    window.addEventListener('hrms:workday', fn);
    return () => window.removeEventListener('hrms:workday', fn);
  }, [fn]);
}
