import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Exposes the sql.js WebAssembly binary as a base64 string, so the demo build
// can run SQLite in the browser from a single self-contained HTML file.
function sqlWasmInline() {
  const id = 'virtual:sql-wasm';
  return {
    name: 'sql-wasm-inline',
    resolveId: (s) => (s === id ? '\0' + id : null),
    load(s) {
      if (s !== '\0' + id) return null;
      const b64 = readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')).toString('base64');
      return `export default ${JSON.stringify(b64)};`;
    },
  };
}

// Install-as-app tags (manifest, icons, phone status bar). Only for the real app: the
// browser demo is a single file inside another page, where none of this applies.
const APP_HEAD = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<meta name="theme-color" content="#f3f6fb" />',
  '<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
  '<meta name="apple-mobile-web-app-title" content="BrainADZ" />',
].join('\n    ');

function installableApp() {
  return { name: 'installable-app', transformIndexHtml: (html) => html.replace('</title>', `</title>\n    ${APP_HEAD}`) };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    root: 'web',
    publicDir: demo ? false : 'public',
    plugins: [react(), sqlWasmInline(), ...(demo ? [] : [installableApp()])],
    define: { __DEMO__: JSON.stringify(demo) },
    build: {
      outDir: demo ? '../dist-demo' : '../dist',
      emptyOutDir: true,
      cssCodeSplit: false,
      assetsInlineLimit: demo ? 100_000_000 : 4096,
      rollupOptions: demo ? { output: { inlineDynamicImports: true } } : {},
    },
    server: { proxy: { '/api': 'http://localhost:3000' } },
  };
});
