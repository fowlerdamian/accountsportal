import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Reload once when a stale code-split chunk fails to load (post-deploy).
// Vite emits "vite:preloadError" for failed dynamic imports.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('chunk-reload') === '1') return; // avoid loop
  sessionStorage.setItem('chunk-reload', '1');
  window.location.reload();
});
window.addEventListener('load', () => sessionStorage.removeItem('chunk-reload'));

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
