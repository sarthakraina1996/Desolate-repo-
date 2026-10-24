// Fetch wrapper for the Hospitality OS API. State-changing requests carry the CSRF header;
// errors carry status, code and details from the server; network failures are flagged offline.
export class ApiError extends Error {
  constructor(message, { status, code, details, offline } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.offline = offline;
  }
}

let idemCounter = 0;
// An idempotency key per user action, so a retried click cannot post twice.
export const newIdempotencyKey = () => `${Date.now().toString(36)}-${(++idemCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function api(path, { method = 'GET', body, form, idempotent = false } = {}) {
  const headers = { 'X-Requested-With': 'bhos' };
  const opts = { method, credentials: 'same-origin', headers };
  if (form) opts.body = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (idempotent && method !== 'GET') headers['Idempotency-Key'] = typeof idempotent === 'string' ? idempotent : newIdempotencyKey();
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    window.dispatchEvent(new Event('bhos:offline'));
    throw new ApiError(
      navigator.onLine === false ? 'You are offline. Changes cannot be saved until the connection returns.' : 'Cannot reach the Hospitality OS server.',
      { offline: true },
    );
  }
  window.dispatchEvent(new Event('bhos:online'));
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (res.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new Event('bhos:unauthorized'));
  if (res.status === 503 && data?.code === 'seeding') window.dispatchEvent(new CustomEvent('bhos:seeding', { detail: data.progress }));
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, { status: res.status, code: data?.code, details: data?.details });
  return data;
}
api.get = (p) => api(p);
api.post = (p, body = {}, o = {}) => api(p, { method: 'POST', body, ...o });
api.put = (p, body = {}, o = {}) => api(p, { method: 'PUT', body, ...o });

// Builds a query string, skipping empty values.
export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
}
