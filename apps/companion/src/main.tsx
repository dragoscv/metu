import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PresenceHud } from './forms/Hud';
import { PresencePet } from './forms/Pet';
import { attachDeepLinkBridge } from './state/deepLink';
import './styles.css';

// Tauri loads each window with `index.html#<form>` (see tauri.conf.json
// windows[].url). We branch on the hash so a single Vite bundle drives the
// main panel, the HUD overlay, and the desktop pet.
function pickRoot() {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === 'hud') return <PresenceHud />;
  if (hash === 'pet') return <PresencePet />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{pickRoot()}</React.StrictMode>,
);

// Bridge fires once per process — only the main panel needs to listen
// for deep links since invoking `presence_hud_show` brings the HUD
// window forward regardless of which window is currently focused.
if (window.location.hash.replace(/^#/, '') === '') {
  void attachDeepLinkBridge();
}
