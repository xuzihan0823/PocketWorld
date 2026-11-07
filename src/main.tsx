import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

const SkiStandalone = React.lazy(() => import('./components/computer/SkiStandalone'));
const directSki = new URLSearchParams(window.location.search).get('game') === 'ski';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {directSki ? <React.Suspense fallback={<div role="status">正在打开雪线逃脱…</div>}><SkiStandalone /></React.Suspense> : <App />}
  </React.StrictMode>
);
