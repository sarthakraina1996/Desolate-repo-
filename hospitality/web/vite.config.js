import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// claude.ai web demo: the client plus the server code in one script. Node built-ins map to
// browser shims; assets (fonts, brand marks) are inlined because the page is a single file.
const here = path.dirname(fileURLToPath(import.meta.url));
const shim = (name) => path.join(here, 'shims', `${name}.js`);

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'node:crypto', replacement: shim('crypto') },
      { find: 'node:fs', replacement: shim('fs') },
      { find: 'node:path', replacement: shim('path') },
      { find: 'node:url', replacement: shim('url') },
      { find: 'node:sqlite', replacement: shim('sqlite') },
    ],
  },
  build: {
    outDir: path.join(here, 'dist-vite'),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 20_000,
    rollupOptions: {
      input: path.join(here, 'main.jsx'),
      output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app[extname]' },
    },
  },
});
