import { promises } from './fs.js';

// Stands in for node:fs/promises; only readFile, backed by the in-memory store in fs.js.
export const { readFile } = promises;
export default promises;
