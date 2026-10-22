# Agent notes

## Running the Windows desktop app from an agent shell

This environment exports `ELECTRON_RUN_AS_NODE=1`. With it set, Electron runs as
plain Node, `require('electron')` returns a path string, and the main process
crashes at `app.requestSingleInstanceLock()` — the packaged exe exits 0 with no
window and no error output.

Launch with the variable cleared:

```powershell
cd apps/desktop/release
$env:ELECTRON_RUN_AS_NODE=$null
start "" "HandShack-Portable-0.1.0.exe"
```

```bash
env -u ELECTRON_RUN_AS_NODE cmd //c start "" "HandShack-Portable-0.1.0.exe"
```

The same applies to `npm run dev:desktop`.

## Verification gates

```powershell
npx tsc --build --force
npx eslint .
npx vitest run
npm run build --workspace=apps/web
npm run verify:release
npm run package:win --workspace=apps/desktop
```

Web preview under a Pages-style subpath: `npm run serve:web` → http://localhost:4789/handshack/
