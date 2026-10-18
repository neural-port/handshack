/**
 * HandShack desktop — Electron main process.
 *
 * Security model: the renderer is fully isolated (contextIsolation, sandbox,
 * no nodeIntegration). All file access and cryptography happen HERE, in the
 * main process, driven by a narrow allow-listed IPC surface. Renderer input is
 * treated as untrusted and validated before use.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  decryptPackage,
  encryptFile,
  HandshackError,
  isManifestFileName,
  parseManifestBytes,
  sanitizeFileName,
  toHandshackError,
  validateChunkSize,
  validateInputFileSize,
  type PackageManifest,
  type ProgressEvent,
} from '@handshack/core';
import {
  existingPaths,
  FileByteSink,
  FileByteSource,
  fileExists,
  NodeCryptoProvider,
  readFileBytes,
} from '@handshack/core/node';
import type {
  DecryptParams,
  DecryptOutcome,
  EncryptParams,
  EncryptOutcome,
  InspectResult,
  PickedFile,
} from '../shared/api.js';
import { MAX_FILE_SIZE, MAX_MANIFEST_SIZE, MAX_PART_COUNT, MIN_PASSWORD_LENGTH } from '@handshack/core';

const provider = new NodeCryptoProvider();
let win: BrowserWindow | null = null;
let currentOp: AbortController | null = null;

/* ---------- IPC input validation ---------- */

function assertString(v: unknown, field: string, max = 4096): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) {
    throw new HandshackError('invalid-input', `${field}: expected non-empty string`);
  }
  return v;
}

function assertAbsPath(v: unknown, field: string): string {
  const s = assertString(v, field);
  if (!path.isAbsolute(s)) throw new HandshackError('invalid-input', `${field}: not absolute`);
  return path.normalize(s);
}

function assertPathArray(v: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > maxItems) {
    throw new HandshackError('invalid-input', `${field}: bad array`);
  }
  return v.map((p) => assertAbsPath(p, field));
}

function toIpcError(err: unknown): Error {
  const e = toHandshackError(err);
  // Structured errors travel over IPC as a tagged message the renderer decodes.
  const tagged = new Error(`${e.code}|${e.userMessage}`);
  tagged.name = 'HandshackError';
  return tagged;
}

async function pickedFiles(paths: string[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const p of paths) {
    const stat = await fs.stat(p);
    if (stat.isFile()) out.push({ path: p, name: path.basename(p), size: stat.size });
  }
  return out;
}

async function pickFiles(opts: Electron.OpenDialogOptions): Promise<PickedFile[]> {
  if (!win) return [];
  const r = await dialog.showOpenDialog(win, opts);
  if (r.canceled) return [];
  return pickedFiles(r.filePaths);
}

/* ---------- package inspection ---------- */

async function inspectPackage(rawPaths: unknown): Promise<InspectResult> {
  const paths = assertPathArray(rawPaths, 'paths', MAX_PART_COUNT + 1);
  const manifestPath = paths.find((p) => isManifestFileName(path.basename(p)));
  if (!manifestPath) {
    throw new HandshackError(
      'invalid-manifest',
      'no .hsmanifest.json selected',
      'No HandShack manifest was found among the selected files. Look for a file ending in .hsmanifest.json.',
    );
  }
  const manifest: PackageManifest = parseManifestBytes(await readFileBytes(manifestPath, MAX_MANIFEST_SIZE));
  const dir = path.dirname(manifestPath);

  const declared = new Set(manifest.parts.map((p) => p.name));
  const providedByName = new Map<string, string>();
  const unexpected: string[] = [];
  for (const p of paths) {
    const base = path.basename(p);
    if (p === manifestPath) continue;
    if (declared.has(base)) providedByName.set(base, p);
    else unexpected.push(base);
  }

  // Auto-resolve parts sitting next to the manifest — the common case after
  // downloading a package into one folder.
  const matched: string[] = [];
  for (const part of manifest.parts) {
    const provided = providedByName.get(part.name);
    if (provided) {
      matched.push(provided);
      continue;
    }
    const sibling = path.join(dir, part.name);
    if (await fileExists(sibling)) matched.push(sibling);
  }
  const matchedNames = new Set(matched.map((p) => path.basename(p)));
  const missing = manifest.parts.filter((p) => !matchedNames.has(p.name)).map((p) => p.name);
  return { manifestPath, manifest, matchedPartPaths: matched, missing, unexpected };
}

/* ---------- collision pre-scan ---------- */

async function findCollisions(dirRaw: unknown, baseRaw: unknown): Promise<string[]> {
  const dir = assertAbsPath(dirRaw, 'dir');
  const base = sanitizeFileName(assertString(baseRaw, 'baseName', 256));
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const manifestName = `${base}.hsmanifest.json`;
  const hits = names.filter(
    (n) => n === manifestName || (n.startsWith(`${base}.part`) && n.endsWith('.hsp')),
  );
  return hits;
}

/* ---------- encrypt ---------- */

async function handleEncrypt(raw: unknown, sender: Electron.WebContents): Promise<EncryptOutcome> {
  const params = raw as EncryptParams;
  const inputPath = assertAbsPath(params?.inputPath, 'inputPath');
  const outputDir = assertAbsPath(params?.outputDir, 'outputDir');
  const password = assertString(params?.password, 'password', 1024);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HandshackError('invalid-password', 'password below minimum length', `Enter a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const chunkSize = Number(params?.chunkSize);
  validateChunkSize(chunkSize);
  const overwrite = params?.overwrite === true;

  const inputStat = await fs.stat(inputPath).catch((e) => {
    throw e.code === 'ENOENT' ? new HandshackError('io-error', `missing input ${inputPath}`) : e;
  });
  validateInputFileSize(inputStat.size);
  if (inputStat.size > MAX_FILE_SIZE) throw new HandshackError('file-too-large');
  const dirStat = await fs.stat(outputDir).catch(() => null);
  if (!dirStat?.isDirectory()) throw new HandshackError('io-error', 'output dir missing', 'The selected output folder no longer exists.');
  if (path.resolve(inputPath).startsWith(path.resolve(outputDir) + path.sep) === false && path.dirname(inputPath) === outputDir) {
    // writing into the source folder is allowed — parts get distinct names
  }

  // Pre-scan for collisions so we fail BEFORE doing the cryptographic work.
  const base = sanitizeFileName(path.basename(inputPath));
  const collisions = await findCollisions(outputDir, base);
  if (!overwrite && collisions.length > 0) {
    throw new HandshackError('save-failed', `existing: ${collisions[0]}`, `Files for "${base}" already exist in the selected folder.`);
  }

  const ctrl = new AbortController();
  currentOp = ctrl;
  const report = (e: ProgressEvent) => sender.send('op:progress', e);

  const partPaths: string[] = [];
  const source = await FileByteSource.open(inputPath);
  try {
    const result = await encryptFile({
      source,
      fileName: path.basename(inputPath),
      password,
      chunkSize,
      provider,
      signal: ctrl.signal,
      onProgress: report,
      generator: 'handshack-desktop',
      openPartSink: (_i, name, size) => {
        const p = path.join(outputDir, name);
        partPaths.push(p);
        void size;
        return FileByteSink.create(p, overwrite);
      },
    });
    const manifestPath = path.join(outputDir, result.manifestFileName);
    await fs.writeFile(manifestPath, result.manifestText, 'utf8');
    return {
      manifestPath,
      partPaths,
      outputDir,
      packageId: result.packageId,
      originalName: result.originalName,
      originalSize: result.originalSize,
      encryptedSize: result.encryptedSize,
      chunkSize: result.chunkSize,
      manifestName: result.manifestFileName,
    };
  } finally {
    await source.close();
    currentOp = null;
  }
}

/* ---------- decrypt ---------- */

async function handleDecrypt(raw: unknown, sender: Electron.WebContents): Promise<DecryptOutcome> {
  const params = raw as DecryptParams;
  const manifestPath = assertAbsPath(params?.manifestPath, 'manifestPath');
  const savePath = assertAbsPath(params?.savePath, 'savePath');
  const password = assertString(params?.password, 'password', 1024);
  const overwrite = params?.overwrite === true;
  const partPaths = params?.partPaths ? assertPathArray(params.partPaths, 'partPaths', MAX_PART_COUNT) : undefined;

  const manifest = parseManifestBytes(await readFileBytes(manifestPath, MAX_MANIFEST_SIZE));

  // Resolve part paths: explicit list, else sibling files of the manifest.
  const dir = path.dirname(manifestPath);
  const resolved: { name: string; path: string }[] = [];
  const provided = new Map<string, string>();
  if (partPaths) for (const p of partPaths) provided.set(path.basename(p), p);
  for (const part of manifest.parts) {
    const p = provided.get(part.name) ?? path.join(dir, part.name);
    resolved.push({ name: part.name, path: p });
  }
  const existing = await existingPaths(resolved.map((r) => r.path));
  const existingSet = new Set(existing);
  const missing = resolved.filter((r) => !existingSet.has(r.path)).map((r) => r.name);
  if (missing.length > 0) {
    throw new HandshackError(
      'missing-parts',
      missing.join(', '),
      `Missing ${missing.length} part(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
    );
  }

  const ctrl = new AbortController();
  currentOp = ctrl;
  const report = (e: ProgressEvent) => sender.send('op:progress', e);

  const sources = await Promise.all(
    resolved.map(async (r) => ({
      name: r.name,
      source: await FileByteSource.open(r.path),
    })),
  );
  try {
    const result = await decryptPackage({
      manifest,
      parts: sources.map((s) => ({ name: s.name, source: s.source })),
      password,
      provider,
      signal: ctrl.signal,
      onProgress: report,
      openOutput: () => FileByteSink.create(savePath, overwrite),
    });
    return {
      outPath: savePath,
      fileName: result.fileName,
      size: result.size,
      sha256Hex: result.sha256Hex,
      packageId: result.packageId,
    };
  } finally {
    for (const s of sources) {
      if (s.source instanceof FileByteSource) await s.source.close();
    }
    currentOp = null;
  }
}

/* ---------- window ---------- */

function createWindow(): void {
  win = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 680,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#08090b',
    title: 'HandShack',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      navigateOnDragDrop: false,
    },
  });

  win.once('ready-to-show', () => win?.show());

  // No new windows, no remote navigation — this app is fully local.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  win.on('closed', () => (win = null));
}

/* ---------- IPC registration ---------- */

function registerIpc(): void {
  const wrap = <T>(fn: (raw: unknown, sender: Electron.WebContents) => Promise<T>) =>
    async (ev: Electron.IpcMainInvokeEvent, raw: unknown) => {
      try {
        return await fn(raw, ev.sender);
      } catch (err) {
        throw toIpcError(err);
      }
    };

  ipcMain.handle('file:pick-input', async () =>
    (await pickFiles({ properties: ['openFile'], filters: [{ name: 'All files', extensions: ['*'] }] })).at(0) ?? null,
  );
  ipcMain.handle('file:pick-package', () =>
    pickFiles({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'HandShack packages', extensions: ['json', 'hsp'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }),
  );
  ipcMain.handle('dialog:output-dir', async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose output folder',
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  ipcMain.handle('dialog:save-path', async (_e, rawName) => {
    if (!win) return null;
    const defaultName = sanitizeFileName(assertString(rawName, 'defaultName', 256));
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      title: 'Save restored file',
    });
    return r.canceled ? null : (r.filePath ?? null);
  });
  ipcMain.handle('package:inspect', (e, raw) => inspectPackage(raw).catch((err) => { throw toIpcError(err); }));
  ipcMain.handle('fs:find-collisions', (e, dir, base) => findCollisions(dir, base).catch((err) => { throw toIpcError(err); }));
  ipcMain.handle('fs:exists', (_e, p) => fileExists(assertAbsPath(p, 'path')));
  ipcMain.handle('fs:reveal', async (_e, p) => {
    const abs = assertAbsPath(p, 'path');
    shell.showItemInFolder(abs);
  });
  ipcMain.handle('op:encrypt', wrap(handleEncrypt));
  ipcMain.handle('op:decrypt', wrap(handleDecrypt));
  ipcMain.handle('op:cancel', async () => {
    currentOp?.abort();
  });
}

/* ---------- lifecycle ---------- */

app.whenReady().then(() => {
  // CSP is enforced by the <meta> tag in the packaged renderer's index.html.
  // Dev-mode HMR needs a looser policy, which lives only in the dev index.html —
  // see src/renderer/index.html and vite's dev tooling.
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
