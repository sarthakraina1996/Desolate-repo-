// Express stand-in for the in-browser demo: just enough Router for the route modules.
class MiniRouter {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, fns) {
    const keys = [];
    const re = new RegExp(
      `^${pattern.replace(/[.]/g, '\\.').replace(/:([A-Za-z_]\w*)/g, (_, k) => {
        keys.push(k);
        return '([^/]+?)';
      })}/?$`,
    );
    this.routes.push({ method, re, keys, fns });
  }
  get(p, ...f) {
    this.add('GET', p, f);
  }
  post(p, ...f) {
    this.add('POST', p, f);
  }
  put(p, ...f) {
    this.add('PUT', p, f);
  }
  delete(p, ...f) {
    this.add('DELETE', p, f);
  }
  match(method, p) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(p);
      if (m) return { fns: r.fns, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}
export const Router = () => new MiniRouter();
const pass = () => (_req, _res, next) => next();
export default { Router, raw: pass, json: pass };
