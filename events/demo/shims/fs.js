// In-memory file store standing in for node:fs: the migration files and demo uploads.
import { Buffer } from 'buffer';
import init from '../../server/migrations/001_init.sql?raw';

const files = new Map([['/server/migrations/001_init.sql', init]]);
const norm = (p) => String(p).replace(/\/+/g, '/');
export function writeFileSync(p, data) {
  files.set(norm(p), typeof data === 'string' ? data : Buffer.from(data));
}
export function readFileSync(p, enc) {
  const f = files.get(norm(p));
  if (f == null) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  return enc && typeof f !== 'string' ? f.toString(enc) : f;
}
export const existsSync = (p) => files.has(norm(p));
export const mkdirSync = () => {};
export const rmSync = (p) => files.delete(norm(p));
export const readdirSync = (dir) =>
  [...files.keys()].filter((k) => k.startsWith(`${norm(dir)}/`)).map((k) => k.slice(norm(dir).length + 1));
export default { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync };
