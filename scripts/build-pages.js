// Copies the one-file demo into docs/ so GitHub Pages can serve it from this repo
// (Settings → Pages → Deploy from a branch → folder /docs).
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = path.join(root, 'docs');
mkdirSync(docs, { recursive: true });
copyFileSync(path.join(root, 'dist-demo', 'standalone.html'), path.join(docs, 'index.html'));
// Serve files as they are, without GitHub's Jekyll processing.
writeFileSync(path.join(docs, '.nojekyll'), '');
console.log('Wrote docs/index.html for GitHub Pages');
