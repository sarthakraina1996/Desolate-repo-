// Fingerprint check-in on this device: set up a passkey, or confirm it's you before checking in.
// The phone's own fingerprint, face or screen lock does the check; the app never sees it.
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { api } from './api.js';

// Passkeys need a secure (https) page and a browser that supports them; the demo can't use them.
export const passkeysAvailable = () =>
  !window.hrmsDemo && window.isSecureContext && browserSupportsWebAuthn();

// Turns the browser's errors into something a person can act on.
function friendly(e) {
  if (e?.status) return e; // already a message from the server
  const err = new Error(
    e?.name === 'NotAllowedError'
      ? 'The fingerprint check was cancelled or timed out. Please try again.'
      : e?.name === 'InvalidStateError'
        ? 'This device is already set up for fingerprint check-in.'
        : e?.message || 'Fingerprint check-in is not available on this device.',
  );
  err.cancelled = e?.name === 'NotAllowedError';
  return err;
}

// Explains why passkeys can't be used here.
function unavailable() {
  return new Error(
    window.hrmsDemo
      ? 'Fingerprint check-in needs the online HRMS; it is not available in this demo.'
      : !window.isSecureContext
        ? 'Fingerprint check-in needs the secure https:// address of the HRMS.'
        : "This browser doesn't support fingerprint check-in. Try Chrome, Safari or Edge.",
  );
}

// Sets up fingerprint check-in on this device; also counts as confirming it's you once.
export async function setUpPasskey() {
  if (!passkeysAvailable()) throw unavailable();
  try {
    const optionsJSON = await api.post('/passkeys/register/options');
    return await api.post('/passkeys/register', await startRegistration({ optionsJSON }));
  } catch (e) {
    throw friendly(e);
  }
}

// Asks for the fingerprint so the next check-in is allowed.
export async function confirmIdentity() {
  if (!passkeysAvailable()) throw unavailable();
  try {
    const optionsJSON = await api.post('/passkeys/verify/options');
    await api.post('/passkeys/verify', await startAuthentication({ optionsJSON }));
  } catch (e) {
    throw friendly(e);
  }
}

// The app shell registers how to ask for a setup (a dialog); check-in calls it when needed.
let asker = null;
export function onSetupNeeded(fn) {
  asker = fn;
  return () => {
    if (asker === fn) asker = null;
  };
}
// Opens the setup dialog and resolves once fingerprint check-in is set up.
export function askForSetup() {
  if (!asker)
    return Promise.reject(new Error('Set up fingerprint check-in from your profile menu.'));
  return asker();
}
