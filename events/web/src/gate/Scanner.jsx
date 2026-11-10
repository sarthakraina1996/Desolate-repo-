// Gate scanner for browsers and the Windows desktop app: camera or USB scanner, manual
// lookup, badge printing and overrides. It keeps working without a connection: scans are
// decided from the signed eligibility set, queued with stable ids and uploaded on reconnect.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { ArrowLeft, CircleAlert, CircleCheck, CircleX, Printer, RefreshCw, Search } from 'lucide-react';
import { get, post } from '../api.js';
import { Dialog, Loaded, Notice, Status, useAction, useFormDialog, useLoad, useToast } from '../ui.jsx';
import { QrCamera } from '../camera.jsx';
import { clock } from '../format.js';
import { decideOffline, isAdmit, newScanId, parseQr, RESULTS } from '../../../shared/scanRules.js';

const KEY = 'bae-gate';
const read = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}:${k}`)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k, v) => localStorage.setItem(`${KEY}:${k}`, JSON.stringify(v));
// Clears everything this device cached. Runs on sign-out of the gate and when it is revoked.
const purge = () => ['device', 'bundle', 'queue', 'history'].forEach((k) => localStorage.removeItem(`${KEY}:${k}`));

// Checks the eligibility set against the device key before trusting it.
async function verifyBundle(key, payload, signature) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('') === signature;
}

// Prints the badge sheet. In the Windows app the native shell prints silently to the badge
// printer and reports back; in a browser the print dialog opens.
function printSheet() {
  document.body.classList.add('printing-badge');
  const done = () => document.body.classList.remove('printing-badge');
  if (window.chrome?.webview) {
    return new Promise((resolve) => {
      const onMsg = (e) => {
        if (e.data?.type !== 'printResult') return;
        window.chrome.webview.removeEventListener('message', onMsg);
        done();
        resolve({ ok: Boolean(e.data.ok), error: e.data.error });
      };
      window.chrome.webview.addEventListener('message', onMsg);
      window.chrome.webview.postMessage({ type: 'printBadge' });
    });
  }
  window.print();
  done();
  return Promise.resolve({ ok: true });
}

export default function Scanner() {
  const context = useLoad(() => get('/gate/context'));
  const [device, setDevice] = useState(() => read('device', null));
  const leave = () => (purge(), setDevice(null));
  return (
    <Loaded load={context}>
      {(events) => {
        const ctx = device && events.find((e) => e.event.id === device.eventId);
        const gate = ctx?.gates.find((g) => g.id === device.gateId);
        if (device && gate) return <Gate device={device} ctx={ctx} gate={gate} onLeave={leave} />;
        return <ChooseGate events={events} onReady={(d) => (write('device', d), setDevice(d))} />;
      }}
    </Loaded>
  );
}

function ChooseGate({ events, onReady }) {
  const act = useAction();
  const enrol = (ev, gate) =>
    act(async () => {
      const windows = Boolean(window.chrome?.webview);
      const out = await post('/gate/devices', {
        gateId: gate.id,
        name: `${gate.name} ${windows ? 'desk PC' : 'browser'}`,
        platform: windows ? 'windows' : 'web',
      });
      onReady({ deviceId: out.deviceId, key: out.key, gateId: gate.id, eventId: ev.event.id });
    });
  return (
    <div className="scanner">
      <header>
        <strong>Gate scanner</strong>
      </header>
      <main id="main">
        {!events.length && (
          <Notice tone="error">
            You are not assigned to a gate. Ask the organiser to add you as gate staff. <Link to="/account">Back</Link>
          </Notice>
        )}
        {events.map((ev) => (
          <section key={ev.event.id} className="stack tight" aria-label={ev.event.name}>
            <h2>{ev.event.name}</h2>
            <p className="muted">Choose the gate you are working at. This device is then enrolled for that gate.</p>
            <div className="panel list">
              {ev.gates.map((g) => (
                <button key={g.id} className="list-row" onClick={() => enrol(ev, g)}>
                  <span className="grow">
                    <strong>{g.name}</strong>
                    <br />
                    <span className="muted small">Opens into {g.zoneName}</span>
                  </span>
                  {g.restricted && <Status tone="pending">Online only</Status>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

function Gate({ device, ctx, gate, onLeave }) {
  const toast = useToast();
  const act = useAction();
  const [form, ask] = useFormDialog();
  const [online, setOnline] = useState(navigator.onLine);
  const [bundle, setBundle] = useState(() => read('bundle', null));
  const [queue, setQueue] = useState(() => read('queue', []));
  const [syncedAt, setSyncedAt] = useState(() => read('bundle', null)?.loadedAt || null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null); // { result, name, passClass, passId, offline, earlier, conflict }
  const [job, setJob] = useState(null);
  const [badge, setBadge] = useState(null);
  const [lookup, setLookup] = useState(false);
  const [station, setStation] = useState(false);
  const [typed, setTyped] = useState('');
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const busy = useRef(false);
  const saveQueue = (q) => (write('queue', q), setQueue(q));

  // The server said this device was removed: clear cached data and stop.
  const revoked = useCallback(
    (e) => {
      if (e.code !== 'device_revoked') return false;
      toast('This device was removed from the event. Its saved data has been cleared.', 'error');
      onLeave();
      return true;
    },
    [onLeave, toast],
  );

  const loadBundle = useCallback(async () => {
    const b = await get(`/gate/devices/${device.deviceId}/bundle`);
    if (!(await verifyBundle(device.key, b.payload, b.signature)))
      throw new Error('The eligibility data failed its signature check and was not saved.');
    const parsed = { ...JSON.parse(b.payload), loadedAt: new Date().toISOString() };
    write('bundle', parsed);
    write('history', parsed.seen);
    setBundle(parsed);
    setSyncedAt(parsed.loadedAt);
  }, [device]);

  // Uploads queued scans, then refreshes the eligibility set. Safe to repeat: ids are stable.
  const sync = useCallback(
    async (manual) => {
      if (busy.current) return;
      busy.current = true;
      setSyncing(true);
      try {
        const pending = queueRef.current;
        if (pending.length) {
          const out = await post('/gate/scans/sync', { deviceId: device.deviceId, scans: pending, queuedCount: 0 });
          saveQueue(queueRef.current.filter((s) => !pending.some((p) => p.id === s.id)));
          if (out.conflicts)
            toast(
              `${out.conflicts} queued scan${out.conflicts > 1 ? 's were' : ' was'} also admitted on another device. Flagged for the organiser.`,
              'error',
            );
          else if (manual) toast(`${pending.length} queued scan${pending.length > 1 ? 's' : ''} uploaded`);
        } else await post(`/gate/devices/${device.deviceId}/heartbeat`, { queuedCount: 0 });
        await loadBundle();
        setOnline(true);
      } catch (e) {
        if (!revoked(e)) {
          if (e.status === 0) setOnline(false);
          if (manual) toast(e.status === 0 ? 'Still offline. Scans stay queued on this device.' : e.message, 'error');
        }
      }
      busy.current = false;
      setSyncing(false);
    },
    [device, loadBundle, revoked, toast],
  );

  useEffect(() => {
    sync(false);
    const up = () => sync(false);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const t = setInterval(() => sync(false), 20000);
    return () => (window.removeEventListener('online', up), window.removeEventListener('offline', down), clearInterval(t));
  }, [sync]);

  const remember = (tokenId, scannedAt) => write('history', [...read('history', []), { tokenId, zoneId: gate.zoneId, scannedAt }]);

  const onCode = async (text) => {
    if (result || lookup) return;
    setJob(null);
    const id = newScanId();
    const scannedAt = new Date().toISOString();
    const parsed = parseQr(text);
    try {
      const out = await post('/gate/scans', {
        gateId: gate.id,
        deviceId: device.deviceId,
        id,
        qr: text,
        scannedAt,
        queuedCount: queueRef.current.length,
      });
      setOnline(true);
      if (parsed && isAdmit(out.result)) remember(parsed.tokenId, scannedAt);
      setResult(out);
    } catch (e) {
      if (revoked(e)) return;
      if (e.status !== 0) return toast(e.message, 'error');
      // No connection: decide from the preloaded set and queue the scan for upload.
      setOnline(false);
      const local = parsed
        ? decideOffline({ bundle, gate, history: read('history', []), tokenId: parsed.tokenId, scannedAt })
        : { result: 'denied_unknown' };
      if (parsed && isAdmit(local.result)) remember(parsed.tokenId, scannedAt);
      saveQueue([...queueRef.current, { id, gateId: gate.id, qr: text, scannedAt, deviceResult: local.result }]);
      setResult({ ...local, offline: true, expired: local.expired });
    }
  };

  const manualAdmit = (p) =>
    act(async () => {
      setLookup(false);
      setJob(null);
      setResult(await post('/gate/scans', { gateId: gate.id, deviceId: device.deviceId, id: newScanId(), passId: p.passId }));
    });
  const override = () =>
    ask({
      title: 'Override and admit',
      submitLabel: 'Admit',
      intro: <p className="muted">Use only when you have checked the person's entitlement. Your name and the reason are recorded.</p>,
      fields: [{ key: 'reason', label: 'Reason', type: 'textarea', required: true }],
      onSubmit: async (v) =>
        setResult(
          await post('/gate/override', {
            gateId: gate.id,
            deviceId: device.deviceId,
            id: newScanId(),
            passId: result.passId,
            reason: v.reason,
          }),
        ),
    });
  const print = (reason) =>
    act(async () => {
      try {
        setJob(await post('/gate/print', { gateId: gate.id, passId: result.passId, reason }));
      } catch (e) {
        if (e.status === 400 && ctx.canReprint && !reason)
          return ask({
            title: 'Reprint badge',
            submitLabel: 'Reprint',
            intro: <p className="muted">This person already has a printed badge. Reprints are recorded.</p>,
            fields: [{ key: 'reason', label: 'Reason for reprint', required: true }],
            onSubmit: (v) => post('/gate/print', { gateId: gate.id, passId: result.passId, reason: v.reason }).then(setJob),
          });
        throw e.status === 403 ? new Error('This badge was already printed. Ask a supervisor for a reprint.') : e;
      }
    });
  // Prints one badge on this computer's own printer.
  const printHere = async (b) => {
    setBadge({ ...b, img: await QRCode.toDataURL(b.qr, { margin: 1, width: 400 }) });
    await new Promise((r) => setTimeout(r, 150));
    return printSheet();
  };

  // Print station: this computer takes the gate's queued badge jobs and prints them.
  useEffect(() => {
    if (!station) return undefined;
    let live = true;
    const loop = async () => {
      while (live) {
        try {
          const { job: j, badge: b } = await post('/gate/print-jobs/claim', { gateId: gate.id });
          if (j) {
            const out = await printHere(b);
            await post(`/gate/print-jobs/${j.id}/result`, { ok: out.ok, error: out.error });
            continue;
          }
        } catch {
          // Offline or busy: try again shortly.
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };
    loop();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, gate.id]);

  const info = result ? RESULTS[result.result] : null;
  const Icon = info?.tone === 'ok' ? CircleCheck : info?.tone === 'warn' ? CircleAlert : CircleX;
  const bundleStale = !bundle || Date.parse(bundle.expiresAt) < Date.now();
  return (
    <div className="scanner">
      <header>
        <div className="row between">
          <Link to="/account" className="btn plain" aria-label="Leave scanner">
            <ArrowLeft />
          </Link>
          <strong style={{ fontSize: 20 }}>{gate.name}</strong>
          <button className="btn plain" onClick={() => sync(true)} disabled={syncing} aria-label="Sync now">
            <RefreshCw />
          </button>
        </div>
        <div className={`sync-line ${online && !queue.length ? 'ok' : 'pending'}`} role="status">
          {online
            ? queue.length
              ? `Online · ${queue.length} queued, uploading`
              : `Online · synced ${clock(syncedAt) || 'just now'}`
            : `Offline · ${queue.length} queued`}
        </div>
        <div className="muted small">
          {ctx.event.name} · {gate.zoneName}
        </div>
      </header>

      {result ? (
        <>
          <main id="main">
            <div className={`result ${info.tone}`} role="alert">
              <Icon aria-hidden="true" />
              <div>
                <div className="t">{info.title}</div>
                <div>{info.hint}</div>
              </div>
            </div>
            {result.name && (
              <div>
                <h2>{result.name}</h2>
                <p className="muted" style={{ fontSize: 18 }}>
                  {[result.passClass, result.company].filter(Boolean).join(' · ')}
                </p>
              </div>
            )}
            {result.earlier && (
              <p>
                First admitted at {result.earlier.gate}, {clock(result.earlier.at)}.
              </p>
            )}
            {result.offline && (
              <Notice tone="pending">
                {result.expired
                  ? 'The saved eligibility data has expired. Reconnect to scan.'
                  : 'Decided offline from saved data. This scan is queued and will be checked when the connection returns.'}
              </Notice>
            )}
            {result.conflict && <Notice tone="error">Another device also admitted this pass. Flagged for the organiser.</Notice>}
            {info.tone !== 'ok' && (
              <section className="panel" aria-label="What to do">
                <div className="head">
                  <h3>What to do</h3>
                </div>
                <div className="list">
                  <button className="list-row" onClick={() => (setResult(null), setLookup(true))}>
                    <Search className="icon" aria-hidden="true" />
                    <span className="grow">Look the person up by name or reference</span>
                  </button>
                  {ctx.canOverride && result.passId && (
                    <button className="list-row" onClick={override}>
                      <CircleCheck className="icon" aria-hidden="true" />
                      <span className="grow">Override and admit, with a reason</span>
                    </button>
                  )}
                  <div>
                    <span className="muted">
                      Otherwise send the visitor to the help desk{ctx.canOverride ? '' : '. Only a supervisor can override'}.
                    </span>
                  </div>
                </div>
              </section>
            )}
            {job && (
              <Notice tone={job.status === 'printed' ? 'ok' : job.status === 'failed' ? 'error' : 'pending'}>
                {job.status === 'printed' ? (
                  `Badge printed on ${job.printer}.`
                ) : job.status === 'failed' ? (
                  <>
                    <strong>Printer problem: {job.error}.</strong> The visitor is still admitted.
                  </>
                ) : (
                  'Badge sent to the print station.'
                )}
                {job.status === 'failed' && (
                  <div className="row wrap" style={{ marginTop: 8 }}>
                    <button className="btn sm" onClick={() => act(() => post(`/gate/print-jobs/${job.id}/retry`).then(setJob))}>
                      Retry
                    </button>
                    <button className="btn sm" onClick={() => act(() => post(`/gate/print-jobs/${job.id}/spare`).then(setJob))}>
                      Use spare printer
                    </button>
                  </div>
                )}
              </Notice>
            )}
          </main>
          <footer>
            {isAdmit(result.result) && result.passId && ctx.canPrint && !job && (
              <button className="btn big block" onClick={() => print()}>
                <Printer aria-hidden="true" />
                Print badge
              </button>
            )}
            <button className="btn primary big block" autoFocus onClick={() => (setResult(null), setJob(null))}>
              Scan next
            </button>
          </footer>
        </>
      ) : (
        <>
          <main id="main">
            {bundleStale && !online && <Notice tone="error">The saved eligibility data has expired. Reconnect before scanning.</Notice>}
            {gate.restricted && <Notice tone="pending">This is a restricted area: scans here are only decided online.</Notice>}
            <QrCamera onCode={onCode} paused={lookup} />
            <form className="row" onSubmit={(e) => (e.preventDefault(), typed.trim() && onCode(typed.trim()), setTyped(''))}>
              <input
                className="input"
                autoFocus
                placeholder="USB scanner or typed code"
                aria-label="Pass code"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <button className="btn">Check</button>
            </form>
            <p className="muted small">Hold the visitor's QR in the frame. A USB scanner types into the box above.</p>
          </main>
          <footer>
            <button className="btn big block" onClick={() => setLookup(true)} disabled={!online}>
              <Search aria-hidden="true" />
              Manual lookup{online ? '' : ' (needs connection)'}
            </button>
            <label className="check small">
              <input type="checkbox" checked={station} onChange={(e) => setStation(e.target.checked)} />
              <span>Use this computer as the badge print station for {gate.name}</span>
            </label>
            <button
              className="btn plain sm"
              onClick={() =>
                window.confirm(
                  queue.length
                    ? `${queue.length} scans have not been uploaded and will be lost. Leave this gate anyway?`
                    : 'Leave this gate and clear its saved data from this device?',
                ) && onLeave()
              }
            >
              Change gate or sign this device out
            </button>
          </footer>
        </>
      )}
      {lookup && <Lookup gate={gate} onPick={manualAdmit} onClose={() => setLookup(false)} />}
      {form}
      {badge && (
        <div className="badge-sheet" aria-hidden="true">
          <div className="n">{badge.name}</div>
          <div>{badge.company}</div>
          <img src={badge.img} alt="" />
          <div>
            <strong>{badge.passClass}</strong> · {badge.event}
          </div>
        </div>
      )}
    </div>
  );
}

function Lookup({ gate, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const search = (e) => {
    e.preventDefault();
    get(`/gate/lookup?gateId=${gate.id}&q=${encodeURIComponent(q)}`)
      .then((r) => (setRows(r), setError(null)))
      .catch((er) => setError(er.message));
  };
  return (
    <Dialog title="Manual lookup" onClose={onClose}>
      <form className="row" onSubmit={search}>
        <input
          className="input"
          placeholder="Name, company, reference or email"
          aria-label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn primary">Search</button>
      </form>
      {error && <Notice tone="error">{error}</Notice>}
      {rows && (
        <div className="list" style={{ marginTop: 12 }}>
          {rows.map((p) => (
            <button key={p.passId} className="list-row" disabled={p.status !== 'active'} onClick={() => onPick(p)}>
              <span className="grow">
                <strong>{p.name}</strong>
                <br />
                <span className="muted small">{[p.company, p.passClass, p.ref, p.email].filter(Boolean).join(' · ')}</span>
              </span>
              {p.status !== 'active' ? (
                <Status tone="error">Cancelled</Status>
              ) : p.admittedAt ? (
                <Status tone="ok">In {clock(p.admittedAt)}</Status>
              ) : (
                <Status>Not yet in</Status>
              )}
            </button>
          ))}
          {!rows.length && <p className="empty">No one found. Check the spelling, or register them at the help desk.</p>}
        </div>
      )}
      <p className="muted small" style={{ marginTop: 12 }}>
        Check a photo ID before admitting someone found by lookup.
      </p>
    </Dialog>
  );
}
