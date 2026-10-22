import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './context.jsx';
import App from './App.jsx';
import { registerApp } from './lib/pwa.js';
import './styles.css';

// Lets phones and computers install the HRMS as an app and open it without a connection.
if (import.meta.env.PROD) registerApp();

// Mounts the app with routing and the shared app state.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
