// In-memory file store standing in for node:fs. Uploaded resumes, photos and
// documents live here for as long as the page is open.
import { Buffer } from 'buffer';

const files = new Map();
// Collapses repeated slashes so differently joined paths find the same file.
const norm = (p) => String(p).replace(/\/+/g, '/');

// Stands in for fs.writeFileSync; stores a copy of the bytes, ignoring options.
export function writeFileSync(p, data) {
  files.set(norm(p), Buffer.from(data));
}
// Stands in for fs.readFileSync; always returns a Buffer and throws ENOENT like Node.
export function readFileSync(p) {
  const f = files.get(norm(p));
  if (!f) throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: 'ENOENT' });
  return f;
}
// Stands in for fs.existsSync; only files exist, not directories.
export function existsSync(p) {
  return files.has(norm(p));
}
// Stands in for fs.mkdirSync; a no-op since the store has no directories.
export function mkdirSync() {}
// Stands in for fs.rm; removes one file and ignores options such as recursive.
export function rm(p, _opts, cb) {
  files.delete(norm(p));
  cb?.(null);
}
// Stands in for fs.promises; only readFile is provided.
export const promises = { readFile: async (p) => readFileSync(p) };

export default { writeFileSync, readFileSync, existsSync, mkdirSync, rm, promises };
