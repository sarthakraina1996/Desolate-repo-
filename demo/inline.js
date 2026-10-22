// Turns demo/dist into one self-contained page (demo/dist/brainadz-hrms.html):
// the built script and stylesheet are inlined, and the document wrapper is
// dropped because claude.ai adds its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
// Reads a built file referenced from index.html.
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.\//, '')), 'utf8');

// Inline the built stylesheet.
html = html.replace(
  /<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (_, href) => `<style>${read(href)}</style>`,
);
// Inline the module script, escaping `</script` in the bundle so it cannot end the tag early.
html = html.replace(
  /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_, src) => `<script type="module">${read(src).replace(/<\/script/gi, '<\\/script')}</script>`,
);
html = html
  .replace(/<!doctype html>|<\/?html[^>]*>|<\/?head>|<\/?body>|<meta charset[^>]*>/gi, '')
  .trim();
// The title must stay within the first 8 KB, so put it first.
const title = /<title>.*?<\/title>/.exec(html)[0];
html = `${title}\n${html.replace(title, '')}`;

// Fail the build if any asset reference survived.
if (/(src|href)="\.?\/?assets\//.test(html)) throw new Error('An asset was not inlined');
const out = path.join(dist, 'brainadz-hrms.html');
fs.writeFileSync(out, html);
console.log(`${out} (${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB)`);

// The same app as a complete document anyone can double-click to run in
// their browser, with nothing to install. Everything before the root div goes in <head>.
const at = html.indexOf('<div id="root"');
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root { color-scheme: light; } body { margin: 0; }</style>
${html.slice(0, at)}
</head>
<body>
${html.slice(at)}
</body>
</html>
`;
const file = path.join(dist, 'BrainADZ-HRMS.html');
fs.writeFileSync(file, standalone);
console.log(`${file} (${(Buffer.byteLength(standalone) / 1048576).toFixed(2)} MB)`);
