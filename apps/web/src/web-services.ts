/**
 * Browser implementation of PlatformServices.
 * All cryptography runs in a dedicated Web Worker (crypto.worker.ts);
 * file content never leaves the page.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import {
  HandshackError,
  isManifestFileName,
  MAX_MANIFEST_SIZE,
  parseManifestBytes,
  sanitizeFileName,
  toHandshackError,
  validateInputFileSize,
} from '@handshack/core';
import type {
  DecryptJob,
  EncryptJob,
  PackageInspection,
  PlatformServices,
  ReleaseInfo,
  SelectedFileRef,
} from '@handshack/ui';
import type { ProgressCallback } from '@handshack/core';
import type { WorkerRequest, WorkerResponse } from './worker/protocol.js';

declare global {
  interface Window {
    showSaveFilePicker?: (opts?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<{
      createWritable: () => Promise<{
        write: (d: Blob | Uint8Array) => Promise<void>;
        close: () => Promise<void>;
        abort: () => Promise<void>;
      }>;
      name: string;
    }>;
  }
}

const VERSION = __APP_VERSION__;

function refFromFile(f: File): SelectedFileRef {
  return { handle: f, name: f.name, size: f.size };
}

/** Spawn a fresh worker per job — terminate() is also our cancel mechanism. */
function runWorkerJob(
  request: (jobId: number) => WorkerRequest,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker/crypto.worker.ts', import.meta.url), {
      type: 'module',
    });
    const jobId = 1;
    const onAbort = () => worker.terminate();
    signal.addEventListener('abort', onAbort);
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'progress') {
        onProgress({ phase: msg.phase as never, done: msg.done, total: msg.total });
        return;
      }
      cleanup();
      if (msg.kind === 'error') {
        reject(new HandshackError(msg.code as never, undefined, msg.message));
      } else {
        resolve(msg);
      }
    };
    worker.onerror = (e) => {
      cleanup();
      reject(toHandshackError(e.error ?? e));
    };
    function cleanup() {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    }
    worker.postMessage(request(jobId));
    if (signal.aborted) onAbort();
  });
}

/* ---------- ZIP import/export (fflate, STORE only — contents are already encrypted) ---------- */

function expandZipFile(f: File, bytes: Uint8Array): File[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (entry) => entry.name.length < 512 });
  } catch {
    throw new HandshackError('invalid-input', `cannot read ${f.name} as a ZIP archive`, `The file "${f.name}" does not appear to be a valid ZIP archive.`);
  }
  const out: File[] = [];
  const seen = new Set<string>();
  for (const [path, data] of Object.entries(entries)) {
    // Normalize + validate: no traversal, no absolute paths, basename only.
    const base = path.split('/').pop() ?? '';
    if (!base || base.startsWith('.') || /[/\\]/.test(base) || base.includes('..')) continue;
    if (data.length === 0) continue;
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(new File([data.slice()], base));
  }
  return out;
}

async function expandInputs(files: SelectedFileRef[]): Promise<SelectedFileRef[]> {
  const out: SelectedFileRef[] = [];
  for (const ref of files) {
    const f = ref.handle as File;
    if (/\.zip$/i.test(f.name)) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      for (const inner of expandZipFile(f, bytes)) out.push(refFromFile(inner));
    } else {
      out.push(ref);
    }
  }
  return out;
}

/* ---------- package inspection ---------- */

async function inspectPackage(files: SelectedFileRef[]): Promise<PackageInspection> {
  const expanded = await expandInputs(files);
  const manifestRef = expanded.find((r) => isManifestFileName(r.name));
  if (!manifestRef) {
    throw new HandshackError(
      'invalid-manifest',
      'no .hsmanifest.json among selected files',
      'No HandShack manifest was found among the selected files. Look for a file ending in .hsmanifest.json.',
    );
  }
  const manifestFile = manifestRef.handle as File;
  if (manifestFile.size > MAX_MANIFEST_SIZE) {
    throw new HandshackError('invalid-manifest', 'manifest file too large');
  }
  const manifest = parseManifestBytes(new Uint8Array(await manifestFile.arrayBuffer()));

  const declared = new Map(manifest.parts.map((p) => [p.name, p]));
  const matched: SelectedFileRef[] = [];
  const unexpected: string[] = [];
  const seenNames = new Set<string>();
  for (const ref of expanded) {
    if (ref === manifestRef) continue;
    if (declared.has(ref.name) && !seenNames.has(ref.name)) {
      seenNames.add(ref.name);
      matched.push(ref);
    } else if (!declared.has(ref.name)) {
      unexpected.push(ref.name);
    }
  }
  // keep manifest order
  const order = new Map(manifest.parts.map((p, i) => [p.name, i]));
  matched.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  const have = new Set(matched.map((m) => m.name));
  const missing = manifest.parts.filter((p) => !have.has(p.name)).map((p) => p.name);
  return { manifest, manifestFile: manifestRef, matchedParts: matched, missing, unexpected };
}

/* ---------- downloads ---------- */

function anchorDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function saveBlob(name: string, blob: Blob): Promise<void> {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // user cancelled picker
      // fall back to a normal download on any other failure
    }
  }
  anchorDownload(name, blob);
}

async function downloadParts(
  manifestName: string,
  manifestBlob: Blob,
  parts: { name: string; blob: Blob }[],
): Promise<void> {
  anchorDownload(manifestName, manifestBlob);
  // Small delay so the browser registers each download distinctly.
  for (const p of parts) {
    await new Promise((r) => setTimeout(r, 350));
    anchorDownload(p.name, p.blob);
  }
}

async function downloadZip(
  manifestName: string,
  manifestText: string,
  parts: { name: string; blob: Blob }[],
): Promise<void> {
  const files: Zippable = {};
  files[manifestName] = new TextEncoder().encode(manifestText);
  for (const p of parts) {
    files[p.name] = new Uint8Array(await p.blob.arrayBuffer());
  }
  const zip = zipSync(files, { level: 0 }); // STORE — contents are already encrypted
  const base = manifestName.replace(/\.hsmanifest\.json$/, '');
  anchorDownload(`${base}-package.zip`, new Blob([zip], { type: 'application/zip' }));
}

/* ---------- release info (build-time env) ---------- */

const release: ReleaseInfo = {
  latestVersion: import.meta.env.VITE_RELEASE_VERSION || null,
  installerUrl: import.meta.env.VITE_RELEASE_INSTALLER_URL || undefined,
  installerSha256: import.meta.env.VITE_RELEASE_INSTALLER_SHA256 || undefined,
  portableUrl: import.meta.env.VITE_RELEASE_PORTABLE_URL || undefined,
  portableSha256: import.meta.env.VITE_RELEASE_PORTABLE_SHA256 || undefined,
  notesUrl: import.meta.env.VITE_RELEASE_NOTES_URL || undefined,
  repoUrl: import.meta.env.VITE_REPO_URL || null,
};

/* ---------- service object ---------- */

export const webServices: PlatformServices = {
  platform: 'web',
  version: VERSION,
  capabilities: {
    directoryOutput: false,
    saveWithPicker: typeof window !== 'undefined' && !!window.showSaveFilePicker,
    zipDownload: true,
    revealInFolder: false,
  },
  release,

  selectFiles({ multiple }) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = multiple;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.onchange = () => {
        const files = Array.from(input.files ?? []).map(refFromFile);
        input.remove();
        resolve(files);
      };
      input.oncancel = () => {
        input.remove();
        resolve(null);
      };
      input.click();
    });
  },

  inspectPackage,

  async encrypt(job: EncryptJob, onProgress, signal) {
    const file = job.input.handle as File;
    validateInputFileSize(file.size);
    const res = await runWorkerJob(
      (jobId) => ({ kind: 'encrypt', jobId, file, password: job.password, chunkSize: job.chunkSize }),
      onProgress,
      signal,
    );
    if (res.kind !== 'encrypt-result') throw new HandshackError('internal-error', 'unexpected worker reply');
    const manifestBlob = new Blob([res.manifestText], { type: 'application/json' });
    return {
      manifestName: res.manifestName,
      manifestText: res.manifestText,
      partNames: res.parts.map((p) => p.name),
      partCount: res.parts.length,
      packageId: res.packageId,
      originalName: res.originalName,
      originalSize: res.originalSize,
      encryptedSize: res.encryptedSize,
      chunkSize: res.chunkSize,
      delivery: { kind: 'downloads', manifestName: res.manifestName, manifestBlob, parts: res.parts },
    };
  },

  async decrypt(job: DecryptJob, onProgress, signal) {
    const manifestFile = job.manifest.handle as File;
    const partFiles = job.parts.map((p) => p.handle as File);
    const res = await runWorkerJob(
      (jobId) => ({
        kind: 'decrypt',
        jobId,
        manifestFile,
        partFiles,
        password: job.password,
      }),
      onProgress,
      signal,
    );
    if (res.kind !== 'decrypt-result') throw new HandshackError('internal-error', 'unexpected worker reply');
    return {
      fileName: sanitizeFileName(res.fileName),
      size: res.size,
      sha256Hex: res.sha256Hex,
      packageId: res.packageId,
      delivery: { kind: 'download', blob: res.blob },
    };
  },

  saveBlob,
  downloadZip,
  downloadParts,
};
