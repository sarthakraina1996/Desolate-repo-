// Turns demo/dist into one self-contained page (demo/dist/brainadz-hrms.html):
// the built script and stylesheet are inlined, and the document wrapper is
// dropped because claude.ai adds its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.\//, '')), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(/<!doctype html>|<\/?html[^>]*>|<\/?head>|<\/?body>|<meta charset[^>]*>/gi, '').trim();
// The title must stay within the first 8 KB, so put it first.
const title = /<title>.*?<\/title>/.exec(html)[0];
html = `${title}\n${html.replace(title, '')}`;

if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('An asset was not inlined');
const out = path.join(dist, 'brainadz-hrms.html');
fs.writeFileSync(out, html);
console.log(`${out} (${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB)`);
