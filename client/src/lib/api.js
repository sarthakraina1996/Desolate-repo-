// Thin fetch wrapper for the HRMS API. Every state-changing request carries
// the X-Requested-With header the server uses as its CSRF guard.
export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'hrms' } };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new Event('hrms:unauthorized'));
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.code;
    err.data = data;
    throw err;
  }
  return data;
}
api.get = (p) => api(p);
api.post = (p, body = {}) => api(p, { method: 'POST', body });
api.put = (p, body = {}) => api(p, { method: 'PUT', body });
api.del = (p) => api(p, { method: 'DELETE' });
api.upload = (p, form, method = 'POST') => api(p, { method, form });

// The claude.ai demo (demo/main.jsx) runs the server inside the page and sets
// window.hrmsDemo so photos and downloads go through it instead of HTTP.
const demo = () => window.hrmsDemo;

export function photoUrl(employeeId) {
  return demo() ? demo().photoUrl(employeeId) : `/api/files/photo/${employeeId}`;
}

// Opens a GET download (CSV, documents) using the session cookie.
export function download(path) {
  if (demo()) return demo().download(path);
  const a = document.createElement('a');
  a.href = `/api${path}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Saves the body of a POST response (e.g. a generated CSV) as a file.
export async function postDownload(path, body, filename) {
  const res = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'hrms', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || 'Download failed');
  }
  const blob = await res.blob();
  if (demo()) return demo().saveFile(blob, filename);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
