import { createRoot } from 'react-dom/client';
import './theme.css';
import './app.css';
import App from './App.jsx';
import { AppProvider } from './store.jsx';
import { RouterProvider } from './router.jsx';

async function start() {
  const root = createRoot(document.getElementById('root'));
  if (__DEMO__) {
    root.render(
      <div className="demo-boot">
        <b>Opening the BrainADZ Projects demo</b>
        <span>Loading sample projects for Live, Marketing and Exhibits</span>
        <div className="bar" />
      </div>,
    );
    const { startDemo } = await import('./demo/demo.js');
    try {
      await startDemo();
    } catch (e) {
      console.error(e);
      root.render(<div className="demo-boot"><b>The demo could not start</b><span>{String(e?.message || e)}</span></div>);
      return;
    }
  }
  root.render(
    <RouterProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </RouterProvider>,
  );
}

start();
