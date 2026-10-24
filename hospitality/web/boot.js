// Starts the in-browser API: loads SQLite (WebAssembly, or plain JavaScript where the page's
// security policy refuses WebAssembly), opens the demo database and routes /api requests to
// the server code instead of the network.
import { SqlJsDatabase } from './sqlite-adapter.js';
import { createWebServer } from './server.js';

// True when the page may compile WebAssembly (a security policy can refuse it).
function wasmAllowed() {
  try {
    new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    return true;
  } catch {
    return false;
  }
}

async function loadEngine(step) {
  try {
    if (!wasmAllowed()) throw new Error('WebAssembly is not allowed on this page');
    step('Starting the database engine');
    const wasmBinary = await fetch('sql-wasm.wasm').then((r) => {
      if (!r.ok) throw new Error(`sql-wasm.wasm: ${r.status}`);
      return r.arrayBuffer();
    });
    const init = (await import('sql.js/dist/sql-wasm.js')).default;
    return { SQL: await init({ wasmBinary }), engine: 'WebAssembly' };
  } catch (e) {
    console.warn('WebAssembly SQLite unavailable, using the JavaScript build:', e?.message || e);
    step('Starting the database engine (compatibility mode)');
    const init = (await import('sql.js/dist/sql-asm-memory-growth.js')).default;
    return { SQL: await init(), engine: 'JavaScript' };
  }
}

// The demo database ships gzip-compressed and base64-encoded in parts (claude.ai serves data
// files as text); the page lists them in window.BHOS_DEMO_DB.
async function loadDatabase(step) {
  const { parts, size } = window.BHOS_DEMO_DB || { parts: [], size: 0 };
  if (!parts.length) throw new Error('The demo database is missing from this page');
  let text = '';
  for (const name of parts) {
    const res = await fetch(name);
    if (!res.ok) throw new Error(`The demo database could not be loaded (${name}: ${res.status})`);
    text += (await res.text()).trim();
    step('Downloading the demo hotel group', size ? text.length / size : null, (text.length * 3) / 4);
  }
  step('Unpacking the demo hotel group');
  const bin = atob(text);
  let bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

// fetch() for /api/… goes to the in-browser server, with a cookie jar for the session.
function installFetch(server) {
  const network = window.fetch.bind(window);
  let cookie = '';
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('/api/')) return network(input, init);
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => (headers[k] = v));
    if (cookie) headers.cookie = cookie;
    let body;
    if (typeof init.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
    }
    const out = await server.handle({ method: (init.method || 'GET').toUpperCase(), url, headers, body });
    const set = out.headers['set-cookie'];
    if (set) {
      const [pair] = set.split(';');
      cookie = /max-age=0/i.test(set) ? '' : pair.trim();
    }
    const h = { ...out.headers };
    delete h['set-cookie'];
    return new Response([204, 304].includes(out.status) ? null : (out.body ?? ''), { status: out.status, headers: h });
  };
}

export async function boot(step) {
  const [{ SQL, engine }, bytes] = await Promise.all([loadEngine(step), loadDatabase(step)]);
  step('Opening the demo hotel group');
  const raw = new SqlJsDatabase(new SQL.Database(bytes));
  raw.exec('PRAGMA foreign_keys = ON');
  const server = createWebServer(raw);
  installFetch(server);
  return { engine };
}
