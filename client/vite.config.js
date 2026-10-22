import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The client folder, so the config works when Vite is run from the repo root.
const here = path.dirname(fileURLToPath(import.meta.url));

// Dev server proxies /api to the Express server; builds go to client/dist.
export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${process.env.PORT || 3000}` },
  },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
