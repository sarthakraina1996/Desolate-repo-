// Web demo entry for claude.ai: boots the in-browser API, then mounts the same client as the
// hosted product with in-memory routing (the page's URL is not the app's to change).
import './globals.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import '../client/src/styles/tokens.css';
import '../client/src/styles/app.css';
import '../client/src/styles/pages.css';
import { AppProvider } from '../client/src/context.jsx';
import App from '../client/src/App.jsx';
import { boot } from './boot.js';

const status = document.getElementById('boot-status');
const bar = document.getElementById('boot-bar');
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
function step(text, fraction = null, bytes = null) {
  if (status) status.textContent = bytes != null ? `${text} · ${mb(bytes)}` : text;
  if (bar && fraction != null) bar.style.width = `${Math.round(fraction * 100)}%`;
}

boot(step)
  .then(() => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <MemoryRouter>
          <AppProvider>
            <App />
          </AppProvider>
        </MemoryRouter>
      </StrictMode>,
    );
  })
  .catch((e) => {
    console.error(e);
    step(`The demo could not start: ${e.message}. Reload the page to try again.`);
    document.getElementById('boot-card')?.classList.add('boot-failed');
  });
