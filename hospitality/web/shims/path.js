// The few node:path helpers the server modules call, for POSIX-style paths.
export const sep = '/';
export const join = (...p) => p.filter(Boolean).join('/').replace(/\/+/g, '/');
export const dirname = (p) => p.replace(/\/[^/]*$/, '') || '.';
export const basename = (p) => p.replace(/^.*\//, '');
export const extname = (p) => (basename(p).match(/\.[^.]*$/) || [''])[0];
export default { sep, join, dirname, basename, extname };
