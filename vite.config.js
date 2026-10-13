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

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    root: 'web',
    plugins: [react(), sqlWasmInline()],
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
