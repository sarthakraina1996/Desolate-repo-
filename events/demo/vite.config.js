// Builds the claude.ai demo: the whole system, server included, as one page.
// Node built-ins are swapped for browser stand-ins in demo/shims. Run with `npm run build:demo`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = (f) => path.join(here, 'shims', f);
const hrms = (f) => path.join(here, '..', '..', 'demo', 'shims', f);

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  define: { 'process.env': 'globalThis.process.env' },
  resolve: {
    alias: [
      { find: /^node:sqlite$/, replacement: hrms('sqlite.js') },
      { find: /^node:path$/, replacement: hrms('path.js') },
      { find: /^node:fs$/, replacement: shim('fs.js') },
      { find: /^node:crypto$/, replacement: shim('crypto.js') },
      { find: /^node:url$/, replacement: shim('url.js') },
      { find: /^express$/, replacement: shim('express.js') },
      { find: /^buffer$/, replacement: path.join(here, '..', 'node_modules', 'buffer', 'index.js') },
      { find: /^(node:http2|nodemailer)$/, replacement: shim('empty.js') },
    ],
  },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 20000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
