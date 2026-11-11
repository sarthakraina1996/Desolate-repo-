// Small fetch wrapper for the versioned API. The session lives in an HttpOnly cookie.
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = { 'X-Requested-With': 'brainadz-events' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Check the connection and try again.', 'offline');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong', data?.code);
  return data;
}
export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });

// Goes to a checkout or return address. The in-browser demo moves inside the page instead.
export const goTo = (url) => (window.__navigate ? window.__navigate(url) : window.location.assign(url));
