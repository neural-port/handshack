import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const version = process.env.npm_package_version ?? '0.1.0';

export default defineConfig({
  main: {
    plugins: [
      // Bundle workspace code (@handshack/core) into the main-process output;
      // real node_modules deps (electron builtins) stay external.
      externalizeDepsPlugin({ exclude: ['@handshack/core', '@handshack/ui'] }),
    ],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: 'src/main/index.ts',
        // CJS main: Electron's 'electron' module is a patched require-hook —
        // the ESM loader resolves the bare specifier to the npm stub instead.
        output: { format: 'cjs', entryFileNames: '[name].cjs', inlineDynamicImports: true },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@handshack/core'] })],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: 'src/preload/index.ts',
        // Sandboxed preload scripts must be CJS in a single self-contained file.
        output: { format: 'cjs', entryFileNames: '[name].cjs', inlineDynamicImports: true },
      },
    },
  },
  renderer: {
    plugins: [react()],
    root: 'src/renderer',
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    build: {
      outDir: 'out/renderer',
      target: 'es2022',
      assetsInlineLimit: 0,
    },
  },
});
