import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { migrateLegacyPreferences } from './legacy';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/atom-one-dark.css';
import './styles.css';

migrateLegacyPreferences();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {}); });
}
