import '@fontsource/baumans';
import '@handshack/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@handshack/ui';
import { desktopServices } from './electron-services.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App services={desktopServices} />
  </StrictMode>,
);
