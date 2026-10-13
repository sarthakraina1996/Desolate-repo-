// Turns the demo build (dist-demo/) into one self-contained HTML file that can be
// published as a claude.ai artifact or opened straight from disk.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'dist-demo');
const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
const read = (href) => readFileSync(path.join(dir, href.replace(/^\//, '')), 'utf8');

const js = [...html.matchAll(/<script type="module" crossorigin src="([^"]+)"><\/script>/g)].map((m) => read(m[1]));
const css = [...html.matchAll(/<link rel="stylesheet" crossorigin href="([^"]+)">/g)].map((m) => read(m[1]));
if (!js.length || !css.length) throw new Error('Could not find the built script or stylesheet in dist-demo/index.html');

const safeJs = js.join('\n').replace(/<\/script/gi, '<\\/script');
const page = [
  '<title>BrainADZ Projects</title>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Caveat:wght@600;700&display=swap">',
  `<style>${css.join('\n')}</style>`,
  '<div id="root"></div>',
  `<script type="module">${safeJs}</script>`,
].join('\n');

writeFileSync(path.join(dir, 'brainadz-projects.html'), page);
// A full document for opening locally.
writeFileSync(path.join(dir, 'standalone.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n${page}\n</body></html>`);
console.log(`Wrote dist-demo/brainadz-projects.html (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
