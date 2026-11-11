// Turns demo/dist into one self-contained page (demo/dist/brainadz-events.html): the built
// script and stylesheet are inlined and the document wrapper dropped, as claude.ai adds its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.\//, '')), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`);
html = html.replace(
  /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_, src) => `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`,
);
if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('An asset was not inlined');
const out = path.join(dist, 'brainadz-events.html');
fs.writeFileSync(out, html.trim());
console.log(`${out} (${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB)`);
