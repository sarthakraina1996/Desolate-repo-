// Getting the HRMS onto a phone: install steps for Android and iPhone, a QR code to open it on a
// phone from a computer, a one-time install banner on phones, and the offline notice.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, EllipsisVertical, Share, SquarePlus, WifiOff, X } from 'lucide-react';
import { useApp } from '../context.jsx';
import { api } from '../lib/api.js';
import { canOfferApp, isPhone, useInstall, useOnline } from '../lib/pwa.js';
import { Button, Modal } from './ui.jsx';
import { Monogram } from './icons.jsx';

const BANNER_KEY = 'hrms.app.banner';
const localName = (host) => host === 'localhost' || host.startsWith('127.') || host === '[::1]';

function Step({ n, icon: Icon, children }) {
  return (
    <li className="app-step">
      <span className="app-step-n">{n}</span>
      <span>{children}</span>
      {Icon && (
        <span className="app-step-ic">
          <Icon size={18} />
        </span>
      )}
    </li>
  );
}

function AppIntro({ text }) {
  return (
    <div className="app-intro">
      <img src="/icons/icon-192.png" alt="" width="56" height="56" />
      <div>
        <b>BrainADZ HRMS</b>
        <span>{text}</span>
      </div>
    </div>
  );
}

function PhoneSteps({ app, onDone }) {
  const { toast } = useApp();
  if (app.canPrompt) {
    return (
      <>
        <AppIntro text="Opens full screen from your home screen, starts fast, and checks you in with one tap." />
        <Button
          variant="primary"
          icon={Download}
          className="app-wide"
          onClick={async () => {
            if (await app.install()) {
              toast('Installed. BrainADZ HRMS is on your home screen.', 'success');
              onDone();
            }
          }}
        >
          Install the app
        </Button>
      </>
    );
  }
  if (app.ios) {
    return (
      <>
        <AppIntro text="Add it to your home screen and it opens full screen, like any other app." />
        <ol className="app-steps">
          <Step n={1} icon={Share}>
            Tap the <b>Share</b> button in Safari's toolbar.
          </Step>
          <Step n={2} icon={SquarePlus}>
            Choose <b>Add to Home Screen</b>.
          </Step>
          <Step n={3}>
            Tap <b>Add</b>. The BrainADZ icon appears on your home screen.
          </Step>
        </ol>
      </>
    );
  }
  return (
    <>
      <AppIntro text="Add it to your home screen and it opens like any other app." />
      <ol className="app-steps">
        <Step n={1} icon={EllipsisVertical}>
          Open your browser's menu.
        </Step>
        <Step n={2}>
          Choose <b>Install app</b> or <b>Add to Home screen</b>.
        </Step>
        <Step n={3}>Confirm. The BrainADZ icon appears on your home screen.</Step>
      </ol>
      {!app.secure && (
        <div className="alert info mt-12">
          This address is not secure (http), so your phone adds a shortcut that opens in the
          browser. Use the online https:// address to install the full app.
        </div>
      )}
    </>
  );
}

// A QR code of `url` with the Br monogram in the middle (high error correction keeps it readable).
function Qr({ url }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 1,
      color: { dark: '#1b2848', light: '#ffffff' },
    })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div className="app-qr" role="img" aria-label={`QR code for ${url}`}>
      {/* The library returns a plain SVG drawing of our own address. */}
      <div className="app-qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="app-qr-logo">
        <Monogram height={20} color="#fff" label={null} />
      </span>
    </div>
  );
}

function ComputerSteps({ app, onDone }) {
  const { toast } = useApp();
  const here = window.location;
  const onServer = localName(here.hostname);
  const [urls, setUrls] = useState(onServer ? null : [here.origin]);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    if (!onServer) return;
    api
      .get('/meta/addresses')
      .then((r) => setUrls(r.urls))
      .catch(() => setUrls([]));
  }, [onServer]);
  const url = urls?.[pick];
  const copy = () =>
    navigator.clipboard?.writeText(url).then(
      () => toast('Address copied', 'success'),
      () => {},
    );
  return (
    <>
      <p className="app-lead">
        Scan this with your phone's camera to open the HRMS there, then add it to the home screen.
      </p>
      {urls === null && <div className="app-qr app-qr-wait" />}
      {urls && !url && (
        <div className="alert info">
          Phones cannot open "localhost". Start the HRMS on the office network (it prints the Wi-Fi
          address) or put it online, then open this again.
        </div>
      )}
      {url && (
        <>
          <Qr url={url} />
          {urls.length > 1 && (
            <div className="seg app-seg">
              {urls.map((u, i) => (
                <button
                  key={u}
                  type="button"
                  className={i === pick ? 'on' : ''}
                  onClick={() => setPick(i)}
                >
                  {u.replace(/^https?:\/\//, '')}
                </button>
              ))}
            </div>
          )}
          <div className="app-url">
            <span>{url}</span>
            <button type="button" className="icon-btn" onClick={copy} aria-label="Copy address">
              <Copy size={16} />
            </button>
          </div>
          <ol className="app-steps">
            <Step n={1}>Point the phone's camera at the code and open the link.</Step>
            <Step n={2}>Sign in with your usual email and password.</Step>
            <Step n={3}>
              On Android tap <b>Install app</b>; on iPhone tap <b>Share</b>, then{' '}
              <b>Add to Home Screen</b>.
            </Step>
          </ol>
          {url.startsWith('http:') && (
            <div className="alert info mt-12">
              On the office Wi-Fi it opens in the phone's browser. Installing it as a full app needs
              the online https:// address.
            </div>
          )}
        </>
      )}
      {app.canPrompt && (
        <Button
          icon={Download}
          className="app-wide mt-12"
          onClick={async () => {
            if (await app.install()) {
              toast('Installed on this computer', 'success');
              onDone();
            }
          }}
        >
          Install on this computer
        </Button>
      )}
    </>
  );
}

export function GetAppModal({ onClose }) {
  const app = useInstall();
  const phone = isPhone() || window.matchMedia?.('(pointer: coarse)').matches;
  return (
    <Modal title={phone ? 'Install the app' : 'Get the mobile app'} onClose={onClose} size="narrow">
      {app.installed ? (
        <AppIntro text="You are using the app. Find it on your home screen any time." />
      ) : phone ? (
        <PhoneSteps app={app} onDone={onClose} />
      ) : (
        <ComputerSteps app={app} onDone={onClose} />
      )}
    </Modal>
  );
}

// Once per phone: a small card offering the app, until it is installed or dismissed.
export function InstallBanner({ onHow }) {
  const app = useInstall();
  const { toast } = useApp();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(BANNER_KEY) === 'dismissed';
    } catch {
      return false;
    }
  });
  if (hidden || app.installed || !canOfferApp() || !isPhone() || (!app.canPrompt && !app.ios))
    return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(BANNER_KEY, 'dismissed');
    } catch {
      // storage blocked: hidden for this visit
    }
  };
  const install = async () => {
    if (!app.canPrompt) return onHow();
    if (await app.install()) toast('Installed. BrainADZ HRMS is on your home screen.', 'success');
    return undefined;
  };
  return (
    <div className="app-banner no-print">
      <img src="/icons/icon-192.png" alt="" width="40" height="40" />
      <div className="app-banner-text">
        <b>Get the app</b>
        <span>One-tap check-in, leave and payslips from your home screen.</span>
      </div>
      <button type="button" className="btn primary sm" onClick={install}>
        {app.canPrompt ? 'Install' : 'How'}
      </button>
      <button type="button" className="app-banner-x" onClick={dismiss} aria-label="Not now">
        <X size={16} />
      </button>
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  const { toast } = useApp();
  const was = useRef(online);
  useEffect(() => {
    if (online && !was.current) toast('Back online', 'success');
    was.current = online;
  }, [online, toast]);
  if (online) return null;
  return (
    <div className="offline-bar no-print" role="status">
      <WifiOff size={16} />
      You're offline. You can look around, but changes can't be saved until you're back online.
    </div>
  );
}
