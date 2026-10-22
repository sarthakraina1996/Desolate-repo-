// Stand-in for @simplewebauthn/server in the demo. Fingerprint check-in needs a real https site
// (passkeys are tied to it), so in the demo these always explain that instead of running.
const unavailable = async () => {
  const err = new Error('Fingerprint check-in works in the online HRMS, not in this demo.');
  err.status = 400;
  throw err;
};

export const generateRegistrationOptions = unavailable;
export const verifyRegistrationResponse = unavailable;
export const generateAuthenticationOptions = unavailable;
export const verifyAuthenticationResponse = unavailable;
