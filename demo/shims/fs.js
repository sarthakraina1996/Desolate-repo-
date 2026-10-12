// In-memory file store standing in for node:fs. Uploaded resumes, photos and
// documents live here for as long as the page is open.
import { Buffer } from 'buffer';

const files = new Map();
const norm = (p) => String(p).replace(/\/+/g, '/');

export function writeFileSync(p, data) { files.set(norm(p), Buffer.from(data)); }
export function readFileSync(p) {
  const f = files.get(norm(p));
  if (!f) throw Object.assign(new Error(`ENOENT: no such file, open '${p}'`), { code: 'ENOENT' });
  return f;
}
export function existsSync(p) { return files.has(norm(p)); }
export function mkdirSync() {}
export function rm(p, _opts, cb) { files.delete(norm(p)); cb?.(null); }
export const promises = { readFile: async (p) => readFileSync(p) };

export default { writeFileSync, readFileSync, existsSync, mkdirSync, rm, promises };
