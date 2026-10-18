import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Strict production Content Security Policy for the static build.
 * Injected at build time only — the dev server keeps relaxed headers
 * (Vite's HMR needs websockets + inline preamble).
 */
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // frame-ancestors can't be delivered via <meta>; hosts that support custom
    // headers (not GitHub Pages) should add "X-Frame-Options: DENY".
  ].join('; ');
  return {
    name: 'handshack-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta name="color-scheme" content="dark" />',
        `<meta name="color-scheme" content="dark" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
  };
}

export default defineConfig({
  // Relative base — the build works under any hosting path (incl. GitHub Pages
  // project subpaths like /REPO/). Override with VITE_BASE_PATH if needed.
  base: process.env.VITE_BASE_PATH ?? './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  plugins: [react(), cspPlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  worker: {
    format: 'es',
  },
});
