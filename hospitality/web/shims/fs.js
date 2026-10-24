// The browser demo has no file system: directory creation is a no-op and no file exists.
export const mkdirSync = () => {};
export const existsSync = () => false;
export default { mkdirSync, existsSync };
