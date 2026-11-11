// Entry point of the claude.ai demo: starts SQLite and the Events server inside the page,
// sends the app's /api requests to it, and renders the normal web app.
import '../../demo/shims/env.js';
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import '@fontsource/jost/latin-400.css';
import '@fontsource/jost/latin-500.css';
import '@fontsource/jost/latin-600.css';
import '@fontsource/jost/latin-700.css';
import '../web/src/styles.css';
import { setSqlJs } from '../../demo/shims/sqlite.js';
import { createDemoServer } from './server.js';
import App from '../web/src/App.jsx';

const note = document.getElementById('demo-note');
Object.assign(note.style, {
  padding: '6px 16px',
  background: '#233e85',
  color: '#fff',
  font: '13px/1.4 system-ui',
  textAlign: 'center',
});
const base = 'Demo with fictional data, kept in this browser only. Reloading starts over.';
function say(text) {
  note.textContent = text;
  clearTimeout(say.t);
  say.t = setTimeout(() => (note.textContent = base), 6000);
}
note.textContent = base;

function installFetch(handle) {
  const real = window.fetch.bind(window);
  const cookies = {};
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/v1/')) return real(input, init);
    const u = new URL(url, 'https://demo.invalid');
    const headers = {};
    for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
    headers.cookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    const form = init.body instanceof FormData ? init.body : null;
    const res = await handle({
      method: (init.method || 'GET').toUpperCase(),
      path: u.pathname.slice('/api/v1'.length),
      query: Object.fromEntries(u.searchParams),
      headers,
      body: !form && typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {},
      formData: form,
    });
    for (const c of [].concat(res.headers['set-cookie'] || [])) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (/max-age=0/i.test(c)) delete cookies[pair.slice(0, i)];
      else cookies[pair.slice(0, i)] = pair.slice(i + 1);
    }
    return new Response(res.body, { status: res.statusCode, headers: { 'Content-Type': res.headers['content-type'] || 'text/plain' } });
  };
}

// Lets plain links and redirects (checkout, public site, displays) move around inside the page.
function Bridge() {
  const nav = useNavigate();
  useEffect(() => {
    window.__navigate = (to) => nav(to);
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]');
      const href = a?.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      if (href.startsWith('/api/')) {
        e.preventDefault();
        say('File downloads (CSV, uploaded files) are switched off in this Claude demo. They work in the installed version.');
      } else if (a.target === '_blank') {
        e.preventDefault();
        nav(href);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [nav]);
  return null;
}

// The Claude viewer has no confirm or print dialogs: confirm questions are answered yes.
window.confirm = () => true;
window.print = () => say('Printing is switched off in this Claude demo. It works in the installed version.');

initSqlJs().then((SQL) => {
  setSqlJs(SQL);
  installFetch(createDemoServer());
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <MemoryRouter>
        <Bridge />
        <App />
      </MemoryRouter>
    </StrictMode>,
  );
});
