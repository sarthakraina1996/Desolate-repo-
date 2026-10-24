import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Client root for BrainADZ Hospitality OS; the dev server proxies /api to the hospitality API.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': `http://localhost:${process.env.PORT || 3100}` } },
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
