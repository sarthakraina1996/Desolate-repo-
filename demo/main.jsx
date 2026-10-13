// Entry point of the claude.ai demo: starts SQLite and the HRMS server inside
// the page, routes the app's /api requests to it, and renders the normal app.
import './shims/env.js';
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { setSqlJs } from './shims/sqlite.js';
import { setSample } from './shims/anthropic.js';
import { createDemoServer } from './server.js';
import { AppProvider } from '../client/src/context.jsx';
import App from '../client/src/App.jsx';
import '../client/src/styles.css';
import './demo.css';

// A short message in the corner, for things that happen outside the app's
// own toasts (downloads).
function notice(text) {
  const el = document.getElementById('demo-notice');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(notice.t);
  notice.t = setTimeout(() => { el.hidden = true; }, 5000);
}

function installFetch(server) {
  const realFetch = window.fetch.bind(window);
  const cookies = {};
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, init);
    const u = new URL(url, 'https://demo.invalid');
    const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
    headers.cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    let body = {};
    let formData = null;
    if (init.body instanceof FormData) formData = init.body;
    else if (typeof init.body === 'string' && init.body) body = JSON.parse(init.body);
    const query = {};
    for (const [k, v] of u.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
    const res = await server.handle({ method: (init.method || 'GET').toUpperCase(), path: u.pathname.slice(4), query, headers, body, formData });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const [name, value] = setCookie.split(';')[0].split('=');
      if (/max-age=0/i.test(setCookie)) delete cookies[name.trim()];
      else cookies[name.trim()] = value;
      delete res.headers['set-cookie'];
    }
    return new Response(res.statusCode === 204 ? null : res.body, { status: res.statusCode, headers: res.headers });
  };
}

// Keeps in-app links inside the page. Plain <a href="/..."> links (payslip
// and letter views open in a new tab in the installed app) would otherwise
// navigate the claude.ai frame away from the demo.
function InAppLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest?.('a[href^="/"]');
      if (!a || e.defaultPrevented || e.button !== 0) return;
      e.preventDefault();
      navigate(a.getAttribute('href'));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);
  return null;
}

// Inside the Bengaluru office (about 40 m from its centre) and at home in
// Koramangala, about 5 km away.
const PLACES = {
  office: { lat: 12.97862, lng: 77.64112, accuracy: 25 },
  home: { lat: 12.9352, lng: 77.6245, accuracy: 30 },
};
let place = 'office';

async function boot() {
  setSqlJs(await initSqlJs());
  const server = createDemoServer();
  installFetch(server);

  let downloads = null;
  const photos = new Map();
  const saveFile = async (blob, filename) => {
    if (!downloads) return notice('Downloads are not available in this view of the demo.');
    try {
      await downloads.save({ filename, data: blob });
    } catch (e) {
      if (e?.code === 'declined') return;
      notice(e?.code === 'rejected_extension' ? `${filename} is a file type this demo cannot download.` : 'The file could not be saved.');
    }
  };
  window.hrmsDemo = {
    photoUrl(id) {
      const p = server.photo(id);
      if (!p) return null;
      if (!photos.has(p.key)) photos.set(p.key, URL.createObjectURL(p.blob));
      return photos.get(p.key);
    },
    async download(path) {
      const res = await fetch(`/api${path}`);
      if (!res.ok) return notice((await res.json().catch(() => ({}))).error || 'Download failed');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'download';
      await saveFile(await res.blob(), name);
    },
    saveFile,
    // Browsers in claude.ai cannot share a real location, so the corner
    // switcher stands in for the device's GPS.
    getPosition: () => ({ ...PLACES[place] }),
  };
  const placeSelect = document.getElementById('demo-place');
  placeSelect?.addEventListener('change', () => {
    place = placeSelect.value;
    window.dispatchEvent(new Event('hrms:location-changed'));
  });

  // Claude features light up once the viewer's claude.ai session answers.
  const claude = window.claude;
  if (claude?.use) {
    claude.use('sample').then((sample) => {
      if (!sample) return;
      setSample(sample);
      process.env.HRMS_AI = 'on';
    }).catch(() => {});
    claude.use('downloads').then((d) => { downloads = d; }).catch(() => {});
  }

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <MemoryRouter>
        <InAppLinks />
        <AppProvider>
          <App />
        </AppProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('root').innerHTML = '<div class="demo-boot"><b>The demo could not start.</b><span>Reload the page to try again.</span></div>';
});
