// One sign-in for BrainADZ HRMS and BrainADZ Projects: the app picker after signing in, and
// opening Projects with a one-time pass instead of a second password.
import { api } from './api.js';

// Session flags: show the picker once after this sign-in, or go straight to Projects.
const PICK = 'brainadz.pick';
const NEXT = 'brainadz.next';

// sessionStorage can be blocked (private windows); the flags then simply don't stick.
const read = (k) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    if (v) sessionStorage.setItem(k, v);
    else sessionStorage.removeItem(k);
  } catch {
    // Nothing to do: the picker just won't show.
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
// Called on a successful sign-in: the picker shows next, unless Projects was asked for.
export const markSignedIn = () => write(PICK, wantsProjects() ? null : '1');
export const clearAppFlags = () => {
  write(PICK, null);
  write(NEXT, null);
};

// Gets a one-time pass for the signed-in person and opens Projects with it.
export async function openProjects() {
  const { url } = await api.post('/apps/projects/pass');
  clearAppFlags();
  window.location.assign(url);
}
