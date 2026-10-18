/**
 * Desktop implementation of PlatformServices — every operation is a narrow IPC
 * call into the privileged main process via the preload bridge (window.handshack).
 */
import { HandshackError, type ProgressCallback } from '@handshack/core';
import type {
  DecryptJob,
  DecryptResult,
  EncryptJob,
  EncryptResult,
  PlatformServices,
  SelectedFileRef,
} from '@handshack/ui';
import type { HandshackBridge } from '../shared/api.js';

function bridge(): HandshackBridge {
  const b = window.handshack;
  if (!b) throw new HandshackError('internal-error', 'desktop bridge unavailable');
  return b;
}

/** Decode the tagged error the main process sends over IPC. */
function decode(err: unknown): HandshackError {
  const msg = err instanceof Error ? err.message : String(err);
  // IPC wraps as "Error invoking remote method 'ch': HandshackError: code|msg"
  const m = /([a-z-]+)\|(.+)$/s.exec(msg);
  if (m) return new HandshackError(m[1]!.trim().split(':').pop()!.trim() as never, undefined, m[2]);
  return new HandshackError('internal-error', msg);
}

function refFromPicked(p: { path: string; name: string; size: number }): SelectedFileRef {
  return { handle: p.path, name: p.name, size: p.size };
}

export const desktopServices: PlatformServices = {
  platform: 'desktop',
  version: __APP_VERSION__,
  capabilities: {
    directoryOutput: true,
    saveWithPicker: true,
    zipDownload: false,
    revealInFolder: true,
  },

  async selectFiles({ multiple, purpose }) {
    const b = bridge();
    if (multiple || purpose === 'package') {
      const picked = await b.pickPackageFiles().catch((e) => {
        throw decode(e);
      });
      return picked.map(refFromPicked);
    }
    const picked = await b.pickInputFile().catch((e) => {
      throw decode(e);
    });
    return picked ? [refFromPicked(picked)] : null;
  },

  async inspectPackage(files) {
    const paths = files.map((f) => f.handle as string);
    const r = await bridge()
      .inspectPackage(paths)
      .catch((e) => {
        throw decode(e);
      });
    return {
      manifest: r.manifest,
      manifestFile: { handle: r.manifestPath, name: r.manifestPath.split(/[/\\]/).pop()!, size: 0 },
      matchedParts: r.matchedPartPaths.map((p) => ({
        handle: p,
        name: p.split(/[/\\]/).pop()!,
        size: r.manifest.parts.find((m) => m.name === p.split(/[/\\]/).pop())?.size ?? 0,
      })),
      missing: r.missing,
      unexpected: r.unexpected,
    };
  },

  chooseOutputDirectory: () => bridge().pickOutputDirectory(),
  chooseSavePath: (name) => bridge().pickSavePath(name).catch((e) => { throw decode(e); }),
  findCollisions: (dir, base) => bridge().findCollisions(dir, base).catch((e) => { throw decode(e); }),
  pathExists: (p) => bridge().pathExists(p).catch((e) => { throw decode(e); }),
  revealPath: (p) => bridge().revealPath(p).catch((e) => { throw decode(e); }),

  async encrypt(job: EncryptJob, onProgress: ProgressCallback, signal: AbortSignal) {
    const b = bridge();
    const off = b.onProgress(onProgress);
    const onAbort = () => void b.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      const r = await b.encrypt({
        inputPath: job.input.handle as string,
        outputDir: job.outputDir!,
        password: job.password,
        chunkSize: job.chunkSize,
        overwrite: job.overwrite ?? false,
      });
      return {
        manifestName: r.manifestName,
        manifestText: '',
        partNames: r.partPaths.map((p) => p.split(/[/\\]/).pop()!),
        partCount: r.partPaths.length,
        packageId: r.packageId,
        originalName: r.originalName,
        originalSize: r.originalSize,
        encryptedSize: r.encryptedSize,
        chunkSize: r.chunkSize,
        delivery: {
          kind: 'files',
          directory: r.outputDir,
          files: [r.manifestPath, ...r.partPaths],
        },
      } satisfies EncryptResult;
    } catch (e) {
      throw decode(e);
    } finally {
      signal.removeEventListener('abort', onAbort);
      off();
    }
  },

  async decrypt(job: DecryptJob, onProgress: ProgressCallback, signal: AbortSignal) {
    const b = bridge();
    const off = b.onProgress(onProgress);
    const onAbort = () => void b.cancel();
    signal.addEventListener('abort', onAbort);
    try {
      const r = await b.decrypt({
        manifestPath: job.manifest.handle as string,
        partPaths: job.parts.map((p) => p.handle as string),
        savePath: job.savePath!,
        password: job.password,
        overwrite: job.overwrite ?? false,
      });
      return {
        fileName: r.fileName,
        size: r.size,
        sha256Hex: r.sha256Hex,
        packageId: r.packageId,
        delivery: { kind: 'file', path: r.outPath },
      } satisfies DecryptResult;
    } catch (e) {
      throw decode(e);
    } finally {
      signal.removeEventListener('abort', onAbort);
      off();
    }
  },
};
