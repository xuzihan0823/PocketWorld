import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

// The cartridge sandboxes intentionally skip importing the room and Three.js.
const params = new URLSearchParams(window.location.search);
const devGame = params.get('dev');
const directSki = params.get('game') === 'ski' || devGame === 'mario';
const Entry = React.lazy<React.ComponentType>(() => devGame === 'resident'
  ? import('./scene/orbital/secondary/ResidentLab')
  : devGame === 'shooter'
  ? import('./games/shooter/dev')
  : directSki
    ? import('./components/computer/SkiStandalone')
    : import('./App').then(module => ({ default: module.App })));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<div role="status">正在打开 PocketWorld…</div>}><Entry /></React.Suspense>
  </React.StrictMode>
);
