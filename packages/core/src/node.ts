/**
 * Node.js-specific adapters — Electron main process, CLI, tests.
 * This entry point must never be bundled into the browser build.
 */
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HandshackError } from './errors.js';
import type { ByteSink, ByteSource } from './types.js';

export { NodeCryptoProvider } from './crypto/providers/node-provider.js';
export * from './index.js';

/** Random-access source over a file opened with fs.promises. */
export class FileByteSource implements ByteSource {
  private handle: fs.FileHandle | null = null;

  private constructor(
    readonly filePath: string,
    readonly size: number,
  ) {}

  static async open(filePath: string): Promise<FileByteSource> {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new HandshackError('io-error', `${filePath} is not a regular file`);
      return new FileByteSource(filePath, stat.size);
    } catch (err) {
      if (err instanceof HandshackError) throw err;
      throw mapFsError(err, filePath);
    }
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new HandshackError('io-error', `read out of bounds on ${this.filePath}`);
    }
    if (!this.handle) this.handle = await fs.open(this.filePath, 'r');
    const out = new Uint8Array(length);
    const { bytesRead } = await this.handle.read(out, 0, length, offset);
    if (bytesRead !== length) {
      throw new HandshackError('truncated-package', `short read on ${this.filePath}`);
    }
    return out;
  }

  async close(): Promise<void> {
    if (this.handle) {
      await this.handle.close().catch(() => undefined);
      this.handle = null;
    }
  }
}

/**
 * Atomic-ish file sink: writes to `<path>.handshack-partial`, renames into
 * place on close(), deletes the partial file on abort(). Refuses to overwrite
 * an existing destination unless `overwrite` is set.
 */
export class FileByteSink implements ByteSink {
  private handle: fs.FileHandle | null = null;
  private done = false;
  readonly partialPath: string;

  private constructor(
    readonly finalPath: string,
    private readonly overwrite: boolean,
  ) {
    this.partialPath = `${finalPath}.handshack-partial`;
  }

  static async create(finalPath: string, overwrite: boolean): Promise<FileByteSink> {
    const sink = new FileByteSink(finalPath, overwrite);
    if (!overwrite && (await fileExists(finalPath))) {
      throw new HandshackError(
        'save-failed',
        `destination exists: ${finalPath}`,
        `A file named "${path.basename(finalPath)}" already exists in this folder.`,
      );
    }
    try {
      sink.handle = await fs.open(sink.partialPath, 'w');
      return sink;
    } catch (err) {
      throw mapFsError(err, finalPath);
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (this.done) throw new HandshackError('io-error', 'write after close');
    await this.handle!.write(data);
  }

  async close(): Promise<void> {
    this.done = true;
    try {
      await this.handle!.close();
      this.handle = null;
      if (!this.overwrite && (await fileExists(this.finalPath))) {
        throw new HandshackError('save-failed', `destination appeared during write: ${this.finalPath}`);
      }
      await fs.rename(this.partialPath, this.finalPath);
    } catch (err) {
      await this.abort().catch(() => undefined);
      if (err instanceof HandshackError) throw err;
      throw mapFsError(err, this.finalPath);
    }
  }

  async abort(): Promise<void> {
    this.done = true;
    if (this.handle) {
      await this.handle.close().catch(() => undefined);
      this.handle = null;
    }
    await fs.rm(this.partialPath, { force: true }).catch(() => undefined);
  }
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readFileBytes(p: string, maxSize: number): Promise<Uint8Array> {
  try {
    const stat = await fs.stat(p);
    if (stat.size > maxSize) {
      throw new HandshackError('invalid-manifest', `file ${p} exceeds ${maxSize} bytes`);
    }
    return new Uint8Array(await fs.readFile(p));
  } catch (err) {
    if (err instanceof HandshackError) throw err;
    throw mapFsError(err, p);
  }
}

/** Check whether any of the given output paths already exist. */
export async function existingPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) if (await fileExists(p)) out.push(p);
  return out;
}

export function mapFsError(err: unknown, p: string): HandshackError {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return new HandshackError('io-error', `not found: ${p}`, 'The selected file or folder could not be found.');
  if (code === 'EACCES' || code === 'EPERM') return new HandshackError('permission-denied', `access denied: ${p}`);
  if (code === 'ENOSPC') return new HandshackError('insufficient-space', `no space: ${p}`);
  return new HandshackError('io-error', `${code ?? 'io'}: ${p}`);
}
