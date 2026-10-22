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
import { MAX_INPUT_FILE_SIZE, MAX_MANIFEST_SIZE, MAX_PART_COUNT, MIN_PASSWORD_LENGTH } from '@handshack/core';

const provider = new NodeCryptoProvider();
let win: BrowserWindow | null = null;
let currentOp: AbortController | null = null;
/**
 * Paths the user picked in a native dialog or the app itself produced this
 * session. The renderer may only touch the file system through these, so a
 * compromised renderer cannot probe or write arbitrary locations.
 */
const approvedPaths = new Set<string>();

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

function assertApproved(v: unknown, field: string): string {
  const abs = assertAbsPath(v, field);
  if (!approvedPaths.has(abs)) {
    throw new HandshackError('invalid-input', `${field}: path was not selected in this session`);
  }
  return abs;
}

function assertApprovedPathArray(v: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > maxItems) {
    throw new HandshackError('invalid-input', `${field}: bad array`);
  }
  return v.map((p) => assertApproved(p, field));
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
    if (!stat.isFile()) continue;
    approvedPaths.add(p);
    out.push({ path: p, name: path.basename(p), size: stat.size });
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
  const paths = assertApprovedPathArray(rawPaths, 'paths', MAX_PART_COUNT + 1);
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
  for (const m of matched) approvedPaths.add(m);
  const matchedNames = new Set(matched.map((p) => path.basename(p)));
  const missing = manifest.parts.filter((p) => !matchedNames.has(p.name)).map((p) => p.name);
  return { manifestPath, manifest, matchedPartPaths: matched, missing, unexpected };
}

/* ---------- collision pre-scan ---------- */

async function findCollisions(dirRaw: unknown, baseRaw: unknown): Promise<string[]> {
  const dir = assertApproved(dirRaw, 'dir');
  const base = sanitizeFileName(assertString(baseRaw, 'baseName', 256));
  const names = await fs.readdir(dir).catch((err: unknown) => {
    throw new HandshackError(
      'io-error',
      `cannot list ${dir}: ${String(err)}`,
      'The output folder could not be read. Choose another folder.',
    );
  });
  const manifestName = `${base}.hsmanifest.json`;
  const hits = names.filter(
    (n) => n === manifestName || (n.startsWith(`${base}.part`) && n.endsWith('.hsp')),
  );
  return hits;
}

class OutputCommitError extends HandshackError {
  readonly recoveryDataRetained = true;

  constructor(stageDir: string, details: string) {
    super(
      'save-failed',
      `output commit rollback failed; recovery files retained at ${stageDir}: ${details}`,
      'The package could not be fully saved. Recovery files were retained in a hidden folder in the output directory; do not remove it.',
    );
  }
}

/**
 * Publish a staged set of files as one recoverable transaction. Existing files
 * are moved aside first, and restored if any later rename fails.
 */
async function commitStagedFiles(
  stagedPaths: string[],
  finalPaths: string[],
  backupDir: string,
  overwrite: boolean,
): Promise<void> {
  if (stagedPaths.length !== finalPaths.length) {
    throw new HandshackError('internal-error', 'staged and final file counts differ');
  }
  await fs.mkdir(backupDir, { recursive: true });
  const installed: string[] = [];
  const backups: { backup: string; target: string }[] = [];
  try {
    for (let i = 0; i < finalPaths.length; i++) {
      const target = finalPaths[i]!;
      const staged = stagedPaths[i]!;
      let existing: Awaited<ReturnType<typeof fs.lstat>> | null = null;
      try {
        existing = await fs.lstat(target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      if (existing) {
        if (!overwrite) {
          throw new HandshackError('save-failed', `destination appeared during write: ${target}`);
        }
        if (!existing.isFile()) {
          throw new HandshackError('save-failed', `refusing to replace a non-file destination: ${target}`);
        }
        const backup = path.join(backupDir, `${i}.backup`);
        await fs.rename(target, backup);
        backups.push({ backup, target });
      }
      await fs.rename(staged, target);
      installed.push(target);
    }
  } catch (err) {
    const rollbackErrors: string[] = [];
    for (const target of installed.reverse()) {
      try {
        await fs.rm(target, { force: true });
      } catch (rollbackErr) {
        rollbackErrors.push(String(rollbackErr));
      }
    }
    for (const { backup, target } of backups.reverse()) {
      try {
        await fs.rename(backup, target);
      } catch (rollbackErr) {
        rollbackErrors.push(String(rollbackErr));
      }
    }
    if (rollbackErrors.length > 0) {
      throw new OutputCommitError(backupDir, rollbackErrors.join('; '));
    }
    throw err;
  }
}

/* ---------- encrypt ---------- */

async function handleEncrypt(raw: unknown, sender: Electron.WebContents): Promise<EncryptOutcome> {
  const params = raw as EncryptParams;
  const inputPath = assertApproved(params?.inputPath, 'inputPath');
  const outputDir = assertApproved(params?.outputDir, 'outputDir');
  const password = assertString(params?.password, 'password', 1024);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HandshackError('invalid-password', 'password below minimum length', `Enter a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const chunkSize = Number(params?.chunkSize);
  validateChunkSize(chunkSize);
  const overwrite = params?.overwrite === true;

  // One operation at a time. The check-and-claim is synchronous, so no
  // interleaving is possible before the first await.
  if (currentOp) {
    throw new HandshackError(
      'invalid-input',
      'operation already in progress',
      'Another operation is already in progress.',
    );
  }
  const ctrl = new AbortController();
  currentOp = ctrl;

  let stageDir: string | null = null;
  let source: FileByteSource | null = null;
  let preserveStage = false;
  try {
    const inputStat = await fs.stat(inputPath).catch((e) => {
      throw e.code === 'ENOENT' ? new HandshackError('io-error', `missing input ${inputPath}`) : e;
    });
    validateInputFileSize(inputStat.size);
    if (inputStat.size > MAX_INPUT_FILE_SIZE) throw new HandshackError('file-too-large');
    const dirStat = await fs.stat(outputDir).catch(() => null);
    if (!dirStat?.isDirectory()) throw new HandshackError('io-error', 'output dir missing', 'The selected output folder no longer exists.');

    // Pre-scan for collisions so we fail BEFORE doing the cryptographic work.
    const base = sanitizeFileName(path.basename(inputPath));
    const collisions = await findCollisions(outputDir, base);
    if (!overwrite && collisions.length > 0) {
      throw new HandshackError('save-failed', `existing: ${collisions[0]}`, `Files for "${base}" already exist in the selected folder.`);
    }

    const staging = await fs.mkdtemp(path.join(outputDir, '.handshack-stage-'));
    stageDir = staging;
    const backupDir = path.join(staging, 'backups');
    const report = (e: ProgressEvent) => sender.send('op:progress', e);
    const stagedPartPaths: string[] = [];

    source = await FileByteSource.open(inputPath);
    const result = await encryptFile({
      source,
      fileName: path.basename(inputPath),
      password,
      chunkSize,
      provider,
      signal: ctrl.signal,
      onProgress: report,
      generator: 'handshack-desktop',
      openPartSink: (_i, name) => {
        const p = path.join(staging, name);
        stagedPartPaths.push(p);
        return FileByteSink.create(p, overwrite);
      },
    });
    const stagedManifestPath = path.join(staging, result.manifestFileName);
    await fs.writeFile(stagedManifestPath, result.manifestText, { encoding: 'utf8', flag: 'wx' });
    const partPaths = result.partNames.map((name) => path.join(outputDir, name));
    const manifestPath = path.join(outputDir, result.manifestFileName);
    try {
      await commitStagedFiles(
        [...stagedPartPaths, stagedManifestPath],
        [...partPaths, manifestPath],
        backupDir,
        overwrite,
      );
    } catch (err) {
      preserveStage = err instanceof OutputCommitError && err.recoveryDataRetained;
      throw err;
    }
    for (const p of [...partPaths, manifestPath]) approvedPaths.add(p);
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
    await source?.close();
    currentOp = null;
    if (stageDir && !preserveStage) await fs.rm(stageDir, { recursive: true, force: true });
  }
}

/* ---------- decrypt ---------- */

async function handleDecrypt(raw: unknown, sender: Electron.WebContents): Promise<DecryptOutcome> {
  const params = raw as DecryptParams;
  const manifestPath = assertApproved(params?.manifestPath, 'manifestPath');
  const savePath = assertApproved(params?.savePath, 'savePath');
  const password = assertString(params?.password, 'password', 1024);
  const overwrite = params?.overwrite === true;
  const partPaths = params?.partPaths ? assertApprovedPathArray(params.partPaths, 'partPaths', MAX_PART_COUNT) : undefined;

  // One operation at a time (same single-flight rule as handleEncrypt).
  if (currentOp) {
    throw new HandshackError(
      'invalid-input',
      'operation already in progress',
      'Another operation is already in progress.',
    );
  }
  const ctrl = new AbortController();
  currentOp = ctrl;

  try {
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
        await s.source.close?.();
      }
    }
  } finally {
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
    // Packaged builds take the taskbar icon from the exe resource; dev runs the
    // bare electron.exe, so point the window at our artwork explicitly.
    icon: path.join(__dirname, '../../build/icon.png'),
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
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return null;
    approvedPaths.add(dir);
    return dir;
  });
  ipcMain.handle('dialog:save-path', async (_e, rawName) => {
    if (!win) return null;
    const defaultName = sanitizeFileName(assertString(rawName, 'defaultName', 256));
    const r = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      title: 'Save restored file',
    });
    if (r.canceled || !r.filePath) return null;
    approvedPaths.add(r.filePath);
    return r.filePath;
  });
  ipcMain.handle('package:inspect', (e, raw) => inspectPackage(raw).catch((err) => { throw toIpcError(err); }));
  ipcMain.handle('fs:find-collisions', (e, dir, base) => findCollisions(dir, base).catch((err) => { throw toIpcError(err); }));
  ipcMain.handle('fs:exists', (_e, p) => fileExists(assertApproved(p, 'path')));
  ipcMain.handle('fs:reveal', (_e, p) => {
    shell.showItemInFolder(assertApproved(p, 'path'));
  });
  ipcMain.handle('op:encrypt', wrap(handleEncrypt));
  ipcMain.handle('op:decrypt', wrap(handleDecrypt));
  ipcMain.handle('op:cancel', async () => {
    currentOp?.abort();
  });
}

/* ---------- lifecycle ---------- */

if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

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
