import '@fontsource-variable/inter';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
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
