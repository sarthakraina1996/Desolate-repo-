import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Dev server proxies /api to the Express server; builds go to web/dist.
export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': `http://localhost:${process.env.PORT || 3100}` },
    fs: { allow: [path.join(here, '..')] },
  },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
