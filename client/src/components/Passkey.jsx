// Fingerprint check-in screens: the setup / status dialog, the prompt shown when a check-in needs
// it, and the reminder banner in My Space.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, ShieldCheck, Smartphone } from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../lib/api.js';
import { useApi } from '../lib/hooks.js';
import { fmtDate } from '../lib/format.js';
import { onSetupNeeded, passkeysAvailable, setUpPasskey } from '../lib/passkeys.js';
import { Button, Loading, Modal } from './ui.jsx';

// Why the setup button is disabled here, or null when it can be used.
const unavailableReason = () =>
  window.hrmsDemo
    ? 'Fingerprint check-in works in the online HRMS on your phone; it is not available in this demo.'
    : !window.isSecureContext
      ? 'Open the secure https:// address of the HRMS to use fingerprint check-in.'
      : !passkeysAvailable()
        ? "This browser doesn't support it. Use Chrome, Safari or Edge on your own phone."
        : null;

// Status and setup. `forCheckIn` is the version shown when a check-in is waiting on it.
export function PasskeyModal({ onClose, onDone, forCheckIn = false }) {
  const { toast } = useApp();
  const { data, reload } = useApi('/passkeys/me');
  const [busy, setBusy] = useState(false);
  const blocked = unavailableReason();
  // Runs the phone's own set-up prompt, then reports back.
  const setUp = async () => {
    setBusy(true);
    try {
      const r = await setUpPasskey();
      toast(`Fingerprint check-in is set up on ${r.label}.`, 'success');
      reload();
      onDone?.();
    } catch (e) {
      if (!e.cancelled) toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={forCheckIn ? 'Confirm it’s you before checking in' : 'Fingerprint check-in'}
      size="narrow"
      onClose={onClose}
      footer={
        data && !data.registered ? (
          <>
            <Button onClick={onClose}>{forCheckIn ? 'Not now' : 'Close'}</Button>
            <Button
              variant="primary"
              icon={Fingerprint}
              loading={busy}
              disabled={Boolean(blocked)}
              onClick={setUp}
            >
              Set up on this device
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      {!data ? (
        <Loading />
      ) : data.registered ? (
        // Already set up: where, and how to move it to a new phone
        <div className="pk-status">
          <span className="pk-ic ok">
            <ShieldCheck size={26} />
          </span>
          <div>
            <b>Set up on {data.label || 'your device'}</b>
            <div className="small muted">
              Since {fmtDate(data.createdAt)}
              {data.lastUsedAt ? ` · last used ${fmtDate(data.lastUsedAt)}` : ''}
            </div>
            <p className="small mt-8">
              {data.required
                ? 'Each check-in asks for your fingerprint, face or screen lock on that device.'
                : 'HR has not turned on fingerprint check-in yet. When they do, your check-ins will ask for it.'}{' '}
              Got a new phone? Ask HR to reset it, then set it up again.
            </p>
          </div>
        </div>
      ) : (
        // Not set up: what it is and what happens
        <div>
          <div className="pk-status">
            <span className="pk-ic">
              <Fingerprint size={26} />
            </span>
            <p className="small" style={{ margin: 0 }}>
              {forCheckIn
                ? 'Your company checks that it’s really you who starts your work clock. Set it up once on your own phone; after that, each check-in takes one touch.'
                : 'Your phone’s fingerprint, face or screen lock confirms it’s really you when you start your work clock, so no one else can check in for you.'}
            </p>
          </div>
          <ol className="app-steps mt-12">
            <li className="app-step">
              <span className="app-step-n">1</span>
              <span>
                Use <b>your own phone</b> (the one you check in with).
              </span>
              <span className="app-step-ic">
                <Smartphone size={18} />
              </span>
            </li>
            <li className="app-step">
              <span className="app-step-n">2</span>
              <span>
                Tap <b>Set up on this device</b> and confirm with your fingerprint, face or screen
                lock.
              </span>
            </li>
          </ol>
          <div className="xs muted mt-8">
            Your fingerprint stays on your phone; the HRMS never sees it. One device per person: to
            change phones, HR resets it.
          </div>
          {blocked && <div className="alert info mt-12">{blocked}</div>}
        </div>
      )}
    </Modal>
  );
}

// Lets a check-in open the setup dialog and wait for it (see askForSetup in lib/passkeys.js).
export function PasskeyPrompts() {
  const [ask, setAsk] = useState(null);
  useEffect(
    () =>
      onSetupNeeded(
        () =>
          new Promise((resolve, reject) => {
            setAsk({ resolve, reject });
          }),
      ),
    [],
  );
  if (!ask) return null;
  return (
    <PasskeyModal
      forCheckIn
      onDone={() => {
        setAsk(null);
        ask.resolve();
      }}
      onClose={() => {
        setAsk(null);
        const e = new Error('Check-in needs fingerprint check-in. Set it up to start your clock.');
        ask.reject(e);
      }}
    />
  );
}

// My Space reminder while fingerprint check-in is required but not set up yet.
export function PasskeyBanner() {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi(user.employeeId ? '/passkeys/me' : null);
  const done = useRef(false);
  const close = useCallback(() => {
    setOpen(false);
    if (done.current) reload();
  }, [reload]);
  if (!data?.required || data.registered) return null;
  return (
    <div className="alert warn mb-16" style={{ alignItems: 'center' }}>
      <Fingerprint size={18} />
      <span className="grow">
        Your company asks for a fingerprint check when you check in. Set it up once on your own
        phone.
      </span>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Set up
      </Button>
      {open && (
        <PasskeyModal
          onClose={close}
          onDone={() => {
            done.current = true;
            close();
          }}
        />
      )}
    </div>
  );
}

// HR's reset of someone's fingerprint check-in, used in Settings.
export const resetPasskey = (userId) => api.del(`/passkeys/user/${userId}`);
