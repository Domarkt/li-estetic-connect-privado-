import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: registra el service worker para que la app sea instalable y funcione el
// respaldo sin conexión. Best-effort — si falla, la web sigue funcionando igual.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* no bloquea la app */ });
  });
}
