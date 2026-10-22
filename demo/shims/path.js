// POSIX subset of node:path used by the server routes.
// Stands in for path.join; collapses slashes but does not resolve `.` or `..`.
export function join(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}
// Stands in for path.basename; no suffix-stripping second argument.
export function basename(p) {
  return String(p).split('/').pop();
}
// Stands in for path.dirname; a bare file name gives '/' rather than Node's '.'.
export function dirname(p) {
  const s = String(p).split('/');
  s.pop();
  return s.join('/') || '/';
}
// Stands in for path.extname; dotfiles such as `.env` have no extension, as in Node.
export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
}
export default { join, basename, dirname, extname };
