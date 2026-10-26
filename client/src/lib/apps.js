// One sign-in for BrainADZ HRMS and BrainADZ Projects: the app picker after signing in, and
// opening Projects with a one-time pass instead of a second password.
import { api } from './api.js';

// Session flags: show the picker after this sign-in, go straight to Projects, or an app was
// already chosen in this visit (so the landing picker doesn't come back).
const PICK = 'brainadz.pick';
const NEXT = 'brainadz.next';
const CHOSEN = 'brainadz.chosen';

// Kept in sessionStorage (so a reload keeps them) and in memory, because some browsers block
// storage in embedded pages such as the claude.ai demo; the picker must still show there.
const memory = new Map();
const read = (k) => {
  try {
    const v = sessionStorage.getItem(k);
    if (v !== null) return v;
  } catch {
    // Storage blocked: memory below.
  }
  return memory.get(k) ?? null;
};
const write = (k, v) => {
  if (v) memory.set(k, v);
  else memory.delete(k);
  try {
    if (v) sessionStorage.setItem(k, v);
    else sessionStorage.removeItem(k);
  } catch {
    // Storage blocked: memory has it for this visit.
  }
};

// "?app=projects" arrives from the "Sign in with BrainADZ" button in Projects. Remember it for
// after sign-in and take it out of the address bar.
export function takeAppRequest() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('app') !== 'projects') return;
  write(NEXT, 'projects');
  url.searchParams.delete('app');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export const wantsProjects = () => read(NEXT) === 'projects';
export const pickPending = () => read(PICK) === '1';
export const appChosen = () => read(CHOSEN) === '1';
// Called on a successful sign-in: the picker shows next, unless Projects was asked for.
export const markSignedIn = () => {
  write(CHOSEN, null);
  write(PICK, wantsProjects() ? null : '1');
};
// An app was chosen: no picker again in this visit.
export const clearAppFlags = () => {
  write(PICK, null);
  write(NEXT, null);
  write(CHOSEN, '1');
};

// Gets a one-time pass for the signed-in person and opens Projects with it. True when this
// page is leaving; false when the combined demo opened Projects next to it instead.
export async function openProjects() {
  const { url } = await api.post('/apps/projects/pass');
  clearAppFlags();
  if (window.hrmsDemo?.openApp) {
    window.hrmsDemo.openApp(url);
    return false;
  }
  window.location.assign(url);
  return true;
}
