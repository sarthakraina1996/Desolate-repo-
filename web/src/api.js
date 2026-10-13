// One client for both modes: the real server (fetch to /api) and the browser demo,
// which runs the same core API against SQLite in the page.

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

const demo = () => window.__pmDemo;

function qs(query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request(method, path, { query, body } = {}) {
  if (demo()) {
    try {
      return await demo().request(method, path, { query, body });
    } catch (e) {
      throw new ApiError(e.status || 500, e.message || 'Something went wrong', e.code);
    }
  }
  const res = await fetch(`/api${path}${qs(query)}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-bpm': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.code);
  }
  return data;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body = {}) => request('POST', path, { body }),
  patch: (path, body = {}) => request('PATCH', path, { body }),
  put: (path, body = {}) => request('PUT', path, { body }),
  del: (path) => request('DELETE', path),

  isDemo: () => !!demo(),

  upload(projectId, file, fields = {}, onProgress) {
    if (demo()) return demo().upload(projectId, file, fields).catch((e) => Promise.reject(new ApiError(e.status || 500, e.message, e.code)));
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, v);
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/projects/${projectId}/upload`);
      xhr.setRequestHeader('x-bpm', '1');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, data?.error || `Upload failed (${xhr.status})`, data?.code));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Check your connection and try again.'));
      xhr.send(fd);
    });
  },

  // URL usable as <img src>, or null when the file has no viewable content.
  async previewUrl(file) {
    if (file.kind === 'link') return null;
    if (file.storage_key?.startsWith('sample:')) return null;
    if (demo()) return demo().blobUrl(file);
    return `/api/files/${file.id}/download?inline=1`;
  },

  async download(file) {
    if (file.kind === 'link') {
      window.open(file.url, '_blank', 'noopener');
      return;
    }
    if (file.storage_key?.startsWith('sample:')) {
      throw new ApiError(404, 'This is a sample record from the demo data, so there is no file to download. Upload your own file to try it.');
    }
    if (demo()) return demo().download(file);
    const a = document.createElement('a');
    a.href = `/api/files/${file.id}/download`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  async saveText(filename, text, type = 'text/csv') {
    if (demo()) return demo().saveText(filename, text, type);
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};
