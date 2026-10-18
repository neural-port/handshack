import '@fontsource-variable/inter';
import '@handshack/ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@handshack/ui';
import { webServices } from './web-services.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App services={webServices} />
  </StrictMode>,
);
